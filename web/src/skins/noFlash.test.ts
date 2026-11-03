import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { expect, test } from "vitest";

import { SKIN_KEY, SKINS } from ".";
import { THEME_KEY } from "../lib/theme";
import { pageWithSkins, skinTable, skins, withSkins, type SkinTable } from "./plugin";

// The script of index.html, as the build writes the table of the skins into it,
// before the page is first drawn: a skin kept on the device is on <html>, and
// its stylesheets are linked, before the stylesheet paints anything, and so is
// the mode of a skin that has one only. Every page of the app is index.html
// (the server gives it for every path): the pages without a session, to sign
// in or to accept an invitation, too. lib/theme.test.ts tests the theme alone,
// on the page as it is written.

const dir = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

/** What the script leaves on the page: <html>, the colour of the bar of the browser, and what it wrote into the page. */
type Painted = Root & { bar: string; written: string[] };

/** The colour of the bar that index.html has before any skin: the violet of Crête's sky. */
const CRETE_BAR = "#5e4ae3";

/** The inline scripts of the head of a page. */
function inlineScripts(html: string): string[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
}

/** What the script reads of the page and of the device: the keys of the storage, the properties of `location`. */
type Seen = { keys: string[]; location: string[] };

/**
 * Runs the inline script of the page, built with `table`, against what the
 * device keeps (or a storage that refuses), at a path of the site; `seen`
 * gathers what it reads.
 */
function firstPaint(
  table: SkinTable,
  kept: Readonly<Record<string, string>> | Error,
  path = "/",
  seen: Seen = { keys: [], location: [] },
): Painted {
  const [script = ""] = inlineScripts(withSkins(page, table));
  const root: Root = { dataset: {}, style: {} };
  const bar = { content: CRETE_BAR };
  const written: string[] = [];
  const localStorage = {
    getItem: (key: string) => {
      seen.keys.push(key);
      if (kept instanceof Error) throw kept;
      return kept[key] ?? null;
    },
  };
  const document = {
    documentElement: root,
    querySelector: (selector: string) => (selector === 'meta[name="theme-color"]' ? bar : null),
    // What the parser reads right after the script: a part of the page as it was written.
    write: (html: string) => {
      written.push(html);
    },
  };
  const location = new Proxy(new URL(path, "https://courses.example.test"), {
    get: (url, property) => {
      seen.location.push(String(property));
      return Reflect.get(url, property, url);
    },
  });
  runInNewContext(script, { document, localStorage, location });
  return { ...root, bar: bar.content, written };
}

/** The files of the look of a skin, as a build names them in the table: its sheets, and its parts. */
const LOOKS = {
  nuit: { sheets: ["/assets/look-Nu1t.css"], scripts: ["/assets/look-Nu1t.js"] },
  alpage: {
    sheets: ["/assets/trail-Shar.css", "/assets/look-A1pa.css", "/assets/fonts-Shar.css"],
    scripts: ["/assets/look-A1pa.js", "/assets/trail-Shar.js"],
  },
  carnet: { sheets: ["/assets/look-Carn.css"], scripts: ["/assets/look-Carn.js"] },
};

/** The links that the script writes for the look of a skin: its sheets, then its parts to preload, in order. */
const linksTo = ({
  sheets,
  scripts,
}: {
  sheets: readonly string[];
  scripts: readonly string[];
}) => [
  ...sheets.map((href) => `<link rel="stylesheet" href="${href}">`),
  ...scripts.map((href) => `<link rel="modulepreload" crossorigin href="${href}">`),
];

/** The skins of a build, and three that the app does not have yet: dark only, both modes, light only. */
const TABLE: SkinTable = {
  ...skinTable(dir, { dev: false }),
  nuit: { modes: ["dark"], themeColor: "#0e1116", ...LOOKS.nuit },
  alpage: { modes: ["light", "dark"], themeColor: "#2f6b3a", ...LOOKS.alpage },
  carnet: { modes: ["light"], themeColor: "#f4ecd8", ...LOOKS.carnet },
};

test("noFlash — index.html applique le skin gardé avant le premier dessin, avec ses feuilles, le thème et la couleur de la barre", () => {
  const [script = ""] = inlineScripts(withSkins(page, TABLE));
  expect(inlineScripts(page)).toHaveLength(1);
  expect(script).toContain(SKIN_KEY);
  expect(script).toContain(THEME_KEY);
  // The page starts with Crête's colour for the bar.
  expect(page).toContain(`<meta name="theme-color" content="${CRETE_BAR}" />`);

  expect(firstPaint(TABLE, { [SKIN_KEY]: "alpage" })).toEqual({
    dataset: { skin: "alpage" },
    style: {},
    bar: "#2f6b3a",
    written: linksTo(LOOKS.alpage),
  });
  // Both modes: the theme kept applies as it does with Crête.
  expect(firstPaint(TABLE, { [SKIN_KEY]: "alpage", [THEME_KEY]: "dark" })).toEqual({
    dataset: { skin: "alpage", theme: "dark" },
    style: { colorScheme: "dark" },
    bar: "#2f6b3a",
    written: linksTo(LOOKS.alpage),
  });
});

