import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

import { expect, test } from "vitest";

import { SKIN_KEY } from ".";
import { THEME_KEY } from "../lib/theme";
import { pageWithSkins, skinTable, skins, withSkins, type SkinTable } from "./plugin";

// The script of index.html, as the build writes the table of the skins into it,
// before the page is first drawn: a skin kept on the device is on <html> before
// the stylesheet paints anything, and so is the mode of a skin that has one
// only. lib/theme.test.ts tests the theme alone, on the page as it is written.

const dir = fileURLToPath(new URL(".", import.meta.url));
const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

/** The inline scripts of the head of a page. */
function inlineScripts(html: string): string[] {
  const head = html.slice(0, html.indexOf("</head>"));
  return [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1] ?? "");
}

/** Runs the inline script of the page, built with `table`, against what the device keeps (or a storage that refuses). */
function firstPaint(table: SkinTable, kept: Readonly<Record<string, string>> | Error): Root {
  const [script = ""] = inlineScripts(withSkins(page, table));
  const root: Root = { dataset: {}, style: {} };
  const localStorage = {
    getItem: (key: string) => {
      if (kept instanceof Error) throw kept;
      return kept[key] ?? null;
    },
  };
  runInNewContext(script, { document: { documentElement: root }, localStorage });
  return root;
}

/** The skins of a build, and two that the app does not have yet: one dark only, one with both modes. */
const TABLE: SkinTable = {
  ...skinTable(dir, { dev: false }),
  nuit: ["dark"],
  alpage: ["light", "dark"],
  carnet: ["light"],
};

test("noFlash — index.html applique le skin gardé avant le premier dessin, avec le thème", () => {
  const [script = ""] = inlineScripts(withSkins(page, TABLE));
  expect(inlineScripts(page)).toHaveLength(1);
  expect(script).toContain(SKIN_KEY);
  expect(script).toContain(THEME_KEY);

  expect(firstPaint(TABLE, { [SKIN_KEY]: "alpage" })).toEqual({
    dataset: { skin: "alpage" },
    style: {},
  });
  // Both modes: the theme kept applies as it does with Crête.
  expect(firstPaint(TABLE, { [SKIN_KEY]: "alpage", [THEME_KEY]: "dark" })).toEqual({
    dataset: { skin: "alpage", theme: "dark" },
    style: { colorScheme: "dark" },
  });
});

test("noFlash — un skin à un seul mode est dessiné dans ce mode dès le premier dessin, quel que soit le thème gardé", () => {
  for (const theme of [undefined, "light", "dark"]) {
    const kept: Record<string, string> = theme === undefined ? {} : { [THEME_KEY]: theme };
    expect(firstPaint(TABLE, { ...kept, [SKIN_KEY]: "nuit" }), `theme ${theme}`).toEqual({
      dataset: { skin: "nuit", theme: "dark" },
      style: { colorScheme: "dark" },
    });
    expect(firstPaint(TABLE, { ...kept, [SKIN_KEY]: "carnet" }), `theme ${theme}`).toEqual({
      dataset: { skin: "carnet", theme: "light" },
      style: { colorScheme: "light" },
    });
  }
});

test("noFlash — Crête, un skin inconnu, un skin de développement dans un build, ou un stockage qui refuse : rien que le thème", () => {
  for (const skin of ["crete", "gone", "night", "__proto__", "constructor", "_example", ""]) {
    expect(firstPaint(TABLE, { [SKIN_KEY]: skin, [THEME_KEY]: "dark" }), `skin ${skin}`).toEqual({
      dataset: { theme: "dark" },
      style: { colorScheme: "dark" },
    });
  }
  expect(firstPaint(TABLE, new DOMException("The storage is off", "SecurityError"))).toEqual({
    dataset: {},
    style: {},
  });
  // In development, the example skin is a skin like the others.
  expect(firstPaint(skinTable(dir, { dev: true }), { [SKIN_KEY]: "_example" })).toEqual({
    dataset: { skin: "_example", theme: "light" },
    style: { colorScheme: "light" },
  });
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
