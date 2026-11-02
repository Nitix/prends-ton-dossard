/**
 * The media features that a browser test can set on its page, as a phone or a
 * computer would: a dark setting, the forced colours of a high contrast mode,
 * a request for less motion. `null` gives a feature back to the browser (no
 * override). One type for the command that vite.config.ts declares
 * (Playwright's `emulateMedia`) and for src/test/media.ts, which tests call;
 * this module imports nothing, so that the config does not load the code of
 * the browser.
 */
export type Media = {
  colorScheme?: "light" | "dark" | null;
  forcedColors?: "active" | "none" | null;
  reducedMotion?: "reduce" | "no-preference" | null;
};
