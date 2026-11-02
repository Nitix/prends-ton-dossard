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
  /** The stylesheets of its modules, as Vite emits them. */
  viteMetadata?: { importedCss: ReadonlySet<string> };
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

/** The files of a kind (`sheets`, `scripts`) that the table of the skins in the page names for each, by its id. */
function filesByTable(kind: "sheets" | "scripts"): Map<string, string[]> {
  const table: unknown = JSON.parse(/const skins = (\{.*?\});/.exec(html)?.[1] ?? "{}");
  if (typeof table !== "object" || table === null) return new Map();
  return new Map(
    Object.entries(table).map(([id, entry]: [string, unknown]) => {
      const named: unknown =
        typeof entry === "object" && entry !== null && kind in entry
          ? Object.entries(entry).find(([key]) => key === kind)?.[1]
          : [];
      return [id, Array.isArray(named) ? named.map(String) : []];
    }),
  );
}

/** The stylesheets that the table of the skins in the page names for each, by its id. */
const sheetsByTable = () => filesByTable("sheets");

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
    // Its parts, preloaded with its sheets: its look first, none of the entry's.
    const look = looks.get(skin.id);
    const scripts = filesByTable("scripts").get(skin.id) ?? [];
    expect(scripts[0], `the first part of ${skin.id}`).toBe(`/${look?.fileName ?? ""}`);
    const entryParts = withImports(
      [...files.values()].find((file) => file.type === "chunk" && file.isEntry)?.fileName ?? "",
    );
    expect(
      scripts.filter((href) => !files.has(href.slice(1)) || entryParts.has(href.slice(1))),
      `the parts of ${skin.id} that are not its own`,
    ).toEqual([]);
    // Its look brings no other skin's look along.
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

test("build — les polices des échantillons du sélecteur viennent avec la section « Apparence », pas avec la page", () => {
  // The sheet of the faces of the samples (skins/samples.css): the one with
  // the face of Nuit's titles and no colour of a skin.
  const samples = [...files.values()].filter(
    (file) =>
      file.type === "asset" &&
      file.fileName.endsWith(".css") &&
      textOf(file.fileName).includes("Space Grotesk Variable") &&
      !textOf(file.fileName).includes("data-skin"),
  );
  expect(samples.map((file) => file.fileName)).toHaveLength(1);
  const sheet = samples[0]?.fileName ?? "";
  expect(html, "the page links it").not.toContain(sheet);
  const importers = [...files.values()].filter(
    (file): file is Chunk =>
      file.type === "chunk" && (file.viteMetadata?.importedCss.has(sheet) ?? false),
  );
  expect(importers.length, "the parts that bring it").toBeGreaterThan(0);
  expect(
    importers
      .filter(
        (chunk) => !chunk.moduleIds.some((id) => slashed(id).endsWith("/AppearanceSection.tsx")),
      )
      .map((chunk) => chunk.fileName),
    "parts without the section that bring it",
  ).toEqual([]);
});

/** A rule of a stylesheet: its selector, its declarations, and the at-rules around it (`@layer utilities @media …`). */
type StyleRule = { where: string; selector: string; declarations: Map<string, string> };

/**
 * The style rules of a built stylesheet (minified, flat: no nesting), in the
 * at-rules that hold rules (`@layer`, `@media`, `@supports`, `@container`);
 * the bodies of `@keyframes`, `@font-face` and `@property` are not rules of
 * the page and are left out.
 */
function styleRules(text: string, where = ""): StyleRule[] {
  const css = text.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: StyleRule[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    const semicolon = css.indexOf(";", at);
    if (open === -1) break;
    // A statement (`@layer a,b;`) before the next block.
    if (semicolon !== -1 && semicolon < open) {
      at = semicolon + 1;
      continue;
    }
    let depth = 0;
    let close = open + 1;
    for (; close < css.length; close++) {
      if (css[close] === "{") depth++;
      if (css[close] === "}") {
        if (depth === 0) break;
        depth--;
      }
    }
    const prelude = css.slice(at, open).trim();
    const body = css.slice(open + 1, close);
    if (/^@(layer|media|supports|container)\b/.test(prelude)) {
      found.push(...styleRules(body, `${where} ${prelude}`.trim()));
    } else if (!prelude.startsWith("@")) {
      const declarations = new Map(
        body
          .split(";")
          .map((part) => part.trim())
          .filter((part) => part.includes(":"))
          .map((part) => [
            part.slice(0, part.indexOf(":")).trim(),
            part.slice(part.indexOf(":") + 1).trim(),
          ]),
      );
      found.push({ where, selector: prelude, declarations });
    }
    at = close + 1;
  }
  return found;
}

/** The custom properties (and other properties) that the rules of a sheet declare. */
const declared = (css: string) =>
  new Set(styleRules(css).flatMap(({ declarations }) => [...declarations.keys()]));

/** The one stylesheet that the page links: the entry's. */
const entrySheet = () =>
  textOf(/<link rel="stylesheet"[^>]*href="\/([^"]+)"/.exec(html)?.[1] ?? "");

test("build — aucun sélecteur d'une feuille d'un look n'est un sélecteur de la feuille de l'entrée : les deux ne se rencontrent pas, dans quelque ordre que la page les ait", () => {
  // index.html links the sheets of the skin kept before the entry's; a look
  // chosen later adds them after it. A rule of a look on a selector of the
  // entry (a utility of Tailwind, `.hidden`, `.md\:flex`) would win or lose by
  // that order alone, on the motifs and on the app. The only selectors they
  // share are Tailwind's own (`:root`, `*`), where a look declares its own
  // properties (prefixed: `--nuit-spacing`), and Tailwind's (`--tw-*`) with
  // the entry's value when the entry has them.
  const entry = styleRules(entrySheet());
  const bySelector = new Map<string, Map<string, string>>();
  for (const { selector, declarations } of entry) {
    bySelector.set(selector, new Map([...(bySelector.get(selector) ?? []), ...declarations]));
  }
  expect(entry.length, "the rules of the entry").toBeGreaterThan(500);
  const problems = OTHERS.flatMap((skin) =>
    (sheetsByTable().get(skin.id) ?? []).flatMap((href) =>
      styleRules(textOf(href.slice(1))).flatMap(({ selector, declarations }) => {
        const theirs = bySelector.get(selector);
        if (theirs === undefined) return [];
        if (selector.includes(".")) return [`${skin.id}, ${href}: ${selector}`];
        return [...declarations]
          .filter(([property, value]) => theirs.has(property) && theirs.get(property) !== value)
          .map(([property, value]) => `${skin.id}, ${href}: ${selector} { ${property}: ${value} }`);
      }),
    ),
  );
  expect(problems).toEqual([]);
});

test("build — chaque propriété qu'un look lit est posée sur la page : par l'entrée, ou par les feuilles du look", () => {
  // A utility of a look reads the colours, radii and fonts of the page
  // (skins/theme-vars.css): Tailwind leaves out of a sheet the properties of
  // its theme that nothing in it uses, so each one read must be set somewhere.
  const entry = declared(entrySheet());
  const problems = OTHERS.flatMap((skin) => {
    const sheets = (sheetsByTable().get(skin.id) ?? []).map((href) => textOf(href.slice(1)));
    const own = new Set(sheets.flatMap((css) => [...declared(css)]));
    const read = new Set(
      sheets.flatMap((css) => [...css.matchAll(/var\((--[\w-]+)/g)].map(([, name = ""]) => name)),
    );
    return [...read]
      .filter((name) => !entry.has(name) && !own.has(name))
      .map((name) => `${skin.id}: ${name}`);
  });
  expect(problems).toEqual([]);
});
