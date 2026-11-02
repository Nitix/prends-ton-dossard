import { existsSync, readFileSync } from "node:fs";

import { expect, test } from "vitest";

// « Crête » is set in Inter and Plus Jakarta Sans. They are served by the site
// itself (the @fontsource-variable packages, built into /assets/ and kept by
// the service worker), not by Google: a font that comes from another host tells
// that host who opens the app, and it is missing when the installed app opens
// without a network. Nothing in these files names that host or breaks that.

const page = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");

/** The value of a custom property declared in the theme, on one or several lines. */
function themeValue(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}:\\s*([^;]+);`));
  if (match?.[1] === undefined) throw new Error(`${name} is not declared in styles.css`);
  return match[1].replace(/\s+/g, " ").trim();
}

/** The files named by the `@font-face` rules of a family, in the order of the stylesheet. */
function faceFiles(css: string, family: string): string[] {
  const faces = css.match(/@font-face\s*\{[^}]*\}/g) ?? [];
  return faces
    .filter((face) => face.includes(`font-family: "${family}"`))
    .flatMap((face) => [...face.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1] ?? ""));
}

test("fonts — no request leaves the site", () => {
  // Neither the stylesheet, the files, nor the connections opened in advance.
  expect(page).not.toContain("fonts.googleapis.com");
  expect(page).not.toContain("fonts.gstatic.com");
  expect(page).not.toMatch(/rel="(preconnect|dns-prefetch|preload)"[^>]*https?:/);
  expect(styles).not.toMatch(/googleapis|gstatic/);

  // The stacks name the self-hosted families first, and keep the system fonts
  // for the time the files are loading and for a file that fails.
  const sans = themeValue(styles, "--font-sans");
  expect(sans).toMatch(/^"Inter Variable",/);
  expect(sans).toContain("system-ui");
  expect(sans).toContain("sans-serif");

  const display = themeValue(styles, "--font-display");
  expect(display).toMatch(/^"Plus Jakarta Sans Variable",/);
  expect(display).toContain('"Inter Variable"');
  expect(display).toContain("system-ui");
  expect(display).toContain("sans-serif");
});

test("fonts — the faces are the files of both packages, latin and latin-ext only", () => {
  // A family that is named but never declared would silently fall back to the
  // system font: the stacks above are only true if the faces exist. They come
  // from the packages (a path of the build, never a host), and only the two
  // subsets that French needs: the others would be built into /assets/ and
  // embedded in the program for nothing.
  expect(faceFiles(styles, "Inter Variable")).toEqual([
    "@fontsource-variable/inter/files/inter-latin-ext-wght-normal.woff2",
    "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  ]);
  expect(faceFiles(styles, "Plus Jakarta Sans Variable")).toEqual([
    "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-ext-wght-normal.woff2",
    "@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2",
  ]);
});

test("fonts — nothing imports the packages' own stylesheets, which would bring every script", () => {
  // Their CSS (`@import "@fontsource-variable/inter"`, or an import in a
  // module) declares a face for each script of the font: the build would emit
  // them all into /assets/ and the program. Only the four faces above are
  // declared, by hand. The `url()` of those faces name the packages too, and
  // so do the comments: both are taken out before the search.
  const rules = styles.replace(/\/\*[\s\S]*?\*\//g, "").replace(/url\([^)]*\)/g, "url()");
  expect(rules).not.toContain("@fontsource");
  // A module that names a package of the fonts, in an import of any form.
  const main = readFileSync(new URL("./main.tsx", import.meta.url), "utf8");
  expect(main).not.toMatch(/["']@fontsource/);
});

test("fonts — the page names no other host", () => {
  // No stylesheet, script, icon or manifest of the page comes from another site.
  expect(page).not.toMatch(/(?:href|src)="https?:/);
});

test("fonts — every face names a file that the package has", () => {
  // Vite leaves a `url()` it cannot resolve as it is, with a warning only: a
  // package that moves its files would leave the site in the system fonts.
  const files = [
    ...faceFiles(styles, "Inter Variable"),
    ...faceFiles(styles, "Plus Jakarta Sans Variable"),
  ];
  expect(files).toHaveLength(4);
  for (const file of files) {
    expect(
      existsSync(new URL(`../node_modules/${file}`, import.meta.url)),
      `the file of ${file}`,
    ).toBe(true);
  }
});
