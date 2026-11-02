import type { FormatView } from "../../features/events/api";
import { terrainOf } from "../sentier/terrain";
import type { FormatDecor, VariantPropsOf, Variants } from "../types";

// « Alpage », depth full: the one piece of its variant whose markup differs from
// Crête's, its card. « Alpage » is « Sentier » in « Aurore »'s layout, which is
// Crête's, so the card is Crête's own (its `Base`), but for its formats: each is
// a panel on the tint of its terrain (the road, the forest, the high mountain…),
// a point of the terrain before its words. `decorFormat` gives the base the
// terrain of each format, read from the label of its race type by « Sentier »'s
// `terrainOf` (../sentier/terrain.ts, which holds the file), and the point; the
// base puts the terrain on the format as `data-format-kind`, and full.css paints
// the tint and the point from the palette. What this module imports from the app
// it uses while it renders, never when it is evaluated.

/** An event in a list: Crête's card, its formats marked with their terrain. */
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

export const variants: Variants = { EventCard: TerrainCard };
