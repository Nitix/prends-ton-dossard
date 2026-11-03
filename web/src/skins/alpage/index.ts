import type { Skin } from "../types";

// « Alpage »: « Sentier » in « Aurore »'s layout, in the gradients of the
// forest: deep pine brightening into emerald and fresh moss, the sun coming up
// orange behind the ridges, Outfit for the titles. Its art is « Sentier »'s
// (the blaze before every title is the same piece), in forest greens; its
// divider is Crête's (the same skyline). By day only.

export const skin: Skin = {
  id: "alpage",
  label: { fr: "Alpage", en: "Alpine meadow" },
  modes: ["light"],
  // The deep forest of its main buttons and the orange of its sunrise.
  swatches: ["#174f3e", "#f28c38"],
  fontSample:
    '"Outfit Variable", "Inter Variable", ui-sans-serif, system-ui, -apple-system, sans-serif',
  // The top of its header: the deep pine of the sky.
  themeColor: "#0f3027",
};
