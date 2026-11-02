import type { Variants } from "../types";

// The components that a build at the depth « mix » replaces: those of each
// skin's `mix.tsx`. The plugin of the skins (../plugin.ts) points
// `virtual:skin-depth` at this file when `VITE_SKIN_DEPTH` is mix; its
// stylesheets are in mix.styles.ts.

/** The components replaced, by the path of their file. */
export const variants = import.meta.glob<Variants>("../*/mix.tsx", {
  eager: true,
  import: "variants",
});
