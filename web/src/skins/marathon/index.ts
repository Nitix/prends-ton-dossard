import type { Skin } from "../types";

// « Marathon »: the poster of a big-city marathon: off-white paper, near-black
// ink, and the cobalt of « la ligne bleue » painted on the road, which is the
// signature of its motifs. By day only (the variant has no dark mode).

export const skin: Skin = {
  id: "marathon",
  label: { fr: "Marathon", en: "Marathon" },
  modes: ["light"],
  // The ink of its masthead and the cobalt of its line.
  swatches: ["#0b0b0c", "#2b59ff"],
  fontSample: '"Inter Tight Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the ink of the poster.
  themeColor: "#0b0b0c",
};
