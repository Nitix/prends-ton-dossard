// The stylesheets of the skins at the depth of the build (see plugin.ts and
// depth/*.styles.ts). main.tsx imports this module right after styles.css, and
// nothing else of the app does: so the sheets of the skins are in the same
// stylesheet as Crête's, the one the page links, not in a sheet of their own
// that the page would wait for too. A browser test that draws a skin imports
// it, as it imports styles.css.

import "virtual:skin-styles";
