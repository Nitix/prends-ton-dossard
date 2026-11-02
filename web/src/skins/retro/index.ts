import type { Skin } from "../types";
import { BrandMark, Divider, EmptyArt, HeaderArt, HeroArt, SectionMarker } from "./motifs";

// « Rétro »: the running club of the seventies: cream paper, brown ink, and the
// three stripes of an old track suit (orange, mustard, teal) with the sun that
// sets behind them. By day only (the variant has no dark mode).

export const skin: Skin = {
  id: "retro",
  label: { fr: "Rétro", en: "Retro" },
  modes: ["light"],
  slots: { HeaderArt, BrandMark, HeroArt, Divider, SectionMarker, EmptyArt },
  // The brown of its header and the burnt orange of its stripe.
  swatches: ["#3b2a20", "#e8642c"],
  fontSample:
    '"Bricolage Grotesque Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the brown of the ink.
  themeColor: "#3b2a20",
};
