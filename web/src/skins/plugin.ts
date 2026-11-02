import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnv, type Plugin } from "vite";

import { DEPTHS, type Depth, type Mode } from "./types.ts";

// The skins at build time: what vite.config.ts runs, in Node, never in the page.
// It sets the depth of the build (`VITE_SKIN_DEPTH`), points the modules of the
// depth at the files that bundle the variants and the stylesheets of that depth
// (./depth/), and writes into index.html the table of the skins that its script
// needs before the page is first drawn. See README.md.

/** The module the registry imports for the variants of the depth of the build. */
export const DEPTH_MODULE = "virtual:skin-depth";

/** The module main.tsx imports (through ./styles.ts) for the stylesheets of the depth of the build. */
export const STYLES_MODULE = "virtual:skin-styles";

/** The skin of the app when none is chosen: it is drawn by styles.css itself, with no `data-skin`. */
export const DEFAULT_SKIN = "crete";

/** The depth of a build, from the value of `VITE_SKIN_DEPTH`: palette when it is not set. */
export function skinDepth(value: string | undefined): Depth {
  if (value === undefined || value === "") return "palette";
  const depth = DEPTHS.find((one) => one === value);
  if (depth === undefined) {
    throw new Error(
      `VITE_SKIN_DEPTH is "${value}": it must be one of ${DEPTHS.join(", ")} (or not set, for palette)`,
    );
  }
  return depth;
}

/**
 * Where Vite reads the `.env` files of a config, as Vite does: none with
 * `envDir: false`, the root without an `envDir`, a relative one from the root.
 */
export function envDirOf(config: { root?: string; envDir?: string | false }): string | false {
  if (config.envDir === false) return false;
  const root = resolve(config.root ?? process.cwd());
  return config.envDir === undefined ? root : resolve(root, config.envDir);
}

/** The file of the variants of a depth: its `import.meta.glob` takes the levels up to it. */
export function depthFile(skinsDir: string, depth: Depth): string {
  return join(skinsDir, "depth", `${depth}.ts`);
}

/** The file of the stylesheets of a depth: its `import.meta.glob` calls take the levels up to it. */
export function stylesFile(skinsDir: string, depth: Depth): string {
  return join(skinsDir, "depth", `${depth}.styles.ts`);
}

/** The empty module that stands for each file of a skin of development in a build. */
const NOTHING = "\0ptd-skins:nothing";

/**
 * What it exports: the names that the globs of the registry (`skin`) and of the
 * depths (`variants`) import from it, with nothing in them.
 */
const NOTHING_CODE = "export const skin = undefined;\nexport const variants = {};\n";

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

/** What the page needs of a skin before it is drawn: its modes, and the colour of the browser's bar. */
export type TableEntry = { modes: readonly Mode[]; themeColor: string };

/** The skins that the page applies before it is drawn, by id. */
export type SkinTable = Record<string, TableEntry>;

/**
 * The table of the skins, from their folders: each one that has an `index.ts`,
 * with the modes and the theme colour it declares (`modes: ["light", "dark"]`,
 * `themeColor: "#rrggbb"`), but Crête, which is what the page is without a
 * skin. A folder whose name starts with `_` is a skin of development, left out
 * of a build. plugin.test.ts checks that the table says what the registry finds.
 */
export function skinTable(skinsDir: string, { dev }: { dev: boolean }): SkinTable {
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
    table[entry.name] = { modes, themeColor };
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

/**
 * The plugin of the skins, for vite.config.ts. The depth is a constant of the
 * build (`BUILD_SKIN_DEPTH`, the `SKIN_DEPTH` of index.ts), which a bundler can
 * use to drop what another depth would need.
 */
export function skins(): Plugin {
  let skinsDir = fileURLToPath(new URL(".", import.meta.url));
  let depth: Depth = "palette";
  let dev = false;

  return {
    name: "ptd-skins",
    // Before the resolver of Vite, which would find the files of a skin of development first.
    enforce: "pre",
    config(config, { mode }) {
      const dir = envDirOf(config);
      const env = dir === false ? {} : loadEnv(mode, dir, "VITE_");
      depth = skinDepth(process.env.VITE_SKIN_DEPTH ?? env.VITE_SKIN_DEPTH);
      return { define: { BUILD_SKIN_DEPTH: JSON.stringify(depth) } };
    },
    configResolved(config) {
      skinsDir = join(config.root, "src", "skins");
      dev = config.command === "serve";
    },
    async resolveId(source, importer, options) {
      if (source === DEPTH_MODULE) return depthFile(skinsDir, depth);
      if (source === STYLES_MODULE) return stylesFile(skinsDir, depth);
      // A build has no skin of development: each of its files (an index, a
      // stylesheet, a variant, which the globs of the registry and of the
      // depths find) is one empty module there, so that the build has nothing
      // of it, not even an empty stylesheet. The registry leaves out the
      // module of its index.
      if (dev || !source.includes("_")) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      return resolved !== null && isDevSkinFile(resolved.id, skinsDir) ? NOTHING : resolved;
    },
    load(id) {
      return id === NOTHING ? NOTHING_CODE : null;
    },
    transformIndexHtml(html, { path }) {
      return pageWithSkins(html, path, () => skinTable(skinsDir, { dev }));
    },
  };
}
