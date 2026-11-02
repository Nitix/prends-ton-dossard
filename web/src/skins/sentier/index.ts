import type { Skin } from "../types";
import { Blaze } from "./motifs";
import { BrandMark, EmptyArt, HeaderArt, HeroArt } from "./slots";

// « Sentier »: an early-morning trail run in the mountains. Deep pine, sunrise
// orange on sand, Outfit for the titles; contour lines, ridges and a rising sun
// in the headers, the patch of a trail race for the mark, the painted blaze of
// a trail before every title. By day only. Its divider is Crête's (the same
// skyline), in its colours.

export const skin: Skin = {
  id: "sentier",
  label: { fr: "Sentier", en: "Sentier" },
  modes: ["light"],
  slots: { HeaderArt, BrandMark, HeroArt, SectionMarker: Blaze, EmptyArt },
  // The pine of its header and the orange of its sunrise.
  swatches: ["#1f5f4a", "#f28c38"],
  fontSample:
    '"Outfit Variable", "Inter Variable", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
  // The top of its header: pine.
  themeColor: "#1f5f4a",
};
