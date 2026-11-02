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

/**
 * Runs the inline script of the page, built with `table`, against what the
 * device keeps (or a storage that refuses), at a path of the site.
 */
function firstPaint(
  table: SkinTable,
  kept: Readonly<Record<string, string>> | Error,
  path = "/",
): Painted {
  const [script = ""] = inlineScripts(withSkins(page, table));
  const root: Root = { dataset: {}, style: {} };
  const bar = { content: CRETE_BAR };
  const written: string[] = [];
  const localStorage = {
    getItem: (key: string) => {
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
  runInNewContext(script, { document, localStorage, location: { pathname: path } });
  return { ...root, bar: bar.content, written };
}

/** The stylesheets of a skin, as a build names them in the table. */
const SHEETS = {
  nuit: ["/assets/look-Nu1t.css"],
  alpage: ["/assets/look-A1pa.css", "/assets/look-Shar.css"],
  carnet: ["/assets/look-Carn.css"],
};

/** The links that the script writes for the sheets of a skin. */
const linksTo = (sheets: readonly string[]) =>
  sheets.map((href) => `<link rel="stylesheet" href="${href}">`);

/** The skins of a build, and three that the app does not have yet: dark only, both modes, light only. */
const TABLE: SkinTable = {
  ...skinTable(dir, { dev: false }),
  nuit: { modes: ["dark"], themeColor: "#0e1116", sheets: SHEETS.nuit },
  alpage: { modes: ["light", "dark"], themeColor: "#2f6b3a", sheets: SHEETS.alpage },
  carnet: { modes: ["light"], themeColor: "#f4ecd8", sheets: SHEETS.carnet },
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
    written: linksTo(SHEETS.alpage),
  });
  // Both modes: the theme kept applies as it does with Crête.
  expect(firstPaint(TABLE, { [SKIN_KEY]: "alpage", [THEME_KEY]: "dark" })).toEqual({
    dataset: { skin: "alpage", theme: "dark" },
    style: { colorScheme: "dark" },
    bar: "#2f6b3a",
    written: linksTo(SHEETS.alpage),
  });
});

test("noFlash — les feuilles du skin gardé sont liées par le parseur : la page ne se dessine pas, et l'appli ne démarre pas, avant elles", () => {
  // Written into the page while it is parsed, as if index.html had them: a
  // stylesheet of the parser blocks the first paint and the scripts after it
  // in every browser, where one added to the head by a script blocks neither.
  const [script = ""] = inlineScripts(withSkins(page, TABLE));
  expect(script).toMatch(/document\.write\(/);
  expect(script).not.toMatch(/createElement|appendChild|\.append\(/);
  // Every sheet of the skin, once each, and nothing for a skin without any (development).
  const { written } = firstPaint(TABLE, { [SKIN_KEY]: "alpage" });
  expect(written).toEqual(linksTo(SHEETS.alpage));
  expect(
    firstPaint(
      { nuit: { modes: ["dark"], themeColor: "#0e1116", sheets: [] } },
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
      written: linksTo(SHEETS.nuit),
    });
    expect(firstPaint(TABLE, { ...kept, [SKIN_KEY]: "carnet" }), `theme ${theme}`).toEqual({
      dataset: { skin: "carnet", theme: "light" },
      style: { colorScheme: "light" },
      bar: "#f4ecd8",
      written: linksTo(SHEETS.carnet),
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
  // Signing out forgets the session (its own key of the storage), not the skin:
  // the pages without a session are drawn in it from their first paint too.
  for (const path of ["/connexion", "/invitation"]) {
    expect(firstPaint(TABLE, { [SKIN_KEY]: "nuit" }, path), `at ${path}`).toEqual({
      dataset: { skin: "nuit", theme: "dark" },
      style: { colorScheme: "dark" },
      bar: "#0e1116",
      written: linksTo(SHEETS.nuit),
    });
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
