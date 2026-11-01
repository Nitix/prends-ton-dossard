import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

// The name that the app has once it is installed, on the home screen of a phone:
// it is written in the manifest (Android, Chrome) and in a meta tag of the page
// (iOS reads that one, not the manifest). Nothing else says it, so a change in
// one of the two files that brings back an older name goes unnoticed until
// somebody installs the app.

const NAME = "Prends ton dossard";

const manifest: unknown = JSON.parse(
  readFileSync(new URL("../../../public/manifest.webmanifest", import.meta.url), "utf8"),
);
const page = readFileSync(new URL("../../../index.html", import.meta.url), "utf8");

function field(json: unknown, key: string): unknown {
  return typeof json === "object" && json !== null ? Reflect.get(json, key) : undefined;
}

/** The `content` of the `<meta>` tag with this name, whatever the order of its attributes. */
function metaContent(html: string, name: string): string | undefined {
  const tag = html.match(new RegExp(`<meta\\b[^>]*\\bname="${name}"[^>]*>`))?.[0];
  return tag?.match(/\bcontent="([^"]*)"/)?.[1];
}

test("manifeste — l'appli installée s'appelle « Prends ton dossard », en entier", () => {
  expect(field(manifest, "short_name")).toBe(NAME);
  expect(field(manifest, "name")).toBe(NAME);
});

test("index.html — le titre de l'appli sur l'écran d'accueil d'iOS est « Prends ton dossard »", () => {
  expect(metaContent(page, "apple-mobile-web-app-title")).toBe(NAME);
});

test("index.html — la page et le manifeste portent le même nom", () => {
  expect(page).toContain(`<title>${NAME}</title>`);
  expect(page).toContain('rel="manifest"');
});

test("manifeste — l'écran de lancement a le violet de l'en-tête, de jour comme de nuit", () => {
  // An installed app opens on a screen of background_color before its page is
  // drawn. The header is the violet of the sky in both themes: the lilac sheet
  // of the day would flash light before a dark page.
  expect(field(manifest, "background_color")).toBe("#5e4ae3");
  expect(field(manifest, "theme_color")).toBe("#5e4ae3");
  expect(metaContent(page, "theme-color")).toBe("#5e4ae3");
});
