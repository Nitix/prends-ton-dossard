import type { Variants } from "../types";

// What a build at the depth « full » takes of the skins: the fonts, the
// palette, the mix, then the styles of every other piece of the variant (each
// `full.css`, last, so that it wins), and the components replaced at both
// depths (each `mix.tsx` and `full.tsx`; index.ts lets full win). The plugin
// of the skins (../plugin.ts) points `virtual:skin-depth` at this file when
// `VITE_SKIN_DEPTH` is full.

import.meta.glob("../*/fonts.css", { eager: true });
import.meta.glob("../*/palette.css", { eager: true });
import.meta.glob("../*/mix.css", { eager: true });
import.meta.glob("../*/full.css", { eager: true });

/** The components replaced, by the path of their file. */
export const variants = import.meta.glob<Variants>(["../*/mix.tsx", "../*/full.tsx"], {
  eager: true,
  import: "variants",
});
