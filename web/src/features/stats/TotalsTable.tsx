// The roles of the table are written out on purpose: on a phone the table is
// laid out as cards (its display changes), and the roles keep it a table for a
// screen reader in every browser.
/* oxlint-disable jsx-a11y/no-redundant-roles, jsx-a11y/no-interactive-element-to-noninteractive-role */
import type { ReactNode } from "react";

import { Figure } from "../../components/Figure";
import { useI18n } from "../../i18n/I18nProvider";
import type { Totals } from "./stats";

/** A line of a table of totals: what it is about (a runner, a year) and its totals. */
export type TotalsLine = { key: string; head: ReactNode; totals: Totals };

/**
 * What is to be shown of a total that is not a count: nothing given adds up to
 * 0, which is not a distance, an elevation gain or a time of 0.
 */
const NONE = "–";

// On a phone, a line is a card: its head across, then its numbers as tiles,
// each with the title of its column (which a screen reader has from the
// header of the column already: the title in the tile is hidden from it). From
// `sm`, a table as usual. Under 360 px a tile is 84 px wide: its sides are
// narrower there, for « 45 230 m » (70 px, its spaces widened by `Figure`) and
// « ABANDONS » (65 px) to fit.
const CELL =
  "stat-tile flex flex-col-reverse rounded-xl bg-neutral-50 px-1.5 py-2 text-left tabular-nums min-[22.5rem]:px-2.5 sm:table-cell sm:rounded-none sm:bg-transparent sm:px-2 sm:py-2.5 sm:text-right";
const VALUE =
  "font-display text-base font-extrabold text-ink sm:font-sans sm:text-sm sm:font-medium";
const TILE_TITLE = "eyebrow text-[0.625rem] sm:hidden";

/**
 * The totals of races (finished, abandoned, kilometers, elevation gain and
 * time), one line each, with the header of the first column to say what a line
 * is about. A line is headed by its first cell, a column by its title, and the
 * table has a caption that the page does not show (`sr-only`: the title of the
 * page above says as much).
 *
 * On a phone, each line is a card of tiles rather than a row that scrolls
 * sideways. The roles of the table are given explicitly, so that it stays a
 * table for a screen reader whatever its look.
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
  const titles = [t.stats.finished, t.stats.dnf, t.stats.km, t.stats.elevation, t.stats.time];

  return (
    <div className="sm:overflow-hidden sm:rounded-[1.25rem] sm:border sm:border-neutral-200/80 sm:bg-card sm:p-1.5 sm:shadow-card">
      <table role="table" className="block w-full border-collapse text-left text-sm sm:table">
        <caption className="sr-only">{caption}</caption>
        <thead role="rowgroup" className="max-sm:sr-only">
          <tr role="row">
            <th role="columnheader" scope="col" className="eyebrow px-3 py-2.5 text-left">
              {firstColumn}
            </th>
            {titles.map((title) => (
              <th
                key={title}
                role="columnheader"
                scope="col"
                className="eyebrow px-2 py-2.5 text-right"
              >
                {title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody role="rowgroup" className="flex flex-col gap-2.5 sm:table-row-group">
          {lines.map(({ key, head, totals }) => {
            const values = [
              totals.finished,
              totals.dnf,
              totals.km > 0 ? f.km(totals.km) : NONE,
              totals.elevation > 0 ? f.meters(totals.elevation) : NONE,
              totals.seconds > 0 ? f.raceTime(totals.seconds) : NONE,
            ];
            return (
              <tr
                key={key}
                role="row"
                className="card grid grid-cols-3 gap-1.5 p-3 sm:table-row sm:rounded-none sm:border-0 sm:border-t sm:border-neutral-100 sm:bg-transparent sm:p-0 sm:shadow-none sm:first:border-t-0 sm:hover:bg-neutral-50"
              >
                <th
                  scope="row"
                  role="rowheader"
                  className="col-span-3 px-1 pb-1 text-left font-display text-[1.0625rem] font-bold sm:px-3 sm:py-0.5 sm:font-sans sm:text-sm sm:font-semibold"
                >
                  {head}
                </th>
                {values.map((value, i) => (
                  <td
                    key={titles[i]}
                    role="cell"
                    className={`${CELL} ${i === values.length - 1 ? "col-span-2" : ""}`}
                  >
                    <Figure className={VALUE}>{String(value)}</Figure>
                    <span aria-hidden="true" className={TILE_TITLE}>
                      {titles[i]}
                    </span>
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
