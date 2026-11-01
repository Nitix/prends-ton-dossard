import { Link } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { useEffect, useId, useRef, useState } from "react";

import { DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { useSession } from "../auth/session";
import { AddSomeoneDialog } from "../participations/AddSomeoneDialog";
import { JoinDialog } from "../participations/JoinDialog";
import { ParticipationMenu } from "../participations/ParticipationMenu";
import {
  canConfirm,
  canDeleteEvent,
  canEditParticipation,
  type Me,
} from "../participations/permissions";
import { useEvent, type EventView, type FormatView, type ParticipationView } from "./api";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { formatDisplayName, formatMeasures } from "./formatName";
import { joinOptions, nonStarters, starters, type NonStarter } from "./participants";

const SEPARATOR = " · ";

/** The box of a section of the page: the interested, a format, those who do not start. */
const SECTION = "rounded-lg border border-neutral-200 bg-white p-3";

/**
 * The page of an event: what it is, its link to register, who is interested
 * with no format yet, each format with who starts it and in what state, those
 * who do not start, and the actions the signed-in member may take. The app
 * shell around it owns the page's `<main>`.
 */
export function EventPage({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useEvent(id);
  const { user, runner, isAdmin } = useSession();
  // The actions need to know who the member is: no `me` while their runner loads.
  const me: Me | null = user && runner ? { userId: user.id, runnerId: runner.id, isAdmin } : null;

  // A refresh that fails keeps what the page already shows.
  if (query.data) return <EventContent view={query.data} me={me} />;
  if (query.isError) {
    const gone = query.error instanceof ClientResponseError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {gone ? t.errors.not_found : t.errors.generic}
        </p>
        {!gone && (
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }
  return <output>{t.common.loading}</output>;
}

/** The address, if it is a web address: the field is free text for whoever writes the event, and `javascript:` is one. */
function webAddress(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  try {
    const { protocol } = new URL(raw);
    return protocol === "https:" || protocol === "http:" ? raw : undefined;
  } catch {
    return undefined;
  }
}

type Opened = "join" | "add" | "delete";

function EventContent({ view, me }: { view: EventView; me: Me | null }) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = () => {
    setOpened(null);
  };
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  // "I'm in" is for what is left to choose: a format where the member has no
  // participation yet, or "not decided yet".
  const options = me && joinOptions(view, me.runnerId);
  const canJoin = !!options && (options.formats.length > 0 || options.undecided);
  const notStarting = nonStarters(view);

  return (
    <article className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold">{event.name}</h1>
        <p className="text-neutral-600">
          {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </p>
        <p>{event.location}</p>
        {event.notes && <p className="mt-2 whitespace-pre-line">{event.notes}</p>}
        {registration && (
          <a
            href={registration}
            target="_blank"
            rel="noopener noreferrer"
            className={`${PRIMARY} mt-2 inline-flex items-center self-start`}
          >
            {t.event.register}
          </a>
        )}
      </header>

      <div className="flex flex-wrap gap-2">
        {canJoin && (
          <button
            type="button"
            onClick={() => {
              setOpened("join");
            }}
            className={PRIMARY}
          >
            {t.participation.join}
          </button>
        )}
        {me && formats.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setOpened("add");
            }}
            className={SECONDARY}
          >
            {t.participation.addSomeone}
          </button>
        )}
        <Link
          to="/evenements/$id/modifier"
          params={{ id: event.id }}
          className={`${SECONDARY} inline-flex items-center`}
        >
          {t.common.edit}
        </Link>
        {me && canDeleteEvent(event, me) && (
          <button
            type="button"
            onClick={() => {
              setOpened("delete");
            }}
            className={`${SECONDARY} ${DANGER_TEXT}`}
          >
            {t.common.delete}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {view.interested.length > 0 && <InterestedSection view={view} me={me} />}
        {formats.map((formatView) => (
          <FormatSection
            key={formatView.format.id}
            eventId={event.id}
            formatView={formatView}
            showDate={severalDays}
            me={me}
          />
        ))}
        {notStarting.length > 0 && (
          <NonStartersSection eventId={event.id} list={notStarting} me={me} />
        )}
      </div>

      {me && <JoinDialog open={opened === "join"} onClose={close} view={view} me={me} />}
      <AddSomeoneDialog open={opened === "add"} onClose={close} view={view} />
      {me && canDeleteEvent(event, me) && (
        <DeleteEventDialog open={opened === "delete"} onClose={close} view={view} />
      )}
    </article>
  );
}

/**
 * What a section of the page does with the focus. A participant that has just
 * left it (removed, or moved to another list) takes the focus away with their
 * row, menu button included. The focus goes to the title of the section, which
 * stays and tells the user where they are. The title is not in the tab order:
 * it only receives the focus from this effect. When the section goes with its
 * last row, there is nothing left to focus.
 */
function useFocusAfterDeparture<E extends HTMLElement>() {
  const title = useRef<E>(null);
  const [departures, setDepartures] = useState(0);
  useEffect(() => {
    if (departures > 0) title.current?.focus();
  }, [departures]);
  return {
    title,
    onDeparture: () => {
      setDepartures((count) => count + 1);
    },
  };
}

/** The participations on the event alone ("interested, format to choose"): before the formats, since there is something to do. */
function InterestedSection({ view, me }: { view: EventView; me: Me | null }) {
  const { t } = useI18n();
  const headingId = useId();
  const { title, onDeparture } = useFocusAfterDeparture<HTMLHeadingElement>();

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${SECTION}`}>
      <h2 ref={title} id={headingId} tabIndex={-1} className="text-lg font-semibold">
        {t.event.interestedTitle}
      </h2>
      <ul aria-label={t.event.participants} className="flex flex-col gap-2">
        {view.interested.map((participationView) => (
          <ParticipantRow
            key={participationView.participation.id}
            eventId={view.event.id}
            participationView={participationView}
            label={view.event.name}
            formatsOf={view}
            me={me}
            onRemoved={onDeparture}
          />
        ))}
      </ul>
    </section>
  );
}

/** A format: its measures, its day when the event has several, and the runners who start it. */
function FormatSection({
  eventId,
  formatView,
  showDate,
  me,
}: {
  eventId: string;
  formatView: FormatView;
  showDate: boolean;
  me: Me | null;
}) {
  const { t, f } = useI18n();
  const headingId = useId();
  const { format, raceType, date, participations } = formatView;
  const { title, onDeparture } = useFocusAfterDeparture<HTMLHeadingElement>();
  // Those who do not start are in the list at the bottom of the page.
  const onTheStart = starters(participations);

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${SECTION}`}>
      <h2 ref={title} id={headingId} tabIndex={-1} className="text-lg font-semibold">
        {formatMeasures(format, raceType.label, f, t).join(SEPARATOR)}
      </h2>
      {showDate && <p className="text-sm text-neutral-600">{f.date(date)}</p>}
      {onTheStart.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.event.nobody}</p>
      ) : (
        <ul aria-label={t.event.participants} className="flex flex-col gap-2">
          {onTheStart.map((participationView) => (
            <ParticipantRow
              key={participationView.participation.id}
              eventId={eventId}
              participationView={participationView}
              detail={t.status[participationView.participation.status]}
              label={formatDisplayName(format, raceType.label, f, t)}
              me={me}
              onRemoved={onDeparture}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The participations "not starting", closed: they are not among the runners of
 * the event, but the page keeps them, with the format they are on and their
 * menu, to bring them back to another status.
 */
function NonStartersSection({
  eventId,
  list,
  me,
}: {
  eventId: string;
  list: NonStarter[];
  me: Me | null;
}) {
  const { t, f } = useI18n();
  const { title, onDeparture } = useFocusAfterDeparture<HTMLElement>();

  return (
    <details className={SECTION}>
      <summary ref={title} className="min-h-11 cursor-pointer py-2 text-lg font-semibold">
        {t.event.nonStarters(list.length)}
      </summary>
      <ul aria-label={t.event.participants} className="mt-2 flex flex-col gap-2">
        {list.map(({ formatView, participationView }) => {
          const name = formatDisplayName(formatView.format, formatView.raceType.label, f, t);
          return (
            <ParticipantRow
              key={participationView.participation.id}
              eventId={eventId}
              participationView={participationView}
              detail={name}
              label={name}
              me={me}
              onRemoved={onDeparture}
            />
          );
        })}
      </ul>
    </details>
  );
}

/**
 * A runner of a list: their name, a line under it (their status, or the format
 * they are on) when the list has one to tell, then who added them and that they
 * have not agreed yet when it is so. An unconfirmed one is dashed as well as
 * said in words: the state is never told by the border alone.
 */
function ParticipantRow({
  eventId,
  participationView,
  detail,
  label,
  formatsOf,
  me,
  onRemoved,
}: {
  eventId: string;
  participationView: ParticipationView;
  /** The line under the name. */
  detail?: string;
  /** What the participation is on, for the menu: its format, or the event when it has none. */
  label: string;
  /** Given for a participation on the event alone: see `ParticipationMenu`. */
  formatsOf?: EventView;
  me: Me | null;
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const { participation, runner, addedBy } = participationView;
  const confirmed = participation.confirmed;

  return (
    <li
      className={`flex items-center justify-between gap-2 rounded-lg border-2 py-1 pr-1 pl-3 ${
        confirmed ? "border-neutral-200" : "border-dashed border-neutral-400"
      }`}
    >
      <div className="min-w-0 py-1">
        <p className="font-medium break-words">{runner.name}</p>
        {detail !== undefined && <p className="text-sm text-neutral-600">{detail}</p>}
        {!confirmed && (
          <p className="text-sm text-neutral-600">
            {addedBy ? t.event.addedByUnconfirmed(addedBy.name) : t.event.unconfirmed}
          </p>
        )}
      </div>
      {me && canEditParticipation(participation, runner, me) && (
        <ParticipationMenu
          eventId={eventId}
          participation={participation}
          runner={runner}
          label={label}
          formatsOf={formatsOf}
          canConfirm={canConfirm(runner, me)}
          onRemoved={onRemoved}
        />
      )}
    </li>
  );
}
