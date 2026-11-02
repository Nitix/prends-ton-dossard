import type { Skin } from "../types";
import { ExampleDivider, ExampleMarker } from "./motifs";

// A skin of development, to see the mechanism at work without a real variant:
// a palette that is plainly fake (green and yellow), in light only, two motifs
// of its own (Crête's stand in for the others), and a line of CSS at each depth.
// Its folder starts with `_`: the app has it in development and in the tests,
// never in a build (see ../README.md).

export const skin: Skin = {
  id: "_example",
  label: { fr: "Exemple (dev)", en: "Example (dev)" },
  modes: ["light"],
  slots: { SectionMarker: ExampleMarker, Divider: ExampleDivider },
  swatches: ["#0b7a5e", "#fde68a"],
  fontSample: '"Example Display", ui-serif, Georgia, serif',
  themeColor: "#08634c",
};
