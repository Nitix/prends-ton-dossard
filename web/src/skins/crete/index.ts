import type { Skin, Slots } from "../types";
import { BrandMark } from "./Brand";
import { EmptyArt } from "./EmptyArt";
import { HeaderArt } from "./HeaderArt";
import { HeroArt } from "./HeroArt";
import { RidgeDivider } from "./RidgeDivider";
import { SectionMarker } from "./SectionMarker";

// « Crête »: the dawn over the ridges, drawn like a map; the skin of the app
// when none is chosen. Its colours and fonts are those of styles.css (`@theme`,
// where Tailwind needs them, and its dark blocks); its motifs are here, and
// stand in for those that another skin does not draw.

/** Every motif of Crête: the slots of the app, filled. */
export const slots: Slots = {
  HeaderArt,
  BrandMark,
  HeroArt,
  Divider: RidgeDivider,
  SectionMarker,
  EmptyArt,
};

export const skin: Skin = {
  id: "crete",
  label: { fr: "Crête", en: "Crête" },
  modes: ["light", "dark"],
  slots,
  // The violet of the sky and the pink of the sunrise.
  swatches: ["#5e4ae3", "#ff7eb3"],
  fontSample:
    '"Plus Jakarta Sans Variable", "Inter Variable", ui-sans-serif, system-ui, sans-serif',
  // The top of its header: the violet of the sky.
  themeColor: "#5e4ae3",
};
