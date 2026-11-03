// What « Piste » looks like, loaded when it is chosen (see ../README.md): its
// stylesheets (its fonts, its palette, the utilities of Tailwind of its motifs)
// and the motifs it draws, in the slots of the app.

import "./fonts.css";
import "./palette.css";
import "./utilities.css";
import type { Slots } from "../types";
import { BrandMark } from "./Brand";
import { HeaderArt, HeroArt } from "./LaneArt";
import { Divider, EmptyArt } from "./Marks";

export const slots: Partial<Slots> = { HeaderArt, BrandMark, HeroArt, Divider, EmptyArt };
