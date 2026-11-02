// The stylesheets that a build at the depth « mix » takes of the skins: the
// fonts and the palette, then the styles of their signature pieces (each
// `mix.css`, after the palette, so that it wins). The plugin of the skins
// (../plugin.ts) points `virtual:skin-styles` at this file when
// `VITE_SKIN_DEPTH` is mix; only ../styles.ts imports it, for main.tsx.

import.meta.glob("../*/fonts.css", { eager: true });
import.meta.glob("../*/palette.css", { eager: true });
import.meta.glob("../*/mix.css", { eager: true });
