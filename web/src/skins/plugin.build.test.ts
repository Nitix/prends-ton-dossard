import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

// The plugin of the skins in a real build, on a small app of its own, made as
// the real one: its page with the script of the skins, its entry with its
// stylesheet, the registry's glob of the indexes, and the looks of the skins
// (skins/looks.ts, the real file) loaded later. Two skins share a folder that
// is not a skin (`shared/`: a face, a motif); a third is a skin of development.
// Each look is a part of its own, with its sheets: the page links the entry's
// stylesheet alone, and the table of the skins in its script names the sheets
// of each, which the script links for the skin kept on the device.

const skinsDir = fileURLToPath(new URL(".", import.meta.url));
let root = "";

function write(path: string, text: string) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

/** Lines of a file, as written. */
const lines = (...text: string[]) => `${text.join("\n")}\n`;

/** The class that a sheet of the small app draws: `.real-palette`, `.shared-fonts`… */
const mark = (folder: string, sheet: string) => `.${folder.replace("_", "dev")}-${sheet}`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ptd-skins-"));
  write("src/skins/looks.ts", readFileSync(join(skinsDir, "looks.ts"), "utf8"));
  // A folder that is not a skin: a face and a motif that two skins share.
  write("src/skins/shared/fonts.css", `${mark("shared", "fonts")} { order: 1; }\n`);
  write("src/skins/shared/motif.ts", 'export const motif = () => "shared-motif";\n');
  for (const id of ["real", "other", "_dev"]) {
    write(
      `src/skins/${id}/index.ts`,
      `export const skin = { id: "${id}", modes: ["light"], themeColor: "#000000" };\n`,
    );
    for (const sheet of ["fonts", "palette"]) {
      write(`src/skins/${id}/${sheet}.css`, `${mark(id, sheet)} { order: 1; }\n`);
    }
    const shared = id === "_dev" ? [] : ['import "../shared/fonts.css";'];
    write(
      `src/skins/${id}/look.ts`,
      lines(
        ...shared,
        'import "./fonts.css";',
        'import "./palette.css";',
        'import { motif } from "../shared/motif";',
        `export const slots = { name: "${id}-look", motif };`,
      ),
    );
  }
  // The entry: its own sheet, the registry, and the look of a skin when it is chosen.
  write("src/base.css", ".base { order: 1; }\n");
  write(
    "src/main.ts",
    lines(
      'import "./base.css";',
      'import { LOOKS } from "./skins/looks";',
      'const skins = import.meta.glob("./skins/*/index.ts", { eager: true, import: "skin" });',
      "console.log(skins);",
      "for (const load of Object.values(LOOKS)) void load().then((look) => console.log(look));",
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

type Built = {
  /** The code of the entry, and of every part of the build, by file. */
  entry: string;
  files: Map<string, string>;
  /** The sheets that the page links: what the browser waits for before it draws the page. */
  linked: string[];
  /** The sheets that the table of the skins, in the page, names for each skin, by its id. */
  table: Map<string, string[]>;
};

/** A build of the small app, in memory. */
async function built(): Promise<Built> {
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
  const outputs = (Array.isArray(output) ? output : [output]).flatMap((one) =>
    "output" in one ? one.output : [],
  );
  const files = new Map(
    outputs.map((file) => [file.fileName, "code" in file ? file.code : String(file.source)]),
  );
  const html = files.get("index.html") ?? "";
  const entry = outputs.find((file) => file.type === "chunk" && file.isEntry);
  const table: unknown = JSON.parse(/const skins = (\{.*?\});/.exec(html)?.[1] ?? "{}");
  return {
    entry: entry === undefined ? "" : (files.get(entry.fileName) ?? ""),
    files,
    linked: [...html.matchAll(/<link rel="stylesheet"[^>]*href="\/([^"]+)"/g)].map(
      (match) => files.get(match[1] ?? "") ?? "",
    ),
    table: new Map(
      typeof table === "object" && table !== null
        ? Object.entries(table).map(([id, value]: [string, unknown]) => {
            const sheets: unknown =
              typeof value === "object" && value !== null && "sheets" in value ? value.sheets : [];
            return [id, Array.isArray(sheets) ? sheets.map(String) : []];
          })
        : [],
    ),
  };
}

let app: Built;

beforeAll(async () => {
  app = await built();
}, 30_000);

/** The CSS of the sheets that the table names for a skin, as one text. */
const sheetsOf = (id: string) =>
  (app.table.get(id) ?? []).map((href) => app.files.get(href.replace(/^\//, "")) ?? "");

test("plugin.build — la page lie la feuille de l'entrée seule : aucune feuille d'un skin", () => {
  expect(app.linked).toHaveLength(1);
  const [sheet = ""] = app.linked;
  expect(sheet).toContain(".base");
  for (const folder of ["real", "other", "shared", "_dev"]) {
    for (const kind of ["fonts", "palette"]) {
      expect(app.linked.join("\n"), `${folder}/${kind}.css`).not.toContain(mark(folder, kind));
    }
  }
});

test("plugin.build — le look d'un skin est une partie à part : l'entrée n'en a rien", () => {
  for (const id of ["real", "other"]) {
    expect(app.entry, `the look of ${id}`).not.toContain(`${id}-look`);
    const parts = [...app.files].filter(
      ([name, code]) => name.endsWith(".js") && code.includes(`${id}-look`),
    );
    expect(parts, `the part of ${id}`).toHaveLength(1);
  }
  expect(app.entry, "a motif that two skins share").not.toContain("shared-motif");
});

test("plugin.build — la table des skins nomme les feuilles de chacun, celles qu'il partage comprises, et rien d'un autre", () => {
  expect([...app.table.keys()].toSorted((a, b) => a.localeCompare(b))).toEqual(["other", "real"]);
  for (const [id, other] of [
    ["real", "other"],
    ["other", "real"],
  ] as const) {
    const sheets = app.table.get(id) ?? [];
    expect(sheets.length, `the sheets of ${id}`).toBeGreaterThan(0);
    for (const href of sheets) {
      expect(href, `a sheet of ${id}`).toMatch(/^\/assets\/[^/]+\.css$/);
      expect(app.files.has(href.slice(1)), `${href} is a file of the build`).toBe(true);
    }
    const css = sheetsOf(id).join("\n");
    for (const part of [mark(id, "fonts"), mark(id, "palette"), mark("shared", "fonts")]) {
      expect(css, `${id}: ${part}`).toContain(part);
    }
    expect(css, `${id}: nothing of ${other}`).not.toContain(mark(other, "palette"));
    expect(css, `${id}: nothing of the entry`).not.toContain(".base");
  }
});

test("plugin.build — rien d'un skin de développement : ni son index, ni son look, ni ses feuilles", () => {
  for (const [name, code] of app.files) {
    expect(code, `${name}: the index of the dev skin`).not.toContain('"_dev"');
    expect(code, `${name}: the look of the dev skin`).not.toContain("_dev-look");
    expect(code, `${name}: the sheets of the dev skin`).not.toContain(".dev-");
  }
  expect(app.table.has("_dev")).toBe(false);
});
