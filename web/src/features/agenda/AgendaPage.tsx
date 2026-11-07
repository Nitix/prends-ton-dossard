import { Link, useNavigate } from "@tanstack/react-router";
import { useId } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { SECONDARY } from "../../components/buttons";
import { EmptyState } from "../../components/EmptyState";
import { useI18n } from "../../i18n/I18nProvider";
import { isMonthOnly, monthGrid } from "../../lib/dates";
import { usePageTitle } from "../../lib/usePageTitle";
import { useToday } from "../../lib/useToday";
import { applyFilters, sortEvents, useEvents, type EventView } from "../events/api";
import { Filters, useFilterCriteria } from "../events/Filters";
import { DayList } from "./DayList";
import { eventsByDay } from "./eventsByDay";
import { MonthGrid } from "./MonthGrid";
import type { AgendaSearch } from "./search";

/**
 * The events, a month at a time, in a grid: the month and the day chosen are
 * in the URL (`mois`, `jour`), next to the filters of the list. The app shell
 * around it owns the page's `<main>`.
 *
 * The grid is always there, so that changing the month or the filters does
 * not make the page jump: it fills in when the events arrive.
 */
export function AgendaPage({ search }: { search: AgendaSearch }) {
  const { t, f } = useI18n();
  const today = useToday();
  const navigate = useNavigate();
  const headingId = useId();
  const { criteria, ready } = useFilterCriteria(search);

  // Anything that is not a month was dropped from the search (see
  // `validateAgendaSearch`): the month is the current one then.
  const month = search.mois ? Temporal.PlainYearMonth.from(search.mois) : today.toPlainYearMonth();
  usePageTitle(t.titles.calendar(f.monthTitle(month)));
  const weeks = monthGrid(month, f.firstDayOfWeek());
  const days = weeks.flat();
  // The grid reaches into the neighbouring months: so do the events asked for.
  const events = useEvents({ from: firstOf(days), to: lastOf(days) });

  // Nothing is shown of events that are not there yet, nor of those that the
  // filters cannot be applied to yet (`moi` would show everybody's for an instant).
  const data = events.isError ? undefined : events.data;
  const loaded = data !== undefined && ready;
  const views = loaded ? sortEvents(applyFilters(data, criteria), "asc") : [];
  const byDay = eventsByDay(views, days);
  // The races of the shown month whose day is not known: on no day of the grid.
  const monthOnly = views.filter(
    (view) => isMonthOnly(view.event) && view.start.toPlainYearMonth().equals(month),
  );
  // A day outside the grid cannot be chosen.
  const selected = search.jour !== undefined && byDay.has(search.jour) ? search.jour : undefined;

  // The day chosen is a view of the page, not a place of its own: no history
  // entry. Touching it again lets it go.
  const select = (day: Temporal.PlainDate) => {
    const key = day.toString();
    void navigate({
      to: ".",
      replace: true,
      search: (previous) => ({ ...previous, jour: search.jour === key ? undefined : key }),
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 tabIndex={-1} className="page-title">
        {t.nav.calendar}
      </h1>
      <Filters search={search} withPeriod={false} />
      <section className="agenda-month flex flex-col gap-3">
        <div className="month-nav flex items-center justify-between gap-2">
          <MonthLink target={month.subtract({ months: 1 })} label={t.agenda.previous} glyph="‹" />
          <h2
            id={headingId}
            aria-live="polite"
            className="month-nav-title font-display text-xl font-extrabold display-title first-letter:uppercase"
          >
            {f.monthTitle(month)}
          </h2>
          <MonthLink target={month.add({ months: 1 })} label={t.agenda.next} glyph="›" />
        </div>
        {monthOnly.length > 0 && <MonthOnlyBlock views={monthOnly} />}
        <MonthGrid
          weeks={weeks}
          month={month}
          byDay={byDay}
          today={today}
          selected={selected}
          labelledBy={headingId}
          busy={!events.isError && !loaded}
          onSelect={select}
        />
      </section>
      {events.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void events.refetch()}
            disabled={events.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : !loaded ? (
        <output>{t.common.loading}</output>
      ) : views.length === 0 ? (
        <EmptyState title={t.list.empty} hint={t.list.emptyHint} />
      ) : (
        <DayList
          day={selected === undefined ? undefined : Temporal.PlainDate.from(selected)}
          views={byDay.get(selected ?? "") ?? []}
        />
      )}
    </div>
  );
}

/** « Ce mois-ci, date à préciser »: the races of the month with no day, each a link to its page. */
function MonthOnlyBlock({ views }: { views: EventView[] }) {
  const { t } = useI18n();
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="agenda-month-only flex flex-col gap-2">
      <BlockTitle id={headingId}>{t.agenda.monthToBeSet}</BlockTitle>
      <ul className="flex flex-col gap-1">
        {views.map((view) => (
          <li key={view.event.id}>
            <Link
              to="/evenements/$id"
              params={{ id: view.event.id }}
              className="flex min-h-11 items-center underline underline-offset-4 hover:text-iris-700"
            >
              {view.event.name}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A grid always has weeks, and a week has days. */
function firstOf(days: Temporal.PlainDate[]): Temporal.PlainDate {
  const day = days[0];
  if (!day) throw new RangeError("the grid of a month has no days");
  return day;
}

function lastOf(days: Temporal.PlainDate[]): Temporal.PlainDate {
  const day = days.at(-1);
  if (!day) throw new RangeError("the grid of a month has no days");
  return day;
}

/**
 * An arrow to the month before or after: a link, so that it has an address and
 * the back button comes back to the month. The day chosen belongs to its month,
 * so it goes with it; the filters stay.
 */
function MonthLink({
  target,
  label,
  glyph,
}: {
  target: Temporal.PlainYearMonth;
  label: string;
  glyph: string;
}) {
  return (
    <Link
      to="."
      search={(previous) => ({ ...previous, mois: target.toString(), jour: undefined })}
      aria-label={label}
      className="nav-arrow press flex size-11 items-center justify-center rounded-full border border-neutral-200 bg-card text-2xl leading-none text-iris-700 shadow-card hover:bg-iris-50"
    >
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}
