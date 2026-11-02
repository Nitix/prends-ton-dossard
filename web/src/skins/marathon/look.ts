// What « Marathon » looks like, loaded when it is chosen (see ../README.md): its
// stylesheets (its fonts, its palette, the utilities of Tailwind of its motifs)
// and the motifs it draws, in the slots of the app.

import "../shared/fonts.css";
import "./fonts.css";
import "./palette.css";
import "./utilities.css";
import type { Slots } from "../types";
import { BrandMark, Divider, EmptyArt, HeaderArt, HeroArt, SectionMarker } from "./motifs";

export const slots: Partial<Slots> = {
  HeaderArt,
  BrandMark,
  HeroArt,
  Divider,
  SectionMarker,
  EmptyArt,
};
