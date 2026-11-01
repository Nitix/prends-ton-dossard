import { Link } from "@tanstack/react-router";
import { useId } from "react";

import { Avatar } from "../../components/Avatar";
import { SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import type { RunnerRecord } from "../../lib/types";
import { useToday } from "../../lib/useToday";
import { useEvents, useRunners } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { UpcomingSection } from "../home/MyUpcoming";
import { resultParts } from "../results/resultText";
import { byYear, useResults, type ResultRow } from "../stats/stats";
import { TotalsTable } from "../stats/TotalsTable";

const SEPARATOR = " · ";

/** A failed request: the message, and the button that asks again. */
function Failure({ onRetry, retrying }: { onRetry: () => void; retrying: boolean }) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col gap-3">
      <p role="alert" className="text-sm font-medium text-red-700">
        {t.errors.generic}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={retrying}
        className={`${SECONDARY} self-start disabled:opacity-60`}
      >
        {t.common.retry}
      </button>
    </div>
  );
}

/**
 * The page of a runner: their photo and name, what they are down for in the
 * events to come, their results year by year, then every race they started.
 * The runners come from the list the filters use, which everybody may read. The
 * app shell around it owns the page's `<main>`.
 */
export function RunnerPage({ id }: { id: string }) {
  const { t } = useI18n();
  const runners = useRunners();
  const runner = runners.data?.find((candidate) => candidate.id === id);

  // A refresh that fails keeps what the page already shows.
  if (runner) return <RunnerContent runner={runner} />;
  if (runners.isError) {
    return (
      <Failure
        onRetry={() => {
          void runners.refetch();
        }}
        retrying={runners.isFetching}
      />
    );
  }
  // The list is there and the runner is not in it: gone, or never was.
  if (runners.data) {
    return (
      <p role="alert" className="text-sm font-medium text-red-700">
        {t.errors.not_found}
      </p>
    );
  }
  return <output>{t.common.loading}</output>;
}

function RunnerContent({ runner }: { runner: RunnerRecord }) {
  const { t } = useI18n();
  const today = useToday();
  // The same request as the home page's: the events that are to come, shared.
  const events = useEvents({ period: "a-venir", today });

  return (
    <div className="flex flex-col gap-8">
      <header className="flex items-center gap-4">
        <Avatar
          runner={runner}
          thumb="256x256"
          className="size-24 shrink-0 bg-neutral-200 text-3xl font-semibold text-neutral-700"
        />
        <h1 className="text-2xl font-semibold break-words">{runner.name}</h1>
      </header>
      {/* Not worth a message when it fails: the races to come are on the pages of their events all the same. */}
      {events.data && (
        <UpcomingSection views={events.data} runnerId={runner.id} title={t.runner.upcoming} />
      )}
      <Results runnerId={runner.id} />
    </div>
  );
}

/** The year by year and the history of a runner: what they started, or that they have not yet. */
function Results({ runnerId }: { runnerId: string }) {
  const { t } = useI18n();
  const results = useResults(runnerId);

  // A refresh that fails keeps what the page already shows.
  if (!results.data) {
    return results.isError ? (
      <Failure
        onRetry={() => {
          void results.refetch();
        }}
        retrying={results.isFetching}
      />
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
