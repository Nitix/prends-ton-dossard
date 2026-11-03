// What « Aurore » looks like, loaded when it is chosen (see ../README.md): its
// stylesheets (its fonts, its palette, the utilities of Tailwind of its motifs)
// and the motifs it draws, in the slots of the app.

import "./fonts.css";
import "./palette.css";
import "./utilities.css";
import type { Slots } from "../types";
import { BrandMark, EmptyArt, HeaderArt, HeroArt } from "./slots";

export const slots: Partial<Slots> = { HeaderArt, BrandMark, HeroArt, EmptyArt };