test("noFlash — les feuilles du skin gardé sont liées par le parseur : la page ne se dessine pas, et l'appli ne démarre pas, avant elles", () => {
  // Written into the page while it is parsed, as if index.html had them: a
  // stylesheet of the parser blocks the first paint and the scripts after it
  // in every browser, where one added to the head by a script blocks neither.
  const [script = ""] = inlineScripts(withSkins(page, TABLE));
  expect(script).toMatch(/document\.write\(/);
  expect(script).not.toMatch(/createElement|appendChild|\.append\(/);
  // Every sheet of the skin, once each, in the order of the table (Vite's),
  // then its parts to preload for the first render of the app; nothing for a
  // skin without any (development).
  const { written } = firstPaint(TABLE, { [SKIN_KEY]: "alpage" });
  expect(written).toEqual(linksTo(LOOKS.alpage));
  expect(
    firstPaint(
      { nuit: { modes: ["dark"], themeColor: "#0e1116", sheets: [], scripts: [] } },
      { [SKIN_KEY]: "nuit" },
    ).written,
  ).toEqual([]);
});

test("noFlash — un skin à un seul mode est dessiné dans ce mode dès le premier dessin, quel que soit le thème gardé", () => {
  for (const theme of [undefined, "light", "dark"]) {
    const kept: Record<string, string> = theme === undefined ? {} : { [THEME_KEY]: theme };
    expect(firstPaint(TABLE, { ...kept, [SKIN_KEY]: "nuit" }), `theme ${theme}`).toEqual({
      dataset: { skin: "nuit", theme: "dark" },
      style: { colorScheme: "dark" },
      bar: "#0e1116",
      written: linksTo(LOOKS.nuit),
    });
    expect(firstPaint(TABLE, { ...kept, [SKIN_KEY]: "carnet" }), `theme ${theme}`).toEqual({
      dataset: { skin: "carnet", theme: "light" },
      style: { colorScheme: "light" },
      bar: "#f4ecd8",
      written: linksTo(LOOKS.carnet),
    });
  }
});

test("noFlash — Crête, un skin inconnu ou retiré depuis, un skin de développement dans un build, ou un stockage qui refuse : rien que le thème, aucune feuille", () => {
  for (const skin of ["crete", "gone", "night", "__proto__", "constructor", "_example", ""]) {
    expect(firstPaint(TABLE, { [SKIN_KEY]: skin, [THEME_KEY]: "dark" }), `skin ${skin}`).toEqual({
      dataset: { theme: "dark" },
      style: { colorScheme: "dark" },
      bar: CRETE_BAR,
      written: [],
    });
  }
  expect(firstPaint(TABLE, new DOMException("The storage is off", "SecurityError"))).toEqual({
    dataset: {},
    style: {},
    bar: CRETE_BAR,
    written: [],
  });
  // In development, the example skin is a skin like the others; its sheets come with its look.
  const example = SKINS.find((skin) => skin.id === "_example");
  expect(firstPaint(skinTable(dir, { dev: true }), { [SKIN_KEY]: "_example" })).toEqual({
    dataset: { skin: "_example", theme: "light" },
    style: { colorScheme: "light" },
    bar: example?.themeColor,
    written: [],
  });
});

test("noFlash — sans session, sur la page de connexion ou d'une invitation, le skin gardé est là, avec ses feuilles", () => {
  // Signing out forgets the session (PocketBase's own key of the storage), not
  // the skin. The script reads the skin and the theme kept on the device, and
  // nothing of the session or of the page it is on: the pages without a
  // session (the server answers them with index.html) are drawn in the skin
  // from their first paint, as the others.
  const signedIn = { [SKIN_KEY]: "nuit", pocketbase_auth: '{"token":"t"}' };
  const signedOut = { [SKIN_KEY]: "nuit" };
  const inSession = firstPaint(TABLE, signedIn, "/");
  expect(inSession.written).toEqual(linksTo(LOOKS.nuit));
  for (const path of ["/connexion", "/invitation"]) {
    const seen: Seen = { keys: [], location: [] };
    expect(firstPaint(TABLE, signedOut, path, seen), `at ${path}`).toEqual(inSession);
    expect(seen.keys.toSorted(), `at ${path}: what it reads of the device`).toEqual(
      [SKIN_KEY, THEME_KEY].toSorted(),
    );
    expect(seen.location, `at ${path}: what it reads of the page`).toEqual([]);
  }
});

/** The table of the skins of a build. */
const buildTable = () => skinTable(dir, { dev: false });

test("noFlash — le build écrit la table des skins dans la page de l'appli, et pas ailleurs", () => {
  // What vite.config.ts uses: the plugin of the skins, whose hook on a page is `pageWithSkins`.
  const config = readFileSync(new URL("../../vite.config.ts", import.meta.url), "utf8");
  expect(config).toMatch(/\bskins\(\)/);
  expect(skins().transformIndexHtml).toBeDefined();

  const built = pageWithSkins(page, "/index.html", buildTable);
  expect(built).not.toContain("/* skins */");
  expect(built).toContain(`const skins = ${JSON.stringify(buildTable())};`);
  // Another page (the one of the browser tests) is left as it is.
  expect(pageWithSkins("<p></p>", "/other.html", buildTable)).toBe("<p></p>");
});
