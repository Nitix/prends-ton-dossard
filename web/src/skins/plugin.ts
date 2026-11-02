import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

import type { Mode } from "./types.ts";

// The skins at build time: what vite.config.ts runs, in Node, never in the page.
// It leaves the skins of development out of a build, and writes into
// index.html the table of the skins that its script needs before the page is
// first drawn: the modes of each, the colour of the bar, and in a build the
// stylesheets of its look, which the script links. See README.md.

/** The skin of the app when none is chosen: it is drawn by styles.css itself, with no `data-skin`. */
export const DEFAULT_SKIN = "crete";

/** The empty module that stands for each file of a skin of development in a build. */
const NOTHING = "\0ptd-skins:nothing";

/** What it exports: the name that the glob of the registry (`skin`) imports from it, with nothing in it. */
const NOTHING_CODE = "export const skin = undefined;\n";

/** A path with the separators of a module id (`/`), without its query. */
const slashed = (path: string) => path.split("?")[0]?.replaceAll("\\", "/") ?? "";

/**
 * Whether a module (by its id) is a file of a skin of development: in a folder
 * of `skinsDir` whose name starts with `_`.
 */
export function isDevSkinFile(id: string, skinsDir: string): boolean {
  const dir = `${slashed(skinsDir).replace(/\/$/, "")}/`;
  const path = slashed(id);
  return path.startsWith(dir) && /^_[^/]+\/./.test(path.slice(dir.length));
}

/**
 * What the page needs of a skin before it is drawn: its modes, the colour of
 * the browser's bar, and the stylesheets of its look (`/assets/…`): none in
 * the dev server, where its look brings them.
 */
export type TableEntry = { modes: readonly Mode[]; themeColor: string; sheets: readonly string[] };

/** The skins that the page applies before it is drawn, by id. */
export type SkinTable = Record<string, TableEntry>;

/**
 * The table of the skins, from their folders: each one that has an `index.ts`,
 * with the modes and the theme colour it declares (`modes: ["light", "dark"]`,
 * `themeColor: "#rrggbb"`) and its stylesheets in `sheets` (see `lookSheets`),
 * but Crête, which is what the page is without a skin. A folder whose name
 * starts with `_` is a skin of development, left out of a build. plugin.test.ts
 * checks that the table says what the registry finds.
 */
export function skinTable(
  skinsDir: string,
  { dev, sheets = {} }: { dev: boolean; sheets?: Readonly<Record<string, readonly string[]>> },
): SkinTable {
  const table: SkinTable = {};
  for (const entry of readdirSync(skinsDir, { withFileTypes: true })) {
    const index = join(skinsDir, entry.name, "index.ts");
    if (!entry.isDirectory() || !existsSync(index) || entry.name === DEFAULT_SKIN) continue;
    if (entry.name.startsWith("_") && !dev) continue;
    const source = readFileSync(index, "utf8");
    const modes = declaredModes(source);
    if (modes.length === 0) {
      throw new Error(`${index} declares no modes (modes: ["light"], ["dark"] or both)`);
    }
    const themeColor = declaredThemeColor(source);
    if (themeColor === undefined) {
      throw new Error(`${index} declares no theme colour (themeColor: "#rrggbb")`);
    }
    table[entry.name] = { modes, themeColor, sheets: sheets[entry.name] ?? [] };
  }
  return table;
}

const isMode = (value: string | undefined): value is Mode => value === "light" || value === "dark";

