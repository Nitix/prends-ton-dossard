import { FormatParts } from "../../features/events/FormatLine";
import type { CountdownRingProps, FormatTitleProps, TrackFiguresProps, Variants } from "../types";
import { raceTypeZone, WatchRing, ZoneBar } from "./watch";

// « Chrono », depth full: the pieces whose markup the variant really changes,
// beyond those of mix.tsx. The title of a format has the bar of the zone of its
// kind of race before it, the figures of a track are in the mono face, and the
// days left are the ring of a watch (on the zone of how soon the day is). Each
// keeps every word of Crête's piece, in its order, and a picture says nothing
// to a screen reader. What these import is only used while they render (see
// ../README.md).

const SEPARATOR = " · ";

/**
 * The words of the title of a format on the page of an event, after the bar of
 * the zone of its kind of race (taller than on a card, a picture): the name and
 * the measures, as Crête's title has them. A kind the admin added that has no
 * zone has a grey bar: its name is written.
 */
function ZonedTitle({ formatView, parts }: FormatTitleProps) {
  return (
    <span className="format-title flex min-w-0 items-center gap-2.5">
      <FormatParts
        parts={parts}
        marks={{
          before: (
            <ZoneBar zone={raceTypeZone(formatView.raceType.label)} className="h-5 w-[5px]" />
          ),
        }}
      />
    </span>
  );
}

/** The figures of a track, one line in the mono face; the lowest and highest points under it. */
function MonoFigures({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-mono text-lg font-semibold tracking-tight">
        {figures.join(SEPARATOR)}
      </p>
      {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
    </>
  );
}

/**
 * The days left, as the ring of a watch: it closes as the day comes, on the zone
 * of how soon it is. A picture: the words beside it (`.days-left`) say the days.
 */
function SilentRing({ days, tone = "color", className }: CountdownRingProps) {
  const light = tone === "light";
  return (
    <WatchRing days={days} size={light ? 56 : 48} light={light} silent className={className} />
  );
}

export const variants: Variants = {
  FormatTitle: ZonedTitle,
  TrackFigures: MonoFigures,
  CountdownRing: SilentRing,
};
