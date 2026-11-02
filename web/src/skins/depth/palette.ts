import type { Variants } from "../types";

// The components that a build at the depth « palette » replaces: none. The
// plugin of the skins (../plugin.ts) points `virtual:skin-depth` at this file
// when `VITE_SKIN_DEPTH` is palette or not set; its stylesheets are in
// palette.styles.ts.

/** No component is replaced at this depth. */
export const variants: Readonly<Record<string, Variants>> = {};