/** The modes that the source of a skin's `index.ts` declares (`modes: ["light", "dark"]`), in order. */
export function declaredModes(source: string): Mode[] {
  const declared = /\bmodes:\s*\[([^\]]*)\]/.exec(source)?.[1] ?? "";
  return [...declared.matchAll(/["']([a-z]+)["']/g)].map((match) => match[1]).filter(isMode);
}

/** The theme colour that the source of a skin's `index.ts` declares (`themeColor: "#rrggbb"`). */
export function declaredThemeColor(source: string): string | undefined {
  return /\bthemeColor:\s*["'](#[0-9a-fA-F]{6})["']/.exec(source)?.[1];
}

/** What the plugin reads of a file of a build. */
export type BuiltFile =
  | {
      type: "chunk";
      fileName: string;
      isEntry: boolean;
      facadeModuleId: string | null;
      /** The chunks it imports, statically: the browser loads them with it. */
      imports: readonly string[];
      /** The stylesheets of its modules, as Vite emits them (`assets/…css`). */
      viteMetadata?: { importedCss: ReadonlySet<string> };
    }
  | { type: "asset"; fileName: string };

/**
 * The stylesheets of the look of each skin in a build, by its id: those of the
 * part of its `look.ts` and of the parts it imports (a face that two skins
 * share is in a sheet of its own), but those of the entry, which the page links
 * already. The script of index.html links them for the skin kept on the
 * device; the look links them when it is chosen, and leaves those the page
 * has. A skin of the table with no part for its look is a mistake of the build.
 */
export function lookSheets(
  bundle: Readonly<Record<string, BuiltFile>>,
  skinsDir: string,
  base: string,
): Record<string, string[]> {
  const dir = `${slashed(skinsDir).replace(/\/$/, "")}/`;
  const cssOf = (fileName: string, seen: Set<string>): string[] => {
    const file = bundle[fileName];
    if (seen.has(fileName) || file?.type !== "chunk") return [];
    seen.add(fileName);
    return [
      ...(file.viteMetadata?.importedCss ?? []),
      ...file.imports.flatMap((imported) => cssOf(imported, seen)),
    ];
  };
  const chunks = Object.values(bundle).filter((file) => file.type === "chunk");
  const linked = new Set(
    chunks.filter((chunk) => chunk.isEntry).flatMap((chunk) => cssOf(chunk.fileName, new Set())),
  );
  const sheets: Record<string, string[]> = {};
  for (const chunk of chunks) {
    const path = slashed(chunk.facadeModuleId ?? "");
    const id = path.startsWith(dir)
      ? /^([^/]+)\/look\.ts$/.exec(path.slice(dir.length))?.[1]
      : undefined;
    if (id === undefined) continue;
    sheets[id] = [...new Set(cssOf(chunk.fileName, new Set()))]
      .filter((sheet) => !linked.has(sheet))
      .map((sheet) => `${base}${sheet}`);
  }
  return sheets;
}

/** Where index.html has the table of the skins, in its inline script. */
const PLACE = "/* skins */ {}";

/** The page with the table of the skins written in its inline script. */
export function withSkins(html: string, table: SkinTable): string {
  if (!html.includes(PLACE)) {
    throw new Error(`index.html has no place for the table of the skins (${PLACE})`);
  }
  return html.replace(PLACE, () => JSON.stringify(table));
}

/**
 * A page as the server of Vite gives it: the page of the app (`/index.html`)
 * with the table of the skins; another one (the pages of the browser tests) as
 * it is.
 */
export function pageWithSkins(html: string, path: string, table: () => SkinTable): string {
  return path === "/index.html" ? withSkins(html, table()) : html;
}

/** The plugin of the skins, for vite.config.ts. */
export function skins(): Plugin {
  let skinsDir = fileURLToPath(new URL(".", import.meta.url));
  let dev = false;
  let base = "/";

  return {
    name: "ptd-skins",
    // Before the resolver of Vite, which would find the files of a skin of development first.
    enforce: "pre",
    configResolved(config) {
      skinsDir = join(config.root, "src", "skins");
      dev = config.command === "serve";
      base = config.base;
    },
    async resolveId(source, importer, options) {
      // A build has no skin of development: each of its files (an index, a
      // stylesheet, which the globs of the registry and of the sheets find) is
      // one empty module there, so that the build has nothing of it, not even
      // an empty stylesheet. The registry leaves out the module of its index.
      if (dev || !source.includes("_")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved !== null && isDevSkinFile(resolved.id, skinsDir) ? NOTHING : resolved;
    },
    load(id) {
      return id === NOTHING ? NOTHING_CODE : null;
    },
    // In a build, after the bundle: the stylesheets of each look are its files.
    transformIndexHtml(html, { path, bundle }) {
      return pageWithSkins(html, path, () => {
        if (bundle === undefined) return skinTable(skinsDir, { dev });
        const sheets = lookSheets(bundle, skinsDir, base);
        const table = skinTable(skinsDir, { dev, sheets });
        const missing = Object.keys(table).filter((id) => sheets[id] === undefined);
        if (missing.length > 0) {
          throw new Error(
            `The build has no part for the look of ${missing.join(", ")} (skins/<id>/look.ts)`,
          );
        }
        return table;
      });
    },
  };
}
