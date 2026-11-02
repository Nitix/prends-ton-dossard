import { FormatParts, type FormatMarks } from "../../features/events/FormatLine";
import type { CountdownRingProps, FormatTitleProps, TrackFiguresProps, Variants } from "../types";
import { DotFrance } from "./illustrations";
import { DotRing, KindMark } from "./marks";

// « Carnet », depth full: the pieces whose markup the variant really changes,
// beyond those of mix.tsx. The title of a format has the square of its kind of
// race before it, the figures of a track are set as under a product shot (the
// first in ink, the others quieter, dotted France beside them with a mark where
// the track starts), and the days left are the ring of dots. Each keeps every
// word of Crête's piece, in its order, and a picture says nothing to a screen
// reader. What these import is only used while they render (see ../README.md).

const SEPARATOR = " · ";

/** The name of a format in ink, its measures quieter. */
const QUIET: FormatMarks = {
  name: (name) => <span className="format-name font-semibold text-ink">{name}</span>,
  measure: (measure) => (
    <span className="format-measures ml-2 font-medium text-neutral-600">{measure}</span>
  ),
};

/**
 * The words of the title of a format on the page of an event, after the square
 * of its kind of race (a picture, its name written in the words): the name in
 * ink, the measures quieter. The separators stay in the text, for a screen
 * reader and a copy.
 */
function KindTitle({ formatView, parts }: FormatTitleProps) {
  return (
    <span className="format-title flex min-w-0 items-baseline gap-2.5">
      <FormatParts
        parts={parts}
        marks={{ ...QUIET, before: <KindMark label={formatView.raceType.label} /> }}
      />
    </span>
  );
}

/**
 * The figures of a track, as under a product shot: the length in ink, the gain
 * and the loss quieter, on one line (the separators are in the text), the
 * lowest and highest points under it; dotted France is beside them, with a mark
 * of coral where the track starts when its first point is known.
 */
function ShotFigures({ figures, altitude, start }: TrackFiguresProps) {
  const [first, ...rest] = figures;
  return (
    <div className="route-shot flex items-start justify-between gap-4">
      <div className="flex min-w-0 flex-col gap-1">
        <p className="route-figures text-[1.0625rem] leading-snug tracking-[-0.01em] md:text-xl">
          <span className="font-semibold text-ink">{first}</span>
          {rest.map((figure) => (
            <span key={figure} className="text-neutral-600">{`${SEPARATOR}${figure}`}</span>
          ))}
        </p>
        {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
      </div>
      {start && <DotFrance at={start} className="-mt-0.5 w-16 shrink-0 md:w-20" />}
    </div>
  );
}

/** The days left, as the ring of dots that a line closes as the day comes: a picture, the words beside it say the days. */
function SilentRing({ days, tone = "color", className }: CountdownRingProps) {
  const light = tone === "light";
  return <DotRing days={days} size={light ? 56 : 44} light={light} silent className={className} />;
}

export const variants: Variants = {
  FormatTitle: KindTitle,
  TrackFigures: ShotFigures,
  CountdownRing: SilentRing,
};
