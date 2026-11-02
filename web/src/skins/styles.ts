// The stylesheets of the skins: their fonts (each `fonts.css`), then their
// colours and the paints of their motifs on the structure of « Crête » (each
// `palette.css`). main.tsx imports this module right after styles.css, and
// nothing else of the app does: so the sheets of the skins are in the same
// stylesheet as Crête's, the one the page links, not in a sheet of their own
// that the page would wait for too. A browser test that draws a skin imports
// it, as it imports styles.css.

import.meta.glob("./*/fonts.css", { eager: true });
import.meta.glob("./*/palette.css", { eager: true });
