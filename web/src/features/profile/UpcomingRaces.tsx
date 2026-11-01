import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import type { EventRecord, ParticipationRecord } from "../../lib/types";
import { useToday } from "../../lib/useToday";
import { useEvents, type EventView, type FormatView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { starters } from "../events/participants";
import { Section } from "./Section";

const SEPARATOR = " · ";

type Race = {
  event: EventRecord;
  /** Absent for a participation on the event alone ("format to choose", or supporter). */
  formatView?: FormatView;
  participation: ParticipationRecord;
  /** The day of the format, or the start of the event when there is no format. */
  date: Temporal.PlainDate;
};

/**
 * The participations of a runner, but the "not starting" ones, that are not
 * behind: the nearest first.
 *
 * On a format, it is the day of the format that counts: on an event of several
 * days, a race that has been run is behind, whatever the end of its event. A
 * participation on the event alone (interested with no format yet, or
 * supporter) has no day of its own: it is there until the last day of its
 * event, and sorted on the first.
 */
function upcomingRaces(views: EventView[], runnerId: string, today: Temporal.PlainDate): Race[] {
  const notBehind = (day: Temporal.PlainDate) => Temporal.PlainDate.compare(day, today) >= 0;
  const ofRunner = (list: EventView["interested"]) =>
    starters(list)
      .filter(({ runner }) => runner.id === runnerId)
      .map(({ participation }) => participation);

  return views
    .flatMap(({ event, formats, interested, supporters, start, end }): Race[] => [
      ...formats
        .filter(({ date }) => notBehind(date))
        .flatMap((formatView) =>
          ofRunner(formatView.participations).map((participation) => ({
            event,
            formatView,
            participation,
            date: formatView.date,
          })),
        ),
      ...(notBehind(end)
        ? [...ofRunner(interested), ...ofRunner(supporters)].map((participation) => ({
            event,
            participation,
            date: start,
          }))
        : []),
    ])
    .toSorted(
      (a, b) =>
        Temporal.PlainDate.compare(a.date, b.date) ||
        a.event.name.localeCompare(b.event.name) ||
        a.participation.id.localeCompare(b.participation.id),
    );
}

/**
 * « Mes prochaines courses »: what a runner is down for in the events that are
 * to come, from the nearest to the farthest, each with its day, its status and
 * a link to its event; or that there is nothing planned. The events are the
 * home page's, shared with it.
 *
 * If they do not load, it says so and offers to ask again, rather than say
 * there is nothing planned: the title takes the focus when it is asked again
 * (see `LoadFailure`).
 */
export function UpcomingRaces({ runnerId }: { runnerId: string }) {
  const { t } = useI18n();
  const today = useToday();
  const events = useEvents({ period: "a-venir", today });
  const heading = useRef<HTMLHeadingElement>(null);
  const races = events.data && upcomingRaces(events.data, runnerId, today);

  return (
    <Section title={t.profile.upcoming} headingRef={heading}>
      {/* A refresh that fails keeps what the page already shows. */}
      {races === undefined ? (
        events.isError ? (
          <LoadFailure onRetry={events.refetch} heading={heading} />
        ) : (
          <output>{t.common.loading}</output>
        )
      ) : races.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.profile.noUpcoming}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {races.map((race) => (
            <RaceRow key={race.participation.id} race={race} />
          ))}
        </ul>
      )}
    </Section>
  );
}

/**
 * A race: its event (a link to its page), the format and the status, in words,
 * and its day. A participation that the runner has not confirmed is dashed and
 * says so in words, like the home page's.
 */
function RaceRow({ race }: { race: Race }) {
  const { t, f } = useI18n();
  const { event, formatView, participation, date } = race;
  const confirmed = participation.confirmed;
  // Before the status: the format, or « Format à choisir » when there is none yet. A
  // supporter has no format to choose: only its status.
  let what: string | undefined;
  if (formatView) what = formatDisplayName(formatView.format, formatView.raceType.label, f, t);
  else if (participation.status !== "supporter") what = t.event.formatToChoose;

  return (
    <li
      className={`flex flex-col rounded-lg border-2 bg-white p-3 ${
        confirmed ? "border-neutral-200" : "border-dashed border-neutral-400"
      }`}
    >
      <h3 className="text-base font-semibold">
        <Link
          to="/evenements/$id"
          params={{ id: event.id }}
          className="flex min-h-11 items-center underline-offset-2 hover:underline"
        >
          {event.name}
        </Link>
      </h3>
      <p className="text-sm">
        {what !== undefined && `${what}${SEPARATOR}`}
        {t.status[participation.status]}
      </p>
      <p className="text-sm text-neutral-600">{f.dateLong(date)}</p>
      {!confirmed && <p className="text-sm text-neutral-600">{t.event.unconfirmed}</p>}
    </li>
  );
}
