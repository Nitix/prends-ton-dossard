import type { Skin } from "../types";
import { HeaderArt, HeroArt } from "./Art";
import { BrandMark } from "./Brand";
import { Divider, SectionMarker } from "./Marks";

// « Nuit »: a city run at night, from the design variant of v4 (design/v4-nuit).
// Asphalt, a reflective lime, a touch of cyan; the only skin drawn in its dark
// mode and nothing else. Its motifs: the bib of the mark, reflective tape, the
// dotted pace line, the dash of a lane before each title, the dashes of a road.
// Crête's stand in for the empty lists.

export const skin: Skin = {
  id: "nuit",
  label: { fr: "Nuit", en: "Night" },
  modes: ["dark"],
  slots: { HeaderArt, BrandMark, HeroArt, Divider, SectionMarker },
  // The asphalt and the reflective lime.
  swatches: ["#0e1116", "#c6f432"],
  fontSample: '"Space Grotesk Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the night.
  themeColor: "#0a0d12",
};
