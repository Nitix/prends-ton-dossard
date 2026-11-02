import type { Variants } from "../types";

// The components that a build at the depth « full » replaces: those of each
// skin's `mix.tsx` and `full.tsx` (index.ts lets full win). The plugin of the
// skins (../plugin.ts) points `virtual:skin-depth` at this file when
// `VITE_SKIN_DEPTH` is full; its stylesheets are in full.styles.ts.

/** The components replaced, by the path of their file. */
export const variants = import.meta.glob<Variants>(["../*/mix.tsx", "../*/full.tsx"], {
  eager: true,
  import: "variants",
});
