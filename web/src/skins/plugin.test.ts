import { readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { SKINS } from ".";
import { declaredModes, declaredThemeColor, isDevSkinFile, skinTable, withSkins } from "./plugin";

// The part of the skins that runs at build time, in Node (vite.config.ts): the
// skins of development left out of a build, and the table of the skins that
// index.html needs before the page is first drawn.

const dir = fileURLToPath(new URL(".", import.meta.url));

test("plugin — les feuilles des skins viennent de l'entrée seule : main.tsx, juste après styles.css", () => {
  // Only main.tsx (and the browser tests that draw a skin) imports
  // skins/styles.ts, the module of the sheets: so the sheets of the skins are in the stylesheet of the entry, not in the one of a
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
          posix.normalize(posix.join(posix.dirname(file), specifier)) === "skins/styles",
      );
    })
    .toSorted();
  expect(importers).toEqual(["main.tsx"]);
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

test("plugin — un build vide les fichiers d'un skin de développement, et seulement les siens", () => {
  const skins = "C:\\app\\web\\src\\skins";
  for (const id of [
    "C:/app/web/src/skins/_example/index.ts",
    "C:/app/web/src/skins/_example/palette.css",
    "C:/app/web/src/skins/_example/palette.css?direct",
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
