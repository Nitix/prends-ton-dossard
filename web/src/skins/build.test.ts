import { fileURLToPath } from "node:url";

import { beforeAll, expect, test } from "vitest";

import { SKINS } from ".";

// The real app, built as `pnpm build` builds it (vite.config.ts), in memory.
// What a person who stays on « Crête » downloads is the page, the stylesheet it
// links, the entry and the parts it preloads: none of them has anything of
// another skin, neither a sheet nor a motif. Each other skin is a part of its
// own (its look), with its sheets, which the table of the page names for the
// script that links them when the skin is the one kept on the device.

const web = fileURLToPath(new URL("../../", import.meta.url));

type Chunk = {
  type: "chunk";
  fileName: string;
  isEntry: boolean;
  facadeModuleId: string | null;
  moduleIds: readonly string[];
  imports: readonly string[];
  code: string;
};
type Asset = { type: "asset"; fileName: string; source: string | Uint8Array };

let files = new Map<string, Chunk | Asset>();
let html = "";

beforeAll(async () => {
  const { build } = await import("vite");
  const output = await build({
    root: web,
    configFile: `${web}vite.config.ts`,
    logLevel: "silent",
    build: { write: false, emptyOutDir: false },
  });
  const outputs: readonly (Chunk | Asset)[] = (Array.isArray(output) ? output : [output]).flatMap(
    (one) => ("output" in one ? one.output : []),
  );
  files = new Map(outputs.map((file) => [file.fileName, file]));
  html = textOf("index.html");
}, 120_000);

const slashed = (path: string) => path.replaceAll("\\", "/");

const byText = (a: string, b: string) => a.localeCompare(b);

/** The folder of src/skins/ that a module of the build is in, if any (`nuit`, `shared`, `crete`…). */
function skinFolderOf(moduleId: string): string | undefined {
  return /\/src\/skins\/([^/]+)\//.exec(slashed(moduleId))?.[1];
}

/** The text of a file of the build. */
function textOf(fileName: string): string {
  const file = files.get(fileName);
  if (file === undefined) return "";
  return file.type === "chunk" ? file.code : String(file.source);
}

/** A chunk and every chunk it imports, statically, as the browser loads them with it. */
function withImports(fileName: string, seen = new Set<string>()): Set<string> {
  const file = files.get(fileName);
  if (seen.has(fileName) || file?.type !== "chunk") return seen;
  seen.add(fileName);
  for (const imported of file.imports) withImports(imported, seen);
  return seen;
}

/** The stylesheets that the table of the skins in the page names for each, by its id. */
function sheetsByTable(): Map<string, string[]> {
  const table: unknown = JSON.parse(/const skins = (\{.*?\});/.exec(html)?.[1] ?? "{}");
  if (typeof table !== "object" || table === null) return new Map();
  return new Map(
    Object.entries(table).map(([id, entry]: [string, unknown]) => {
      const sheets: unknown =
        typeof entry === "object" && entry !== null && "sheets" in entry ? entry.sheets : [];
      return [id, Array.isArray(sheets) ? sheets.map(String) : []];
    }),
  );
}

/** How a selector names the page of a skin: the minifier may drop the quotes (`[data-skin=nuit]`). */
const names = (id: string) => [`[data-skin="${id}"]`, `[data-skin=${id}]`];

