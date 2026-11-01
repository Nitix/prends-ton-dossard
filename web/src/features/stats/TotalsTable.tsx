import type { ReactNode } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Totals } from "./stats";

/** A line of a table of totals: what it is about (a runner, a year) and its totals. */
export type TotalsLine = { key: string; head: ReactNode; totals: Totals };

const NUMBER_COLUMN = "px-1.5 py-2 text-right tabular-nums";

/**
 * What is to be shown of a total that is not a count: nothing given adds up to
 * 0, which is not a distance, an elevation gain or a time of 0.
 */
const NONE = "–";

/**
 * The totals of races (finished, abandoned, kilometers, elevation gain and
 * time), one line each, with the header of the first column to say what a line
 * is about. A line is headed by its first cell, a column by its title, and the
 * table has a caption that the page does not show (`sr-only`: the title of the
 * page above says as much). On a narrow screen it scrolls sideways rather than
 * squeezing the numbers.
 */
export function TotalsTable({
  caption,
  firstColumn,
  lines,
}: {
  caption: string;
  firstColumn: string;
  lines: TotalsLine[];
}) {
  const { t, f } = useI18n();

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b-2 border-neutral-300">
            <th scope="col" className="px-1.5 py-2 font-semibold">
              {firstColumn}
            </th>
            {[t.stats.finished, t.stats.dnf, t.stats.km, t.stats.elevation, t.stats.time].map(
              (title) => (
                <th key={title} scope="col" className={`${NUMBER_COLUMN} font-semibold`}>
                  {title}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {lines.map(({ key, head, totals }) => (
            <tr key={key} className="border-b border-neutral-200">
              <th scope="row" className="px-1.5 py-0.5 text-left font-medium">
                {head}
              </th>
              <td className={NUMBER_COLUMN}>{totals.finished}</td>
              <td className={NUMBER_COLUMN}>{totals.dnf}</td>
              <td className={NUMBER_COLUMN}>{totals.km > 0 ? f.km(totals.km) : NONE}</td>
              <td className={NUMBER_COLUMN}>
                {totals.elevation > 0 ? f.meters(totals.elevation) : NONE}
              </td>
              <td className={NUMBER_COLUMN}>
                {totals.seconds > 0 ? f.raceTime(totals.seconds) : NONE}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
