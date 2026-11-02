import type { Variants } from "../types";

// What a build at the depth « palette » takes of the skins: their colours,
// fonts and motifs on the structure of « Crête » (each `palette.css`). The
// plugin of the skins (../plugin.ts) points `virtual:skin-depth` at this file
// when `VITE_SKIN_DEPTH` is palette or not set: the files of the deeper levels
// are not in the build at all.

import.meta.glob("../*/palette.css", { eager: true });

/** No component is replaced at this depth. */
export const variants: Readonly<Record<string, Variants>> = {};
