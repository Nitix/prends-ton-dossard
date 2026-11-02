import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

// The plugin of the skins in a real build, on a small app of its own: two
// skins, one of them of development, each with its fonts and its palette. The
// build keeps the real skin's sheets, and nothing of the skin of development.
// The app is made as the real one: its page, its entry with its stylesheet and
// the one of the skins (skins/styles.ts), and a part loaded later that uses the
// registry with a stylesheet of its own (the map, in the real app). The sheets
// of the skins are in the stylesheet of the entry, the only one the page links.

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
  write("src/skins/styles.ts", readFileSync(join(skinsDir, "styles.ts"), "utf8"));
  for (const id of ["real", "_dev"]) {
    write(
      `src/skins/${id}/index.ts`,
      `export const skin = { id: "${id}", modes: ["light"], themeColor: "#000000" };\n`,
    );
    for (const level of ["fonts", "palette"]) {
      write(`src/skins/${id}/${level}.css`, `.${id.replace("_", "dev")}-${level} { order: 1; }\n`);
    }
  }
  // What the app does: the registry's glob of the indexes…
  write(
    "src/registry.ts",
    lines(
      'const skins = import.meta.glob("./skins/*/index.ts", { eager: true, import: "skin" });',
      "export const registry = skins;",
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

/** The JS and the CSS of a build of the small app, and the sheets its page links. */
async function built(): Promise<{ js: string; css: string; linked: string[] }> {
  const { build } = await import("vite");
  const { skins } = await import("./plugin");
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
}

test("plugin.build — le build réussit, garde les feuilles d'un skin et rien d'un skin de développement", async () => {
  const { js, css } = await built();
  for (const level of ["fonts", "palette"]) {
    expect(css, `the ${level}.css of a skin`).toContain(`.real-${level}`);
    expect(css, `the ${level}.css of a dev skin`).not.toContain(`.dev-${level}`);
  }
  expect(js, "the index of the dev skin").not.toContain('"_dev"');
  expect(js, "the index of the skin").toContain('"real"');
}, 30_000);

test("plugin.build — les feuilles des skins sont dans la feuille de l'entrée, la seule que la page lie", async () => {
  const { linked, css } = await built();
  // One stylesheet for the page: the entry's, with the skins' in it, after its own.
  expect(linked).toHaveLength(1);
  const [sheet = ""] = linked;
  for (const part of [".base", ".real-fonts", ".real-palette"])
    expect(sheet, `the sheet of the page: ${part}`).toContain(part);
  expect(sheet.indexOf(".base")).toBeLessThan(sheet.indexOf(".real-palette"));
  // The part loaded later keeps its own sheet, which the page does not wait for.
  expect(sheet).not.toContain(".later");
  expect(css).toContain(".later");
}, 30_000);
