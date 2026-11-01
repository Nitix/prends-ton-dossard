import { Link } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { useEffect, useId, useRef, useState } from "react";

import { Avatar } from "../../components/Avatar";
import { DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { SECTION } from "../../components/section";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import type { Formatters } from "../../lib/format";
import type { ParticipationRecord } from "../../lib/types";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import { useSession } from "../auth/session";
import { downloadEventIcs } from "../calendar/eventIcs";
import { useComments } from "../comments/api";
import { CommentsSection } from "../comments/CommentsSection";
import { useOffers } from "../offers/api";
import { OffersSection } from "../offers/OffersSection";
import { AddSomeoneDialog } from "../participations/AddSomeoneDialog";
import { JoinDialog } from "../participations/JoinDialog";
import { ParticipationMenu } from "../participations/ParticipationMenu";
import {
  canConfirm,
  canDeleteEvent,
  canEditParticipation,
  type Me,
} from "../participations/permissions";
import { resultParts } from "../results/resultText";
import { RouteSection } from "../route/RouteSection";
import { useEvent, type EventView, type FormatView, type ParticipationView } from "./api";
import { DeleteEventDialog } from "./DeleteEventDialog";
import { formatDisplayName, formatMeasures } from "./formatName";
import { isInterested, joinOptions, nonStarters, starters, type NonStarter } from "./participants";
import { registrationLabel, registrationState } from "./registration";

const SEPARATOR = " · ";

/** The days that are counted next to the deadline: a week or less. */
const DAYS_LEFT_SHOWN = 7;

// The titles that the focus can be given to, by their `data-focus`: the title of
// the page, of the section of the interested, of a format, of the supporters, of
// those who do not start. None is in the tab order: they only receive the focus
// from the page.
const PAGE_TITLE = "title";
const INTERESTED = "interested";
const SUPPORTERS = "supporters";
const NON_STARTERS = "non-starters";
const formatTitle = (formatId: string) => `format:${formatId}`;

/**
 * A participation that has just left its row, because it was removed or moved
 * to another list, or one that has just been created (by "I'm in"). The menu or
 * the button the user was on went away, and the focus with it: the page gives
 * it back (see `useFocusAfterDeparture`).
 */
type Departure = {
  participation: string;
  /**
   * The title of the section of its row, for when it is not on the page any
   * more. None for a new participation: it has no row yet.
   */
  source?: string;
  /** Its row, if it was still on the page when the page was told. */
  row: HTMLElement | null;
};

/** What a row tells the page when its participation leaves it. */
type Depart = (participation: string, source: string, row: HTMLElement | null) => void;

/** The title of the section where the participation is on this page, if it is. */
function titleOfParticipation(view: EventView, id: string): string | undefined {
  if (view.interested.some(({ participation }) => participation.id === id)) return INTERESTED;
  if (view.supporters.some(({ participation }) => participation.id === id)) return SUPPORTERS;
  for (const { format, participations } of view.formats) {
    const found = participations.find(({ participation }) => participation.id === id);
    if (found) {
      // Those who do not start are in their own list.
      return found.participation.status === "dns" ? NON_STARTERS : formatTitle(format.id);
    }
  }
  return undefined;
}

/**
 * The page of an event: what it is, its link to register, who is interested
 * with no format yet, each format with who starts it and in what state, the
 * supporters, those who do not start, the carpooling and the lodging, the
 * comments, and the actions the signed-in member may take. The app shell
 * around it owns the page's `<main>`.
 */
export function EventPage({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useEvent(id);
  // The comments and the offers are asked for with the event, not once it has arrived: the
  // sections at the bottom of the page read these same queries (same keys), which are there
  // by the time they appear, and the page makes one round trip instead of two.
  useComments(id);
  useOffers(id);
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

type Opened = "join" | "add" | "delete";

/**
 * Where the focus goes (a keyboard or screen reader user must not restart from
 * the top of the page). A participation that leaves its row (removed, given a
 * format, moved to or from those who do not start) takes the focus away with
 * its menu button, and so does a new participation whose "I'm in" button is
 * gone with the last format to take. The page tells the user where they are:
 * the title of the section where the participation is now, or, if it is not on
 * the page any more, of the one it left; and if that section has gone with its
 * last row, the title of the page.
 *
 * It waits for the page to show the change: the request is over before the
 * page has the new data (the mutations wait for the data, not for the screen).
 * And it only moves the focus when it has been lost: not when the user has
 * gone on to something else, nor when the browser has already given it back to
 * a button that is still there.
 *
 * `root` is the element that holds the titles; `setDeparture` tells the page.
 */
function useFocusAfterDeparture(view: EventView) {
  const root = useRef<HTMLElement>(null);
  const [departure, setDeparture] = useState<Departure | null>(null);
  const handled = useRef<Departure | null>(null);

  useEffect(() => {
    if (!departure || handled.current === departure) return;
    const now = titleOfParticipation(view, departure.participation);
    // Not shown yet: the participation is still where it was (or, for a new one, not there).
    if (now === departure.source) return;
    handled.current = departure;

    const active = document.activeElement;
    const lost =
      !active ||
      active === document.body ||
      !active.isConnected ||
      !!departure.row?.contains(active);
    if (!lost) return;

    const titles = Array.from(root.current?.querySelectorAll<HTMLElement>("[data-focus]") ?? []);
    for (const key of [now, departure.source, PAGE_TITLE]) {
      const title = titles.find((element) => element.dataset.focus === key);
      if (title) {
        title.focus();
        return;
      }
    }
  }, [departure, view]);

  return { root, setDeparture };
}

/** The link to the official page of the registration: it opens in another tab, without giving it access to this one. */
function RegisterLink({ href, className }: { href: string; className?: string }) {
  const { t } = useI18n();

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`${PRIMARY} inline-flex items-center self-start ${className ?? ""}`}
    >
      {t.event.register}
    </a>
  );
}

function EventContent({ view, me }: { view: EventView; me: Me | null }) {
  const { t, f } = useI18n();
  const today = useToday();
  // The title describes « Ajouter quelqu'un » of the page, which the offers have a button of the same name to put someone in a car.
  const titleId = useId();
  const { event, formats, start, end } = view;
  const [opened, setOpened] = useState<Opened | null>(null);
  const close = () => {
    setOpened(null);
  };

  const { root, setDeparture } = useFocusAfterDeparture(view);
  const departed: Depart = (participation, source, row) => {
    setDeparture({ participation, source, row });
  };
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  // A runner who is only interested is told to register before it is too late.
  const reminded = deadline?.kind === "open" && !!me && isInterested(view, me.runnerId);
  // "I'm in" is for what is left to choose: a format where the member has no
  // participation yet, or "not decided yet".
  const options = me && joinOptions(view, me.runnerId);
  const canJoin = !!options && (options.formats.length > 0 || options.undecided);
  const notStarting = nonStarters(view);

  return (
    <article ref={root} className="flex flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 id={titleId} data-focus={PAGE_TITLE} tabIndex={-1} className="text-2xl font-semibold">
          {event.name}
        </h1>
        <p className="text-neutral-600">
          {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </p>
        <p>{event.location}</p>
        {deadline && (
          <p>
            {registrationLabel(deadline, f, t)}
            {deadline.kind === "open" &&
              deadline.daysLeft <= DAYS_LEFT_SHOWN &&
              `${SEPARATOR}${t.event.daysLeft(deadline.daysLeft)}`}
          </p>
        )}
        {event.notes && <p className="mt-2 whitespace-pre-line">{event.notes}</p>}
        {registration && <RegisterLink href={registration} className="mt-2" />}
      </header>

      {reminded && (
        <aside aria-label={t.event.reminderTitle} className={`flex flex-col gap-2 ${SECTION}`}>
          <p>{t.event.reminder(f.date(deadline.deadline))}</p>
          {registration && <RegisterLink href={registration} />}
        </aside>
      )}

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
            aria-describedby={titleId}
            onClick={() => {
              setOpened("add");
            }}
            className={SECONDARY}
          >
            {t.participation.addSomeone}
          </button>
        )}
        <button
          type="button"
          onClick={() => {
            downloadEventIcs(view, t.event.calendarFileName);
          }}
          className={SECONDARY}
        >
          {t.event.addToCalendar}
        </button>
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
        {view.interested.length > 0 && (
          <InterestedSection view={view} me={me} onDeparture={departed} />
        )}
        {formats.map((formatView) => (
          <FormatSection
            key={formatView.format.id}
            eventId={event.id}
            formatView={formatView}
            showDate={severalDays}
            me={me}
            onDeparture={departed}
          />
        ))}
        {view.supporters.length > 0 && (
          <SupportersSection view={view} me={me} onDeparture={departed} />
        )}
        {notStarting.length > 0 && (
          <NonStartersSection
            eventId={event.id}
            list={notStarting}
            me={me}
            onDeparture={departed}
          />
        )}
        <OffersSection view={view} kind="ride" me={me} />
        <OffersSection view={view} kind="lodging" me={me} />
        <CommentsSection eventId={event.id} me={me} />
      </div>

      {me && (
        <JoinDialog
          open={opened === "join"}
          onClose={close}
          onJoined={(created) => {
            setDeparture({ participation: created.id, row: null });
          }}
          view={view}
          me={me}
        />
      )}
      <AddSomeoneDialog open={opened === "add"} onClose={close} view={view} />
      {me && canDeleteEvent(event, me) && (
        <DeleteEventDialog open={opened === "delete"} onClose={close} view={view} />
      )}
    </article>
  );
}

