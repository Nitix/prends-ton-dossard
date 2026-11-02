import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { SECONDARY } from "../../components/buttons";
import { EmptyState } from "../../components/EmptyState";
import { useI18n } from "../../i18n/I18nProvider";
import { groupByMonth } from "../../lib/dates";
import { useToday } from "../../lib/useToday";
import { applyFilters, sortEvents, useEvents, type EventView } from "./api";
import { EventCard } from "./EventCard";
import { Filters, useFilterCriteria, type FilterCriteria } from "./Filters";
import type { ListSearch } from "./search";

/**
 * The events, a month at a time: those that are to come, from the next one,
 * or the past ones, from the latest, narrowed by the filters of the URL. The
 * app shell around it owns the page's `<main>`.
 */
export function ListPage({ search }: { search: ListSearch }) {
  const { t } = useI18n();
  const today = useToday();
  const period = search.periode ?? "a-venir";
  const { criteria, ready } = useFilterCriteria(search);
  const events = useEvents({ period, today });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 tabIndex={-1} className="page-title">
          {t.nav.list}
        </h1>
        {/* The past events are the ones that have results: the statistics are one tap away. */}
        {period === "passees" && (
          <Link to="/stats" className={`${SECONDARY} inline-flex items-center`}>
            {t.stats.link}
          </Link>
        )}
      </div>
      <Filters search={search} />
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
      ) : events.isPending || !ready ? (
        <output>{t.common.loading}</output>
      ) : (
        <Months views={events.data} criteria={criteria} period={period} />
      )}
    </div>
  );
}

/** The events that pass the filters, sorted and grouped by month, or the empty state. */
function Months({
  views,
  criteria,
  period,
}: {
  views: EventView[];
  criteria: FilterCriteria;
  period: "a-venir" | "passees";
}) {
  const { t } = useI18n();
  // groupByMonth keeps the order it is given: the events are sorted first, the
  // way the period asks for, whatever the order of the server's answer.
  const sorted = sortEvents(applyFilters(views, criteria), period === "a-venir" ? "asc" : "desc");

  if (sorted.length === 0) {
    return <EmptyState title={t.list.empty} hint={t.list.emptyHint} />;
  }
  return (
    <div className="flex flex-col gap-6">
      {groupByMonth(sorted, (view) => view.start).map(({ month, items }) => (
        <MonthSection key={month.toString()} month={month} views={items} />
      ))}
    </div>
  );
}

function MonthSection({ month, views }: { month: Temporal.PlainYearMonth; views: EventView[] }) {
  const { f } = useI18n();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="month-section flex flex-col gap-3">
      <h2 id={headingId} className="month-title">
        {f.monthTitle(month)}
      </h2>
      <ul className="event-list flex flex-col gap-3.5">
        {views.map((view) => (
          <li key={view.event.id}>
            <EventCard view={view} />
          </li>
        ))}
      </ul>
    </section>
  );
}
