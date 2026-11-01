import { commands } from "vitest/browser";

// The media features of the page in a browser test, as a phone or a computer
// would set them: a dark setting, the forced colours of a high contrast mode.
// The command is Playwright's `emulateMedia`, declared in vite.config.ts.

export type Media = {
  colorScheme?: "light" | "dark" | null;
  forcedColors?: "active" | "none" | null;
};

declare module "vitest/browser" {
  interface BrowserCommands {
    emulateMedia: (options: Media) => Promise<void>;
  }
}

/** Sets the media features of the page, for the test that calls it. */
export async function emulateMedia(media: Media): Promise<void> {
  await commands.emulateMedia(media);
}

/** Puts back what the tests run with: a light setting, no forced colours. */
export async function resetMedia(): Promise<void> {
  await commands.emulateMedia({ colorScheme: "light", forcedColors: "none" });
}