/** The participations on the event alone ("interested, format to choose"): before the formats, since there is something to do. */
function InterestedSection({
  view,
  me,
  onDeparture,
}: {
  view: EventView;
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t } = useI18n();

  return (
    <EventSection
      view={view}
      list={view.interested}
      title={t.event.interestedTitle}
      focus={INTERESTED}
      me={me}
      onDeparture={onDeparture}
    />
  );
}

/** The supporters of the event, who come to cheer and start nothing: after the formats. */
function SupportersSection({
  view,
  me,
  onDeparture,
}: {
  view: EventView;
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t } = useI18n();

  return (
    <EventSection
      view={view}
      list={view.supporters}
      title={t.event.supportersTitle}
      focus={SUPPORTERS}
      me={me}
      onDeparture={onDeparture}
    />
  );
}

/**
 * A section of the runners who are on the event alone, with no format: their
 * title says what they are (the rows do not), and the menu of each row can give
 * them a format or move them to the other section of the event.
 */
function EventSection({
  view,
  list,
  title,
  focus,
  me,
  onDeparture,
}: {
  view: EventView;
  list: ParticipationView[];
  title: string;
  /** The `data-focus` of the title, which is also where the focus goes when a row of the section leaves it. */
  focus: string;
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${SECTION}`}>
      <h2 id={headingId} data-focus={focus} tabIndex={-1} className="text-lg font-semibold">
        {title}
      </h2>
      <ul aria-label={t.event.participants} className="flex flex-col gap-2">
        {list.map((participationView) => (
          <ParticipantRow
            key={participationView.participation.id}
            eventId={view.event.id}
            participationView={participationView}
            label={view.event.name}
            formatsOf={view}
            source={focus}
            me={me}
            onDeparture={onDeparture}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * What the row of a participation under a format says: its status, and for a
 * finish or a DNF what is known of the result after it ("Terminé · 4h 12min 30s
 * · 12e sur 340 · 3e V1H"). The server clears a result when the status changes;
 * the page still shows none for the other statuses.
 */
function statusLine(participation: ParticipationRecord, f: Formatters, t: Messages): string {
  const { status } = participation;
  const result = status === "finished" || status === "dnf" ? resultParts(participation, f, t) : [];
  return [t.status[status], ...result].join(SEPARATOR);
}

/** A format: its measures, its day when the event has several, the runners who start it, and its course. */
function FormatSection({
  eventId,
  formatView,
  showDate,
  me,
  onDeparture,
}: {
  eventId: string;
  formatView: FormatView;
  showDate: boolean;
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t, f } = useI18n();
  const headingId = useId();
  const { format, raceType, date, participations } = formatView;
  // Those who do not start are in the list at the bottom of the page.
  const onTheStart = starters(participations);

  return (
    <section aria-labelledby={headingId} className={`flex flex-col gap-2 ${SECTION}`}>
      <h2
        id={headingId}
        data-focus={formatTitle(format.id)}
        tabIndex={-1}
        className="text-lg font-semibold"
      >
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
              detail={statusLine(participationView.participation, f, t)}
              label={formatDisplayName(format, raceType.label, f, t)}
              source={formatTitle(format.id)}
              me={me}
              onDeparture={onDeparture}
            />
          ))}
        </ul>
      )}
      <RouteSection format={format} />
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
  onDeparture,
}: {
  eventId: string;
  list: NonStarter[];
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t, f } = useI18n();

  return (
    <details className={SECTION}>
      <summary
        data-focus={NON_STARTERS}
        className="min-h-11 cursor-pointer py-2 text-lg font-semibold"
      >
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
              source={NON_STARTERS}
              me={me}
              onDeparture={onDeparture}
            />
          );
        })}
      </ul>
    </details>
  );
}

/**
 * A runner of a list: their photo (or their initials), their name, a line under
 * it (their status, or the format they are on) when the list has one to tell,
 * then who added them and that they have not agreed yet when it is so. An
 * unconfirmed one is dashed as well as said in words: the state is never told
 * by the border alone.
 */
function ParticipantRow({
  eventId,
  participationView,
  detail,
  label,
  formatsOf,
  source,
  me,
  onDeparture,
}: {
  eventId: string;
  participationView: ParticipationView;
  /** The line under the name. */
  detail?: string;
  /** What the participation is on, for the menu: its format, or the event when it has none. */
  label: string;
  /** Given for a participation on the event alone: see `ParticipationMenu`. */
  formatsOf?: EventView;
  /** The title of the section of this row: where the focus goes if the participation is removed. */
  source: string;
  me: Me | null;
  onDeparture: Depart;
}) {
  const { t } = useI18n();
  const { participation, runner, addedBy } = participationView;
  const confirmed = participation.confirmed;
  const row = useRef<HTMLLIElement>(null);

  return (
    <li
      ref={row}
      className={`flex items-center justify-between gap-2 rounded-lg border-2 py-1 pr-1 pl-3 ${
        confirmed ? "border-neutral-200" : "border-dashed border-neutral-400"
      }`}
    >
      <div className="flex min-w-0 items-center gap-3 py-1">
        <Avatar
          runner={runner}
          thumb="96x96"
          className="size-11 shrink-0 bg-neutral-200 text-sm font-semibold text-neutral-700"
        />
        <div className="min-w-0">
          {/* The name leads to the page of the runner, with their results. */}
          <p className="font-medium break-words">
            <Link
              to="/coureurs/$id"
              params={{ id: runner.id }}
              className="flex min-h-11 items-center underline-offset-2 hover:underline"
            >
              {runner.name}
            </Link>
          </p>
          {detail !== undefined && <p className="text-sm break-words text-neutral-600">{detail}</p>}
          {!confirmed && (
            <p className="text-sm text-neutral-600">
              {addedBy ? t.event.addedByUnconfirmed(addedBy.name) : t.event.unconfirmed}
            </p>
          )}
        </div>
      </div>
      {me && canEditParticipation(participation, runner, me) && (
        <ParticipationMenu
          eventId={eventId}
          participation={participation}
          runner={runner}
          label={label}
          formatsOf={formatsOf}
          canConfirm={canConfirm(runner, me)}
          onRemoved={() => {
            onDeparture(participation.id, source, row.current);
          }}
        />
      )}
    </li>
  );
}
