import { Link } from "@tanstack/react-router";
import { useId, useRef, type ReactNode, type RefObject } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useRunners } from "../events/api";
import { dayOrMonth } from "../events/eventWhen";
import { formatDisplayName } from "../events/formatName";
import { resultParts } from "../results/resultText";
import { byYear, useResults, type ResultRow } from "../stats/stats";
import { TotalsTable } from "../stats/TotalsTable";
import { RunnerHero } from "./RunnerHero";

const SEPARATOR = " · ";

/**
 * A runner as the group sees them: their photo and name, their results year by
 * year, then every race they started. It is the body of the page of a runner
 * (`RunnerPage`) and of the profile of the user (`ProfilePage`), which are the
 * same page with what each adds in `extra`, between the name and the results.
 * The runners come from the list the filters use, which everybody may read. The
 * app shell around it owns the page's `<main>`.
 *
 * The title is the one element that stays from the first draw to the last: the
 * name of the runner once it is known, the word « Runner » before. A failure
 * that is asked for again gives it the focus (see `LoadFailure`), so that the
 * focus never falls to the page, whichever request failed.
 */
export function RunnerProfile({ runnerId, extra }: { runnerId: string; extra?: ReactNode }) {
  const { t } = useI18n();
  const runners = useRunners();
  const heading = useRef<HTMLHeadingElement>(null);
  const runner = runners.data?.find((candidate) => candidate.id === runnerId);

  return (
    <div className="flex flex-col gap-8">
      {/* The hero: the photo and the name of the runner, the title of the page (see RunnerHero). */}
      <RunnerHero runner={runner} heading={{ ref: heading, tabIndex: -1 }} />
      {extra}
      {/* A refresh that fails keeps what the page already shows. */}
      {runner ? (
        <Results runnerId={runner.id} heading={heading} />
      ) : runners.isError ? (
        <LoadFailure onRetry={runners.refetch} heading={heading} />
      ) : (
        <output>{t.common.loading}</output>
      )}
    </div>
  );
}

/** The year by year and the history of a runner: what they started, or that they have not yet. */
function Results({
  runnerId,
  heading,
}: {
  runnerId: string;
  heading: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const results = useResults(runnerId);

  // A refresh that fails keeps what the page already shows.
  if (!results.data) {
    return results.isError ? (
      <LoadFailure onRetry={results.refetch} heading={heading} />
    ) : (
      <output>{t.common.loading}</output>
    );
  }
  const rows = results.data;

  return (
    <>
      {rows.length > 0 && <Years rows={rows} />}
      <History rows={rows} />
    </>
  );
}

/** « Bilan par année »: a line a year, the latest first. */
function Years({ rows }: { rows: ResultRow[] }) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-block="years"
      className="page-block flex flex-col gap-3"
    >
      <BlockTitle id={headingId}>{t.runner.years}</BlockTitle>
      <TotalsTable
        caption={t.runner.years}
        firstColumn={t.stats.year}
        lines={byYear(rows).map(({ year, totals }) => ({
          key: String(year),
          head: year,
          totals,
        }))}
      />
    </section>
  );
}

/** « Historique »: every race the runner started, the latest first (the order of `rows`). */
function History({ rows }: { rows: ResultRow[] }) {
  const { t } = useI18n();
  const headingId = useId();

  return (
    <section
      aria-labelledby={headingId}
      data-block="history"
      className="page-block flex flex-col gap-3"
    >
      <BlockTitle id={headingId}>{t.runner.history}</BlockTitle>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.runner.noHistory}</p>
      ) : (
        <ul className="race-list flex flex-col gap-2">
          {rows.map((row) => (
            <HistoryRow key={row.participation.id} row={row} />
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * A race: its event (a link to its page), the race and how it ended, in words,
 * its day, and what is known of the result (the time, the rank, the note).
 */
function HistoryRow({ row }: { row: ResultRow }) {
  const { t, f } = useI18n();
  const { participation, event, format, raceType, date } = row;
  const result = resultParts(participation, f, t);

  return (
    <li className="history-row card flex flex-col p-4">
      <h3 className="card-title">
        <Link
          to="/evenements/$id"
          params={{ id: event.id }}
          className="flex min-h-11 items-center underline-offset-4 hover:text-iris-700 hover:underline"
        >
          {event.name}
        </Link>
      </h3>
      <p className="text-sm">
        {formatDisplayName(format, raceType.label, f, t)}
        {SEPARATOR}
        {t.status[participation.status]}
      </p>
      <p className="text-sm text-neutral-600">{dayOrMonth(event, date, f, t, "long")}</p>
      {result.length > 0 && (
        <p className="result-tag mt-1 self-start rounded-full bg-iris-50 px-2.5 py-1 text-sm font-semibold text-iris-800 ring-1 ring-iris-100">
          {result.join(SEPARATOR)}
        </p>
      )}
    </li>
  );
}
