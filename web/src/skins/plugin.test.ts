import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { SKINS } from ".";
import { declaredModes, declaredThemeColor, isDevSkinFile, skinTable, withSkins } from "./plugin";

// The part of the skins that runs at build time, in Node (vite.config.ts): the
// skins of development left out of a build, and the table of the skins that
// index.html needs before the page is first drawn.

const dir = fileURLToPath(new URL(".", import.meta.url));

/** The modules of src/, not tests, by their path from src/ (`skins/nuit/look.ts`), each with what it imports, from src/. */
function sources(): { file: string; imports: string[] }[] {
  return readdirSync(join(dir, ".."), { recursive: true, encoding: "utf8" })
    .map((file) => file.replaceAll("\\", "/"))
    .filter((file) => /\.(tsx?|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file) => {
      const text = readFileSync(join(dir, "..", file), "utf8");
      const specifiers = [
        ...text.matchAll(/^import (?:type )?(?:[^;]*? from )?"([^"]+)";$/gm),
        ...text.matchAll(/^@import "([^"]+)";$/gm),
      ].map((match) => match[1] ?? "");
      return {
        file,
        imports: specifiers
          .filter((specifier) => specifier.startsWith("."))
          .map((specifier) => posix.normalize(posix.join(posix.dirname(file), specifier))),
      };
    });
}

/** The folder of src/skins/ that a path from src/ is in (`nuit`, `shared`, `crete`), if any. */
const folderOf = (path: string) => /^skins\/([^/]+)\//.exec(path)?.[1];

test("plugin — le look d'un skin ne vient que de looks.ts : rien de l'appli n'importe ses feuilles ni ses motifs", () => {
  // The page of a person who stays on Crête loads the registry (each skin's
  // index.ts), Crête's folder and the modules of src/skins/; the rest of a
  // skin's folder, and the folder its looks share (shared/), only through
  // the part of its look, which looks.ts loads when it is chosen.
  const strangers = sources().flatMap(({ file, imports }) => {
    const own = folderOf(file);
    return imports
      .filter((path) => {
        const folder = folderOf(path);
        if (folder === undefined || folder === "crete" || folder === own) return false;
        // The index of a skin, for the registry; a shared folder, from a skin's folder.
        if (/^skins\/[^/]+\/index(\.ts)?$/.test(path)) return false;
        return !(folder === "shared" && own !== undefined);
      })
      .map((path) => `${file} imports ${path}`);
  });
  expect(strangers).toEqual([]);
  // A skin's folder takes nothing from another skin's: what two share is in shared/ (or Crête's).
  const borrowed = sources().flatMap(({ file, imports }) => {
    const own = folderOf(file);
    if (own === undefined) return [];
    return imports
      .filter((path) => {
        const folder = folderOf(path);
        return folder !== undefined && ![own, "shared", "crete"].includes(folder);
      })
      .map((path) => `${file} imports ${path}`);
  });
  expect(borrowed).toEqual([]);
  // Not an empty search: the looks import their sheets, Sentier's and Alpage's the shared folder.
  const looks = sources().filter(({ file }) => /^skins\/[^/]+\/look\.ts$/.test(file));
  expect(looks.length).toBeGreaterThan(5);
  expect(looks.flatMap(({ imports }) => imports)).toContain("skins/shared/trail");
});

test("plugin — la table des skins : chaque skin sauf Crête, avec ses modes, comme le registre les a", () => {
  const table = skinTable(dir, { dev: true });
  expect(Object.keys(table)).not.toContain("crete");
  // What the registry finds, from the same folders (a test has the dev-only skins too).
  const registered = Object.fromEntries(
    SKINS.filter((skin) => skin.id !== "crete").map((skin) => [
      skin.id,
      { modes: [...skin.modes], themeColor: skin.themeColor, sheets: [] },
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
    nuit: { modes: ["dark" as const], themeColor: "#0e1116", sheets: ["/assets/look-Nu1t.css"] },
    alpage: { modes: ["light" as const, "dark" as const], themeColor: "#2f6b3a", sheets: [] },
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

test("plugin — styles.css ne lit pas les dossiers des autres skins : chacun a ses utilitaires dans son look", () => {
  // The utilities of Tailwind that a skin's motifs use are in the sheet of its
  // look (its utilities.css), not in the stylesheet of every page: styles.css
  // leaves out every folder of src/skins/ but Crête's (and the `_` ones, never built).
  const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const listed =
    /^@source not "\.\/skins\/\{([^}]+)\}\/\*\*";$/m.exec(styles)?.[1]?.split(",") ?? [];
  const folders = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "crete" && !entry.name.startsWith("_"))
    .map((entry) => entry.name);
  expect(folders).toContain("shared");
  expect(listed.toSorted((a, b) => a.localeCompare(b))).toEqual(
    folders.toSorted((a, b) => a.localeCompare(b)),
  );
  // Each folder that draws with classes has its sheet of utilities, scanning its own files.
  const missing = folders.filter((folder) => {
    if (!readdirSync(join(dir, folder)).some((file) => file.endsWith(".tsx"))) return false;
    const sheet = join(dir, folder, "utilities.css");
    return !existsSync(sheet) || !readFileSync(sheet, "utf8").includes('@source "./*.tsx";');
  });
  expect(missing).toEqual([]);
});
