import { commands } from "vitest/browser";

import type { Media } from "./mediaFeatures";

// The media features of the page in a browser test, as a phone or a computer
// would set them: a dark setting, the forced colours of a high contrast mode.
// The command is Playwright's `emulateMedia`, declared in vite.config.ts.

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (options: Media) => Promise<void>;
  }
}

/** Sets the media features of the page, for the test that calls it. */
export async function emulateMedia(media: Media): Promise<void> {
  await commands.emulateMedia(media);
}

/**
 * Gives the media features back to the browser: no override is left, and the
 * page has what the tests run with (headless Chromium: a light setting, no
 * forced colours).
 */
export async function resetMedia(): Promise<void> {
  await commands.emulateMedia({ colorScheme: null, forcedColors: null });
}
