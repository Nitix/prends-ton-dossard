import { Link } from "@tanstack/react-router";
import { useId, useRef, type ReactNode, type RefObject } from "react";

import { Avatar } from "../../components/Avatar";
import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import { useRunners } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { resultParts } from "../results/resultText";
import { byYear, useResults, type ResultRow } from "../stats/stats";
import { TotalsTable } from "../stats/TotalsTable";

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
      <header className="flex items-center gap-4">
        {runner && (
          <Avatar
            runner={runner}
            thumb="256x256"
            className="size-24 shrink-0 bg-neutral-200 text-3xl font-semibold text-neutral-700"
          />
        )}
        <h1 ref={heading} tabIndex={-1} className="text-2xl font-semibold break-words">
          {runner ? runner.name : t.runner.title}
        </h1>
      </header>
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.runner.years}
      </h2>
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-lg font-semibold">
        {t.runner.history}
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">{t.runner.noHistory}</p>
      ) : (
        <ul className="flex flex-col gap-2">
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
    <li className="flex flex-col rounded-lg border-2 border-neutral-200 bg-white p-3">
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
        {formatDisplayName(format, raceType.label, f, t)}
        {SEPARATOR}
        {t.status[participation.status]}
      </p>
      <p className="text-sm text-neutral-600">{f.dateLong(date)}</p>
      {result.length > 0 && <p className="text-sm">{result.join(SEPARATOR)}</p>}
    </li>
  );
}
