import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react from "@vitejs/plugin-react";
import { playwright } from "@vitest/browser-playwright";
import { devices } from "playwright";
import { defineConfig } from "vitest/config";
import type { BrowserCommand } from "vitest/node";

import { skins } from "./src/skins/plugin.ts";
import type { Media } from "./src/test/mediaFeatures.ts";

/**
 * A command of the browser tests: the media features of the page, as a phone
 * or a computer would set them (a dark setting, the forced colours of a high
 * contrast mode), through src/test/media.ts, which puts them back after a test.
 */
const emulateMedia: BrowserCommand<[options: Media]> = async ({ page }, options) => {
  await page.emulateMedia(options);
};

/**
 * The browser and the device of the browser tests, chosen by the environment
 * (the CI matrix sets them): VITEST_BROWSER is chromium, firefox or webkit;
 * VITEST_DEVICE is the name of a Playwright device ("iPhone 15", "Pixel 7"),
 * which is a phone emulated in that browser, not a real one. An unknown value
 * is an error: a typo must not quietly run the default.
 */
const browsers = ["chromium", "firefox", "webkit"] as const;
type BrowserName = (typeof browsers)[number];

function browserFromEnv(): BrowserName {
  const name = process.env.VITEST_BROWSER || "chromium";
  const browser = browsers.find((known) => known === name);
  if (!browser) {
    throw new Error(`VITEST_BROWSER="${name}" is unknown: use ${browsers.join(", ")}.`);
  }
  return browser;
}

function deviceFromEnv(browser: BrowserName) {
  const name = process.env.VITEST_DEVICE;
  if (!name) return undefined;
  const device = (devices as Record<string, (typeof devices)[string] | undefined>)[name];
  if (!device) {
    throw new Error(
      `VITEST_DEVICE="${name}" is not a Playwright device (see "devices" in playwright).`,
    );
  }
  // Firefox cannot emulate a phone: Playwright has no isMobile there.
  if (device.isMobile && browser === "firefox") {
    throw new Error(
      `VITEST_DEVICE="${name}" is a phone: Firefox cannot emulate one (no isMobile).`,
    );
  }
  if (device.defaultBrowserType !== browser) {
    console.warn(
      `VITEST_DEVICE="${name}" is a ${device.defaultBrowserType} device, run in ${browser}.`,
    );
  }
  const { deviceScaleFactor, isMobile, hasTouch, userAgent } = device;
  // The tests draw in a frame of 414 × 896 (Vitest's default, which they put back after a test
  // that sets another): a phone whose screen is shorter would leave the bottom of the frame off
  // the screen, where nothing can be clicked. The screen is the frame; the rest is the phone's.
  return {
    viewport: { width: 414, height: 896 },
    // On CI (software rendering), a phone's 2.6 or 3 pixels per point made every frame, and so
    // every animation a click waits to end, many times slower: the tests draw at 1.
    deviceScaleFactor: process.env.CI !== undefined ? 1 : deviceScaleFactor,
    isMobile,
    hasTouch,
    userAgent,
  };
}

const browserName = browserFromEnv();
const contextOptions = deviceFromEnv(browserName);

// On CI every target gets two more tries for a failing test (the report shows the flaky ones), and
// its actions get more time: GitHub's machines are slower than a desktop, desktop Chromium too (a
// heavy file given to an input took more than 2 s there). Local runs stay strict.
const tolerant = process.env.CI !== undefined;

export default defineConfig({
  plugins: [
    // File-based routes. It generates src/routeTree.gen.ts, so it comes first.
    // The tests of a route sit next to it: they are not routes.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: true,
      routeFileIgnorePattern: "\\.test\\.tsx?$",
    }),
    // React Compiler: the native one, written in Rust (oxc-transform-react), run
    // by @vitejs/plugin-react itself, without Babel. It is experimental.
    react({ compiler: true }),
    tailwindcss(),
    // The skins (src/skins/README.md): the skins of development left out of a
    // build, and the table of the skins in the script of index.html.
    skins(),
  ],
  server: {
    // The port is part of APP_URL, which is the WebAuthn origin: if 5173 is
    // taken, failing is better than serving from an origin passkeys refuse.
    port: 5173,
    strictPort: true,
    // The MCP server is at /mcp, next to the API.
    proxy: { "/api": "http://127.0.0.1:8090", "/mcp": "http://127.0.0.1:8090" },
  },
  build: {
    // The Go program embeds this directory (server/webdist).
    outDir: "../server/webdist/dist",
    emptyOutDir: true,
  },
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          environment: "node",
          include: ["src/**/*.test.ts"],
          // The real app, built once for the run: build.test.ts and lookFailure.test.ts read it.
          globalSetup: ["./src/test/builtApp.setup.ts"],
        },
      },
      {
        extends: true,
        // Leaflet is only reached through the lazy map: without this, a cache made
        // before it was installed finds it during a run, optimizes it, and reloads
        // a test ("Vite unexpectedly reloaded a test").
        optimizeDeps: { include: ["leaflet", "react/compiler-runtime"] },
        test: {
          name: "browser",
          retry: process.env.CI !== undefined ? 2 : 0,
          expect: { poll: { timeout: tolerant ? 5000 : 1000 } },
          include: ["src/**/*.test.tsx"],
          // The first makes any real WebAuthn call fail: it would open a dialog
          // of the OS. The second does the same for a map tile request: no test
          // goes on the network.
          setupFiles: [
            "./src/test/blockWebAuthn.ts",
            "./src/test/blockTiles.ts",
            "./src/test/desktopIdentity.ts",
            "./src/test/failureMessage.ts",
          ],
          browser: {
            enabled: true,
            headless: true,
            // A click or a fill on a missing element fails after 2 s, not at
            // the 15 s test timeout. Below 2 s, passing tests failed at times.
            provider: playwright({
              actionTimeout: tolerant ? 5000 : 2000,
              // Linux WebKit says « reduced motion » by itself when the desktop has animations
              // off: the tests of the motion ask for it themselves.
              contextOptions: { reducedMotion: "no-preference", ...contextOptions },
            }),
            commands: { emulateMedia },
            instances: [{ browser: browserName }],
          },
        },
      },
    ],
  },
});
