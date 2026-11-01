import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import type { ParticipationRecord } from "../../lib/types";
import { useToday } from "../../lib/useToday";
import type { EventView, FormatView, ParticipationView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { starters } from "../events/participants";

const SEPARATOR = " · ";

type Upcoming = {
  event: EventView["event"];
  /** Absent for a participation on the event alone ("format to choose"). */
  formatView?: FormatView;
  participation: ParticipationRecord;
  /** The day of the format, or the start of the event when there is no format. */
  date: Temporal.PlainDate;
};

/** The starts of the runner in the list, which is theirs and not "not starting". */
function mine(list: ParticipationView[], runnerId: string): ParticipationRecord[] {
  return starters(list)
    .filter(({ runner }) => runner.id === runnerId)
    .map(({ participation }) => participation);
}

/**
 * The participations of a runner (but the "not starting" ones) on a day that
 * is today or later, the nearest first. The day is the one of the format: on
 * an event of several days, a format that has been run is behind, whatever the
 * end of its event. A participation with no format is on the start of its
 * event: it is behind once the event has started.
 */
function upcomingOf(views: EventView[], runnerId: string, today: Temporal.PlainDate): Upcoming[] {
  const upcoming = (date: Temporal.PlainDate) => Temporal.PlainDate.compare(date, today) >= 0;
  return views
    .flatMap(({ event, formats, interested, start }) => [
      ...formats
        .filter(({ date }) => upcoming(date))
        .flatMap((formatView) =>
          mine(formatView.participations, runnerId).map((participation) => ({
            event,
            formatView,
            participation,
            date: formatView.date,
          })),
        ),
      ...(upcoming(start)
        ? mine(interested, runnerId).map((participation) => ({
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
 * « Mes prochaines courses »: what the runner of the user is down for in the
 * events that are to come, with the days left. `runnerId` is not known while
 * the runner of the user loads.
 *
 * A participation the user has not confirmed is here too, dashed and said in
 * words: it is part of their plans until they refuse it. So is one with no
 * format yet, which says « Format à choisir » where the format would be.
 */
export function MyUpcoming({
  views,
  runnerId,
}: {
  views: EventView[];
  runnerId: string | undefined;
}) {
  const { t } = useI18n();
  const today = useToday();
  const headingId = useId();
  const rows = runnerId === undefined ? undefined : upcomingOf(views, runnerId, today);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.home.upcomingTitle}
      </h2>
      {rows === undefined ? (
        <output>{t.common.loading}</output>
      ) : rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.home.upcomingEmpty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => (
            <UpcomingRow key={row.participation.id} row={row} today={today} />
          ))}
        </ul>
      )}
    </section>
  );
}

function UpcomingRow({ row, today }: { row: Upcoming; today: Temporal.PlainDate }) {
  const { t, f } = useI18n();
  const { event, formatView, participation, date } = row;
  const confirmed = participation.confirmed;
  const what = formatView
    ? formatDisplayName(formatView.format, formatView.raceType.label, f, t)
    : t.event.formatToChoose;

  return (
    <li
      className={`flex items-start justify-between gap-3 rounded-lg border-2 bg-white p-3 ${
        confirmed ? "border-neutral-200" : "border-dashed border-neutral-400"
      }`}
    >
      <div className="flex min-w-0 flex-col">
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
          {what}
          {SEPARATOR}
          {t.status[participation.status]}
        </p>
        <p className="text-sm text-neutral-600">{f.date(date)}</p>
        {!confirmed && <p className="text-sm text-neutral-600">{t.event.unconfirmed}</p>}
      </div>
      {/* The words are the countdown: nothing here is told by a colour. */}
      <p className="shrink-0 pt-3 text-sm font-medium">{f.inDays(daysBetween(today, date))}</p>
    </li>
  );
}
