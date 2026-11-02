import { EmptyArt } from "../../components/Slots";
import type { FormatView } from "../../features/events/api";
import type { FormatDecor, VariantPropsOf, Variants } from "../types";
import { terrainOf } from "./terrain";

// « Sentier », depth full: the pieces of its variant whose markup differs from
// Crête's, over the two heroes of mix.tsx. Its card is Crête's, each format
// marked with its terrain (a chip in full.css); the title of a format says its
// terrain (the band on the edge of its section, in full.css); the figures of a
// track are one line of pine; an empty list is a quiet card with a map of the
// mountains; and the ring of the days left draws nothing (the hero writes the
// days, mix.tsx; the rows have their badge: full.css). Everything the base shows
// is here (see ../README.md, « Markup variants »); only the markup differs. What
// these modules import from the app they use while they render, never when they
// are evaluated.

/**
 * An event in a list, as Crête draws it (it is the card's own markup, through its
 * `Base`), each format marked with its terrain: `kind` is the terrain, put on the
 * format as `data-format-kind`, and `marks` a point of it before the words of its
 * line. The mark and the tint of the chip are in full.css, from the palette. The
 * layout of the variant (the day beside the whole column) is full.css's too.
 */
function TerrainCard({ Base, ...props }: VariantPropsOf<"EventCard">) {
  return <Base {...props} decorFormat={markTerrain} />;
}

function markTerrain(formatView: FormatView): FormatDecor {
  return {
    kind: terrainOf(formatView.raceType.label),
    marks: {
      before: (
        <span
          aria-hidden="true"
          className="terrain-mark size-2 shrink-0 -translate-y-px self-center rounded-full"
        />
      ),
    },
  };
}

/**
 * The words of the title of a format, as Crête draws them, in a box that says
 * the terrain of the format (`data-terrain`, no box of its own: `contents`):
 * full.css draws the band of that terrain on the edge of the section that holds it.
 */
function TerrainTitle({ Base, ...props }: VariantPropsOf<"FormatTitle">) {
  return (
    <span data-terrain={terrainOf(props.formatView.raceType.label)} className="contents">
      <Base {...props} />
    </span>
  );
}

/** The figures of a track as one line of pine (length, gain, loss), then its altitudes. */
function FiguresLine({ figures, altitude }: VariantPropsOf<"TrackFigures">) {
  return (
    <>
      <p className="route-figures font-display text-lg font-semibold text-iris-800 tabular-nums">
        {figures.join(" · ")}
      </p>
      {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
    </>
  );
}

/** What a list says when it has nothing: a quiet card, its map of the mountains at the left of its words. */
function EmptyTrail({ title, hint }: VariantPropsOf<"EmptyState">) {
  return (
    <div className="empty-state card relative isolate flex items-start gap-3 overflow-hidden p-4 text-left">
      <EmptyArt />
      <div className="flex min-w-0 flex-col gap-1 self-center">
        <p className="card-title">{title}</p>
        <p className="text-sm text-neutral-700">{hint}</p>
      </div>
    </div>
  );
}

/**
 * The ring of the days left, drawn as nothing: the words beside it say the days.
 */
function NoRing() {
  return null;
}

export const variants: Variants = {
  EventCard: TerrainCard,
  FormatTitle: TerrainTitle,
  TrackFigures: FiguresLine,
  EmptyState: EmptyTrail,
  // The words beside it say the days left (a badge, in full.css): « Sentier » has no ring.
  CountdownRing: NoRing,
};
