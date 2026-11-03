// What « Carnet » looks like, loaded when it is chosen (see ../README.md): its
// stylesheets (its fonts, its palette, the motion of its background, the
// utilities of Tailwind of its motifs) and the motifs it draws, in the slots of
// the app.

import "./fonts.css";
import "./motion.css";
import "./palette.css";
import "./utilities.css";
import type { Slots } from "../types";
import { BrandMark, Divider, EmptyArt, HeaderArt, HeroArt, PageArt, SectionMarker } from "./motifs";

export const slots: Partial<Slots> = {
  HeaderArt,
  BrandMark,
  HeroArt,
  Divider,
  SectionMarker,
  EmptyArt,
  PageArt,
};
