import { readFileSync, readdirSync } from "node:fs";
import { join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { SKINS } from ".";
import {
  DEPTH_MODULE,
  STYLES_MODULE,
  declaredModes,
  declaredThemeColor,
  depthFile,
  envDirOf,
  isDevSkinFile,
  skinDepth,
  skinTable,
  stylesFile,
  withSkins,
} from "./plugin";
import { DEPTHS } from "./types";

// The part of the skins that runs at build time, in Node (vite.config.ts): the
// depth of the build, the stylesheets and the variants it bundles, and the
// table of the skins that index.html needs before the page is first drawn.

const dir = fileURLToPath(new URL(".", import.meta.url));

test("plugin — la profondeur vient de VITE_SKIN_DEPTH, palette par défaut, et une valeur inconnue arrête le build", () => {
  expect(skinDepth(undefined)).toBe("palette");
  expect(skinDepth("")).toBe("palette");
  expect(skinDepth("palette")).toBe("palette");
  expect(skinDepth("mix")).toBe("mix");
  expect(skinDepth("full")).toBe("full");
  for (const wrong of ["complet", "Mix", " full", "deep"]) {
    expect(() => skinDepth(wrong), `value ${wrong}`).toThrow(/VITE_SKIN_DEPTH/);
  }
});

/** The patterns of the `import.meta.glob` calls of a module, in order, each call's as one string. */
function globs(file: string): string[] {
  const code = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "");
  return [...code.matchAll(/import\.meta\.glob(?:<\w+>)?\(\s*("[^"]*"|\[[^\]]*\])/g)].map((match) =>
    [JSON.parse(match[1] ?? '""')].flat().join(" + "),
  );
}

test("plugin — un build garde les feuilles et les variantes de sa profondeur et de celles d'avant, pas des suivantes", () => {
  expect(DEPTH_MODULE).toBe("virtual:skin-depth");
  expect(STYLES_MODULE).toBe("virtual:skin-styles");
  // The sheets: the fonts at every depth, first, then each level in its own
  // call, in this order: a deeper sheet comes after, and wins.
  expect(globs(stylesFile(dir, "palette"))).toEqual(["../*/fonts.css", "../*/palette.css"]);
  expect(globs(stylesFile(dir, "mix"))).toEqual([
    "../*/fonts.css",
    "../*/palette.css",
    "../*/mix.css",
  ]);
  expect(globs(stylesFile(dir, "full"))).toEqual([
    "../*/fonts.css",
    "../*/palette.css",
    "../*/mix.css",
    "../*/full.css",
  ]);
  // The variants, in a module of their own (the registry's): none at palette.
  expect(globs(depthFile(dir, "palette"))).toEqual([]);
  expect(globs(depthFile(dir, "mix"))).toEqual(["../*/mix.tsx"]);
  expect(globs(depthFile(dir, "full"))).toEqual(["../*/mix.tsx + ../*/full.tsx"]);
  for (const depth of DEPTHS) {
    expect(readFileSync(depthFile(dir, depth), "utf8"), `depth ${depth}`).toMatch(
      /export const variants\b/,
    );
  }
});

test("plugin — les feuilles des skins viennent de l'entrée seule : main.tsx, juste après styles.css", () => {
  // Only skins/styles.ts imports the module of the sheets, and only main.tsx
  // (and the browser tests that draw a skin) imports skins/styles.ts: so the
  // sheets of the skins are in the stylesheet of the entry, not in the one of a
  // part that the entry shares with the pages.
  const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
  const imports = [...main.matchAll(/^import "([^"]+)";$/gm)].map((match) => match[1]);
  expect(imports).toEqual(["./styles.css", "./skins/styles"]);
  const importers = readdirSync(join(dir, ".."), { recursive: true, encoding: "utf8" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .filter((file) => {
      const text = readFileSync(join(dir, "..", file), "utf8");
      const specifiers = [...text.matchAll(/^import (?:[^;]*? from )?"([^"]+)";$/gm)].map(
        (match) => match[1] ?? "",
      );
      return specifiers.some(
        (specifier) =>
          specifier === STYLES_MODULE ||
          posix.normalize(posix.join(posix.dirname(file), specifier)) === "skins/styles",
      );
    })
    .toSorted();
  expect(importers).toEqual(["main.tsx", "skins/styles.ts"]);
});

test("plugin — la table des skins : chaque skin sauf Crête, avec ses modes, comme le registre les a", () => {
  const table = skinTable(dir, { dev: true });
  expect(Object.keys(table)).not.toContain("crete");
  // What the registry finds, from the same folders (a test has the dev-only skins too).
  const registered = Object.fromEntries(
    SKINS.filter((skin) => skin.id !== "crete").map((skin) => [
      skin.id,
      { modes: [...skin.modes], themeColor: skin.themeColor },
    ]),
  );
  expect(table).toEqual(registered);
  // A build leaves the dev-only skins out: production never applies one.
  expect(Object.keys(skinTable(dir, { dev: false })).filter((id) => id.startsWith("_"))).toEqual(
    [],
  );
});

test("plugin — les modes et la couleur d'un skin se lisent dans son index.ts", () => {
  const source =
    'export const skin = { id: "x", modes: ["light", "dark"], themeColor: "#12ab9C" };';
  expect(declaredModes(source)).toEqual(["light", "dark"]);
  expect(declaredThemeColor(source)).toBe("#12ab9C");
  expect(declaredModes('modes: ["dusk"]')).toEqual([]);
  expect(declaredThemeColor('themeColor: "violet"')).toBeUndefined();
});

test("plugin — les fichiers .env sont lus là où Vite les lit, et pas avec envDir: false", () => {
  const cwd = process.cwd();
  expect(envDirOf({})).toBe(resolve(cwd));
  expect(envDirOf({ root: "web" })).toBe(resolve(cwd, "web"));
  expect(envDirOf({ root: "web", envDir: "env" })).toBe(resolve(cwd, "web", "env"));
  expect(envDirOf({ root: "web", envDir: resolve(cwd, "elsewhere") })).toBe(
    resolve(cwd, "elsewhere"),
  );
  expect(envDirOf({ root: "web", envDir: false })).toBe(false);
});

test("plugin — un build vide les fichiers d'un skin de développement, et seulement les siens", () => {
  const skins = "C:\\app\\web\\src\\skins";
  for (const id of [
    "C:/app/web/src/skins/_example/index.ts",
    "C:/app/web/src/skins/_example/palette.css",
    "C:/app/web/src/skins/_example/mix.css?direct",
    "C:\\app\\web\\src\\skins\\_example\\motifs.tsx",
  ]) {
    expect(isDevSkinFile(id, skins), `the file ${id}`).toBe(true);
  }
  for (const id of [
    "C:/app/web/src/skins/crete/index.ts",
    "C:/app/web/src/skins/index.ts",
    "C:/app/web/src/skins/_example",
    "C:/app/web/src/components/_example/index.ts",
    "C:/app/web/src/skins/crete/_part.tsx",
  ]) {
    expect(isDevSkinFile(id, skins), `the file ${id}`).toBe(false);
  }
});

test("plugin — la table est écrite dans le script de index.html, à sa place, et nulle part ailleurs", () => {
  const html = "<script>\n  const skins = /* skins */ {};\n</script>";
  const table = {
    nuit: { modes: ["dark" as const], themeColor: "#0e1116" },
    alpage: { modes: ["light" as const, "dark" as const], themeColor: "#2f6b3a" },
  };
  expect(withSkins(html, table)).toBe(
    `<script>\n  const skins = ${JSON.stringify(table)};\n</script>`,
  );
  // A page without the place of the table is a mistake of the build, not a page without skins.
  expect(() => withSkins("<script></script>", {})).toThrow(/skins/);
  // The page of the app has that place.
  const page = readFileSync(new URL("../../index.html", import.meta.url), "utf8");
  expect(() => withSkins(page, {})).not.toThrow();
});
