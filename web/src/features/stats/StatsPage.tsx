import { Link } from "@tanstack/react-router";
import { useRef } from "react";

import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { StatsSearch } from "./search";
import { byRunner, useResults, type ResultRow } from "./stats";
import { TotalsTable } from "./TotalsTable";

/**
 * The statistics of a year, runner by runner: the year is in the URL (`annee`,
 * the current one when it is absent), with an arrow on each side to go to the
 * one before and the one after. The app shell around it owns the page's
 * `<main>`.
 *
 * The results of all the years are asked for once: changing the year only
 * changes what is read from them. When they could not be read and the member asks
 * again, the title takes the focus (see `LoadFailure`).
 */
export function StatsPage({ search }: { search: StatsSearch }) {
  const { t } = useI18n();
  const today = useToday();
  const year = search.annee ?? today.year;
  const results = useResults();
  const heading = useRef<HTMLHeadingElement>(null);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <YearLink year={year - 1} label={t.stats.previousYear} glyph="‹" />
        {/* Moving to another year with an arrow does not move the focus: the new title is read out. */}
        <h1 ref={heading} tabIndex={-1} aria-live="polite" className="text-2xl font-semibold">
          {t.stats.yearTitle(year)}
        </h1>
        <YearLink year={year + 1} label={t.stats.nextYear} glyph="›" />
      </div>
      {/* A refresh that fails keeps what the page already shows. */}
      {results.data ? (
        <Year results={results.data} year={year} />
      ) : results.isError ? (
        <LoadFailure onRetry={results.refetch} heading={heading} />
      ) : (
        <output>{t.common.loading}</output>
      )}
    </div>
  );
}

/** The runners who have a result this year, or the empty state. */
function Year({ results, year }: { results: ResultRow[]; year: number }) {
  const { t } = useI18n();
  const rows = byRunner(results, year);

  // An `<output>` is a `status`: it is said to a screen reader, as the arrows change
  // the year without moving the focus.
  if (rows.length === 0) return <output className="font-medium">{t.stats.empty}</output>;
  return (
    <TotalsTable
      caption={t.stats.yearTitle(year)}
      firstColumn={t.stats.runner}
      lines={rows.map(({ runner, totals }) => ({
        key: runner.id,
        head: (
          <Link
            to="/coureurs/$id"
            params={{ id: runner.id }}
            className="flex min-h-11 items-center underline-offset-2 hover:underline"
          >
            {runner.name}
          </Link>
        ),
        totals,
      }))}
    />
  );
}

/**
 * An arrow to the year before or after: a link, so that it has an address and
 * the back button comes back to the year.
 */
function YearLink({ year, label, glyph }: { year: number; label: string; glyph: string }) {
  return (
    <Link
      to="."
      search={{ annee: year }}
      aria-label={label}
      className="flex size-11 shrink-0 items-center justify-center rounded-lg border border-neutral-300 bg-white text-2xl leading-none"
    >
      <span aria-hidden="true">{glyph}</span>
    </Link>
  );
}
