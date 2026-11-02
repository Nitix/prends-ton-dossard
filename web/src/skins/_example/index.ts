import type { Skin } from "../types";

// A skin of development, to see the mechanism at work without a real skin: a
// palette that is plainly fake (green and yellow), in light only, and two
// motifs of its own (Crête's stand in for the others).
// Its folder starts with `_`: the app has it in development and in the tests,
// never in a build (see ../README.md).

export const skin: Skin = {
  id: "_example",
  label: { fr: "Exemple (dev)", en: "Example (dev)" },
  modes: ["light"],
  swatches: ["#0b7a5e", "#fde68a"],
  // Crête's titles: it has no fonts of its own (a skin of development declares no face).
  fontSample:
    '"Plus Jakarta Sans Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  themeColor: "#08634c",
};
