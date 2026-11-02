import type { Variants } from "../types";

// What a build at the depth « mix » takes of the skins: the fonts and the
// palette, then the styles of their signature pieces (each `mix.css`, after
// the palette, so that it wins), and the components they replace there (each
// `mix.tsx`). The plugin of the skins (../plugin.ts) points
// `virtual:skin-depth` at this file when `VITE_SKIN_DEPTH` is mix.

import.meta.glob("../*/fonts.css", { eager: true });
import.meta.glob("../*/palette.css", { eager: true });
import.meta.glob("../*/mix.css", { eager: true });

/** The components replaced, by the path of their file. */
export const variants = import.meta.glob<Variants>("../*/mix.tsx", {
  eager: true,
  import: "variants",
});
