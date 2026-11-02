import { Link } from "@tanstack/react-router";
import { useId, useRef, type ReactNode, type RefObject } from "react";

import { Avatar } from "../../components/Avatar";
import { BlockTitle } from "../../components/BlockTitle";
import { LoadFailure } from "../../components/LoadFailure";
import { HeroArt } from "../../components/Slots";
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
      {/* A hero: the runner on the sky of the dawn drawn like a map (the skin's `HeroArt`), in front of the ridges, the sun rising behind them. */}
      <header className="runner-hero on-dawn relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] bg-dawn-hero p-5 pb-12 text-white shadow-glow md:gap-6 md:p-7 md:pb-14">
        <HeroArt place="runner" />
        {/* On the narrowest phones (under 360 px) the photo is smaller and the name scales down
            with the screen, so that a first name such as « Guillaume » or « Maximilien » fits
            beside the photo: the name wraps between its words, never inside one. Only a word
            that could not fit on a line of its own would still be broken (`break-words`). */}
        {runner && (
          <Avatar
            runner={runner}
            thumb="256x256"
            className="avatar-soft relative size-20 shrink-0 text-2xl font-extrabold shadow-[0_0_0_4px_rgb(255_255_255/0.85),0_12px_30px_-10px_rgb(36_27_53/0.6)] min-[22.5rem]:size-24 min-[22.5rem]:text-3xl md:size-28"
          />
        )}
        <h1
          ref={heading}
          tabIndex={-1}
          className="relative min-w-0 font-display text-[clamp(1.5rem,8vw,1.875rem)] leading-[1.1] font-extrabold tracking-tight break-words md:text-[2.25rem]"
        >
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
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <BlockTitle id={headingId}>{t.runner.history}</BlockTitle>
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
    <li className="card flex flex-col p-4">
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
      <p className="text-sm text-neutral-600">{f.dateLong(date)}</p>
      {result.length > 0 && (
        <p className="mt-1 self-start rounded-full bg-iris-50 px-2.5 py-1 text-sm font-semibold text-iris-800 ring-1 ring-iris-100">
          {result.join(SEPARATOR)}
        </p>
      )}
    </li>
  );
}
