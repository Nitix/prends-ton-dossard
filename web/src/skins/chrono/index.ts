import type { Skin } from "../types";

// « Chrono »: the screen of a GPS watch: ink on a cool grey page, white cards,
// and the five heart-rate zones as the only colours (the strip of the zones,
// the dial, the grid and the ruler of a chart are its motifs). By day only (the
// variant has no dark mode).

export const skin: Skin = {
  id: "chrono",
  label: { fr: "Chrono", en: "Chrono" },
  modes: ["light"],
  // The ink of its screen and the orange of its fourth zone.
  swatches: ["#101418", "#f28b30"],
  fontSample: '"Chrono Digits", "Inter Tight Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the ink of the screen.
  themeColor: "#101418",
};
