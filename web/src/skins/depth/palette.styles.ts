// The stylesheets that a build at the depth « palette » takes of the skins:
// their fonts (each `fonts.css`, at every depth), then their colours and the
// paints of their motifs on the structure of « Crête » (each `palette.css`).
// The plugin of the skins (../plugin.ts) points `virtual:skin-styles` at this
// file when `VITE_SKIN_DEPTH` is palette or not set; only ../styles.ts imports
// it, for main.tsx, so that these sheets are in the one stylesheet of the page.
// The files of the deeper levels are not in the build at all.

import.meta.glob("../*/fonts.css", { eager: true });
import.meta.glob("../*/palette.css", { eager: true });
