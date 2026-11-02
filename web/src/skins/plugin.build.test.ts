import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, expect, test } from "vitest";

import { DEPTHS, type Depth } from "./types";

// The plugin of the skins in a real build, on a small app of its own: two
// skins, one of them of development, each with a stylesheet and a variant at
// every depth, and the real files of the depths. A build at each depth keeps
// the files of that depth and of the ones before it, of the real skin only.

const skinsDir = fileURLToPath(new URL(".", import.meta.url));
let root = "";

function write(path: string, text: string) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
}

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "ptd-skins-"));
  for (const depth of DEPTHS) {
    write(
      `src/skins/depth/${depth}.ts`,
      readFileSync(join(skinsDir, "depth", `${depth}.ts`), "utf8"),
    );
  }
  for (const id of ["real", "_dev"]) {
    write(`src/skins/${id}/index.ts`, `export const skin = { id: "${id}" };\n`);
    for (const level of DEPTHS) {
      write(`src/skins/${id}/${level}.css`, `.${id.replace("_", "dev")}-${level} { order: 1; }\n`);
    }
    for (const level of ["mix", "full"]) {
      write(
        `src/skins/${id}/${level}.tsx`,
        `export const variants = { ${id.replace("_", "dev")}${level}: () => null };\n`,
      );
    }
  }
  // What the app does: the registry's glob of the indexes, the module of the depth.
  write(
    "src/main.ts",
    [
      'import { variants } from "virtual:skin-depth";',
      'const skins = import.meta.glob("./skins/*/index.ts", { eager: true, import: "skin" });',
      "console.log(Object.keys(variants), Object.values(variants).map(Object.keys), skins);",
      "",
    ].join("\n"),
  );
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

/** The JS and the CSS of a build of the small app at a depth. */
async function built(depth: Depth): Promise<{ js: string; css: string }> {
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
      build: { write: false, minify: false, rollupOptions: { input: join(root, "src/main.ts") } },
    });
    const files = (Array.isArray(output) ? output : [output]).flatMap((one) =>
      "output" in one ? one.output : [],
    );
    const text = (kind: "chunk" | "asset") =>
      files
        .filter((file) => file.type === kind)
        .map((file) => ("code" in file ? file.code : String(file.source)))
        .join("\n");
    return { js: text("chunk"), css: text("asset") };
  } finally {
    if (before === undefined) delete process.env.VITE_SKIN_DEPTH;
    else process.env.VITE_SKIN_DEPTH = before;
  }
}

test("plugin.build — à chaque profondeur, le build réussit, garde ses niveaux et rien d'un skin de développement", async () => {
  const levels = {
    palette: ["palette"],
    mix: ["palette", "mix"],
    full: ["palette", "mix", "full"],
  };
  for (const depth of DEPTHS) {
    // A dev skin with a variant at mix and full: its module is empty in a build, with the names it should have.
    const { js, css } = await built(depth);
    for (const level of DEPTHS) {
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
