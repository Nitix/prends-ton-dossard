import { Fragment } from "react";

import { Figure } from "../../components/Figure";
import type { TrackFiguresProps, Variants } from "../types";

// « Dossard », depth full: the pieces whose markup the variant of v4
// (design/v4-dossard) draws its own way: the figures of a track set in Archivo as
// one line, like the number of a bib, and no ring of the days left (the words
// beside it say them, in a pill of the colour of the block: full.css; the big
// bib of an event has its number). The bib card and the big bib are mix.tsx's.
// Each keeps every text. Nothing here runs when the module is evaluated
// (README, « Markup variants »).

const SEPARATOR = " · ";

/**
 * The figures of a track as one line in the display face, in Archivo as the
 * number of a bib (« 12,6 km · 724 m D+ · 728 m D− »), and the altitudes under
 * them. Every figure and its separator are in the text.
 */
function BibFigures({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-display text-lg font-extrabold tabular-nums">
        {figures.map((figure, i) => (
          <Fragment key={figure}>
            {i > 0 && <span className="text-neutral-500">{SEPARATOR}</span>}
            <Figure>{figure}</Figure>
          </Fragment>
        ))}
      </p>
      {altitude !== null && (
        <p className="route-altitude -mt-2 text-sm text-neutral-600">{altitude}</p>
      )}
    </>
  );
}

/**
 * No ring: the days left are in words, in a pill (`.days-left`), and the ring
 * would only repeat them.
 */
function NoRing() {
  return null;
}

export const variants: Variants = { TrackFigures: BibFigures, CountdownRing: NoRing };
