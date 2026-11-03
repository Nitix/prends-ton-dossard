// What « Exemple (dev) » looks like, loaded when it is chosen (see ../README.md): its
// stylesheets (its palette) and the motifs it draws, in the slots of the app.

import "./palette.css";
import type { Slots } from "../types";
import { ExampleDivider, ExampleMarker } from "./motifs";

export const slots: Partial<Slots> = { SectionMarker: ExampleMarker, Divider: ExampleDivider };
