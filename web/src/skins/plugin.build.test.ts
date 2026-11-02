import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

import { DEPTHS, type Depth } from "./types";

// The plugin of the skins in a real build, on a small app of its own: two
// skins, one of them of development, each with a stylesheet and a variant at
// every depth, a stylesheet of fonts, and the real files of the depths. A build
// at each depth keeps the files of that depth and of the ones before it, of the
// real skin only, and the fonts (fonts.css) at every depth. The app is made as
// the real one: its page, its entry with its stylesheet and the one of the
// skins (skins/styles.ts), and a part loaded later that uses the registry with
// a stylesheet of its own (the map, in the real app). The sheets of the skins
// are in the stylesheet of the entry, the only one the page links.

const skinsDir = fileURLToPath(new URL(".", import.meta.url));
let root = "";

function write(path: string, text: string) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Lines of a file, as written. */
const lines = (...text: string[]) => `${text.join("\n")}\n`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ptd-skins-"));
  for (const depth of DEPTHS) {
    for (const file of [`${depth}.ts`, `${depth}.styles.ts`]) {
      write(`src/skins/depth/${file}`, readFileSync(join(skinsDir, "depth", file), "utf8"));
    }
  }
  write("src/skins/styles.ts", readFileSync(join(skinsDir, "styles.ts"), "utf8"));
  for (const id of ["real", "_dev"]) {
    write(
      `src/skins/${id}/index.ts`,
      `export const skin = { id: "${id}", modes: ["light"], themeColor: "#000000" };\n`,
    );
    for (const level of ["fonts", ...DEPTHS]) {
      write(`src/skins/${id}/${level}.css`, `.${id.replace("_", "dev")}-${level} { order: 1; }\n`);
    }
    for (const level of ["mix", "full"]) {
      write(
        `src/skins/${id}/${level}.tsx`,
        `export const variants = { ${id.replace("_", "dev")}${level}: () => null };\n`,
      );
    }
  }
  // What the app does: the registry's glob of the indexes, the module of the depth…
  write(
    "src/registry.ts",
    lines(
      'import { variants } from "virtual:skin-depth";',
      'const skins = import.meta.glob("./skins/*/index.ts", { eager: true, import: "skin" });',
      "export const registry = [Object.keys(variants), Object.values(variants).map(Object.keys), skins];",
    ),
  );
  // … a part loaded later, with a sheet of its own, that uses the registry too…
  write("src/later.css", ".later { order: 1; }\n");
  write(
    "src/later.ts",
    lines(
      'import "./later.css";',
      'import { registry } from "./registry";',
      "export const later = registry;",
    ),
  );
  // … and the entry: its own sheet, then the skins' (as main.tsx).
  write("src/base.css", ".base { order: 1; }\n");
  write(
    "src/main.ts",
    lines(
      'import { registry } from "./registry";',
      'import "./base.css";',
      'import "./skins/styles";',
      "console.log(registry);",
      'void import("./later").then((module) => console.log(module.later));',
    ),
  );
  write(
    "index.html",
    lines(
      "<!doctype html><html><head><script>const skins = /* skins */ {};</script>",
      '<script type="module" src="/src/main.ts"></script></head>',
      "<body></body></html>",
    ),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The JS and the CSS of a build of the small app at a depth, and the sheets its page links. */
async function built(depth: Depth): Promise<{ js: string; css: string; linked: string[] }> {
  const { build } = await import("vite");
  const { skins } = await import("./plugin");
  const before = process.env.VITE_SKIN_DEPTH;
  process.env.VITE_SKIN_DEPTH = depth;
  try {
    const output = await build({
      root,
      configFile: false,
      envFile: false,
      logLevel: "silent",
      plugins: [skins()],
      build: { write: false, minify: false, rollupOptions: { input: join(root, "index.html") } },
    });
    const files = (Array.isArray(output) ? output : [output]).flatMap((one) =>
      "output" in one ? one.output : [],
    );
    const source = (file: (typeof files)[number]) =>
      "code" in file ? file.code : String(file.source);
    const html = files
      .filter((file) => file.fileName.endsWith(".html"))
      .map(source)
      .join("\n");
    const sheets = files.filter((file) => file.fileName.endsWith(".css"));
    // The sheets that the page links: what the browser waits for before it draws the page.
    const linked = [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map((match) =>
      sheets.find((sheet) => sheet.fileName === match[1]),
    );
    return {
      js: files
        .filter((file) => file.type === "chunk")
        .map(source)
        .join("\n"),
      css: sheets.map(source).join("\n"),
      linked: linked.map((sheet) => (sheet === undefined ? "" : source(sheet))),
    };
  } finally {
    if (before === undefined) delete process.env.VITE_SKIN_DEPTH;
    else process.env.VITE_SKIN_DEPTH = before;
  }
}

test("plugin.build — à chaque profondeur, le build réussit, garde ses niveaux et rien d'un skin de développement", async () => {
  const levels = {
    palette: ["fonts", "palette"],
    mix: ["fonts", "palette", "mix"],
    full: ["fonts", "palette", "mix", "full"],
  };
  for (const depth of DEPTHS) {
    // A dev skin with a variant at mix and full: its module is empty in a build, with the names it should have.
    const { js, css } = await built(depth);
    for (const level of ["fonts", ...DEPTHS]) {
      const kept = levels[depth].includes(level);
      expect(css.includes(`.real-${level}`), `${depth}: the ${level}.css of a skin`).toBe(kept);
      expect(css.includes(`.dev-${level}`), `${depth}: the ${level}.css of a dev skin`).toBe(false);
    }
    for (const level of ["mix", "full"]) {
      const kept = levels[depth].includes(level);
      expect(js.includes(`real${level}`), `${depth}: the ${level}.tsx of a skin`).toBe(kept);
      expect(js.includes(`dev${level}`), `${depth}: the ${level}.tsx of a dev skin`).toBe(false);
    }
    expect(js, `${depth}: the index of the dev skin`).not.toContain('"_dev"');
    expect(js, `${depth}: the index of the skin`).toContain('"real"');
  }
}, 30_000);

test("plugin.build — les feuilles des skins sont dans la feuille de l'entrée, la seule que la page lie", async () => {
  for (const depth of DEPTHS) {
    const { linked, css } = await built(depth);
    // One stylesheet for the page: the entry's, with the skins' in it, after its own.
    expect(linked, `${depth}: the stylesheets of the page`).toHaveLength(1);
    const [sheet = ""] = linked;
    for (const part of [".base", ".real-fonts", ".real-palette"]) {
      expect(sheet, `${depth}: ${part}`).toContain(part);
    }
    expect(sheet.indexOf(".base"), `the order at ${depth}`).toBeLessThan(
      sheet.indexOf(".real-palette"),
    );
    // The part loaded later keeps its own sheet, which the page does not wait for.
    expect(sheet, `the page at ${depth}`).not.toContain(".later");
    expect(css, `the sheets at ${depth}`).toContain(".later");
  }
}, 30_000);