/** The skins of a build but Crête. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete" && !skin.id.startsWith("_"));

test("build — la page de Crête ne lie qu'une feuille, sans rien d'un autre skin : ni ses couleurs, ni ses polices", () => {
  const linked = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map(
    ([, href = ""]) => href,
  );
  expect(linked).toHaveLength(1);
  const sheet = textOf(linked[0] ?? "");
  expect(sheet.length, "the stylesheet of the page").toBeGreaterThan(1000);
  // Crête is the page without `data-skin` (`:root:not([data-skin])`): no rule names a skin.
  expect(sheet.match(/\[data-skin="?[a-z_]+"?\]/g) ?? []).toEqual([]);
  const families = new Set(
    [...sheet.matchAll(/@font-face\{[^}]*font-family:\s*"?([^";}]+)"?/g)].map(
      ([, family = ""]) => family,
    ),
  );
  expect([...families].toSorted(byText)).toEqual(["Inter Variable", "Plus Jakarta Sans Variable"]);
});

test("build — l'entrée et les parties qu'elle précharge n'ont rien d'un autre skin que Crête", () => {
  const entry = [...files.values()].find((file) => file.type === "chunk" && file.isEntry);
  expect(entry, "the entry of the build").toBeDefined();
  const loaded = withImports(entry?.fileName ?? "");
  // What the page preloads is in it.
  const preloaded = [...html.matchAll(/<link rel="modulepreload"[^>]*href="\/([^"]+)"/g)].map(
    ([, href = ""]) => href,
  );
  expect(preloaded.filter((href) => !loaded.has(href))).toEqual([]);
  const modules = [...loaded].flatMap((fileName) => {
    const file = files.get(fileName);
    return file?.type === "chunk" ? file.moduleIds.map((id) => ({ fileName, id })) : [];
  });
  const strangers = modules
    .filter(({ id }) => {
      const folder = skinFolderOf(id);
      // Crête's motifs, and the index of each skin: the registry, for the picker.
      return folder !== undefined && folder !== "crete" && !slashed(id).endsWith("/index.ts");
    })
    .map(({ fileName, id }) => `${fileName}: ${slashed(id).replace(/^.*\/src\//, "src/")}`);
  expect(strangers).toEqual([]);
  // Not an empty search: Crête's motifs are there.
  expect(modules.some(({ id }) => skinFolderOf(id) === "crete")).toBe(true);
});

test("build — chaque autre skin est une partie à part, ses feuilles nommées dans la table de la page, sans celles d'un autre", () => {
  const looks = new Map(
    [...files.values()].flatMap((file) =>
      file.type === "chunk" &&
      file.facadeModuleId !== null &&
      slashed(file.facadeModuleId).endsWith("/look.ts")
        ? [[skinFolderOf(file.facadeModuleId) ?? "", file] as const]
        : [],
    ),
  );
  const ids = OTHERS.map((skin) => skin.id).toSorted(byText);
  expect([...looks.keys()].toSorted(byText)).toEqual(ids);
  const table = sheetsByTable();
  expect([...table.keys()].toSorted(byText)).toEqual(ids);
  for (const skin of OTHERS) {
    const sheets = table.get(skin.id) ?? [];
    expect(sheets.length, `the sheets of ${skin.id}`).toBeGreaterThan(0);
    const missing = sheets.filter((href) => !files.has(href.slice(1)));
    expect(missing, `the sheets of ${skin.id} that are not files of the build`).toEqual([]);
    const css = sheets.map((href) => textOf(href.slice(1))).join("\n");
    expect(
      names(skin.id).some((name) => css.includes(`:root${name}`)),
      `the palette of ${skin.id}`,
    ).toBe(true);
    const others = OTHERS.filter(
      (one) => one !== skin && names(one.id).some((name) => css.includes(name)),
    );
    expect(
      others.map((one) => one.id),
      `the palettes of other skins in the sheets of ${skin.id}`,
    ).toEqual([]);
    // Its look brings no other skin's look along.
    const look = looks.get(skin.id);
    const brought = [...withImports(look?.fileName ?? "")].filter(
      (fileName) =>
        fileName !== look?.fileName && [...looks.values()].some((one) => one.fileName === fileName),
    );
    expect(brought, `what the look of ${skin.id} brings`).toEqual([]);
  }
});

test("build — rien du skin de développement", () => {
  const found = [...files].flatMap(([fileName, file]) => [
    ...(file.type === "chunk" ? file.moduleIds : [])
      .filter((id) => skinFolderOf(id)?.startsWith("_"))
      .map((id) => `${fileName}: ${id}`),
    ...(textOf(fileName).includes('data-skin="_example"') ? [`${fileName}: its palette`] : []),
  ]);
  expect(found).toEqual([]);
});
