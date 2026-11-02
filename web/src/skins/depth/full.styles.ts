// The stylesheets that a build at the depth « full » takes of the skins: the
// fonts, the palette, the mix, then the styles of every other piece of the
// variant (each `full.css`, last, so that it wins). The plugin of the skins
// (../plugin.ts) points `virtual:skin-styles` at this file when
// `VITE_SKIN_DEPTH` is full; only ../styles.ts imports it, for main.tsx.

import.meta.glob("../*/fonts.css", { eager: true });
import.meta.glob("../*/palette.css", { eager: true });
import.meta.glob("../*/mix.css", { eager: true });
import.meta.glob("../*/full.css", { eager: true });
