import { existsSync, readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, posix } from "node:path";
import { fileURLToPath } from "node:url";

import { compile } from "tailwindcss";
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
      { modes: [...skin.modes], themeColor: skin.themeColor, sheets: [], scripts: [] },
    ]),
  );
  expect(table).toEqual(registered);
  // In the order of their names, whatever the order of the file system: the
  // page is the same on every machine that builds it.
  const ids = Object.keys(table);
  expect(ids).toEqual(ids.toSorted((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
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
    nuit: {
      modes: ["dark" as const],
      themeColor: "#0e1116",
      sheets: ["/assets/look-Nu1t.css"],
      scripts: ["/assets/look-Nu1t.js"],
    },
    alpage: {
      modes: ["light" as const, "dark" as const],
      themeColor: "#2f6b3a",
      sheets: [],
      scripts: [],
    },
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
  // Each folder that draws with classes has its sheet of utilities, scanning
  // its own files, with the folder's prefix (`nuit:size-12`).
  const missing = folders.filter((folder) => {
    if (!readdirSync(join(dir, folder)).some((file) => file.endsWith(".tsx"))) return false;
    const sheet = join(dir, folder, "utilities.css");
    const text = existsSync(sheet) ? readFileSync(sheet, "utf8") : "";
    return (
      !text.includes('@source "./*.tsx";') ||
      !text.includes(`@import "tailwindcss/theme.css" layer(theme) prefix(${folder});`) ||
      !text.includes(`@import "../theme-vars.css" prefix(${folder});`)
    );
  });
  expect(missing).toEqual([]);
});

/** The index after the string literal that starts at `start` (`"…"`, `'…'`, a template with its `${…}`). */
function afterString(source: string, start: number): number {
  const quote = source[start];
  let index = start + 1;
  while (index < source.length) {
    const char = source[index];
    if (char === "\\") index += 2;
    else if (quote === "`" && char === "$" && source[index + 1] === "{") {
      index = closing(source, index + 1) + 1;
    } else if (char === quote) return index + 1;
    else index++;
  }
  return source.length;
}

/** The index of the `}` that closes the `{` at `open`, over strings and nested braces. */
function closing(source: string, open: number): number {
  let depth = 0;
  let index = open;
  while (index < source.length) {
    const char = source[index];
    if (char === '"' || char === "'" || char === "`") {
      index = afterString(source, index);
      continue;
    }
    if (char === "{") depth++;
    if (char === "}" && --depth === 0) return index;
    index++;
  }
  return source.length;
}

/** The text of the string literals of an expression, the text of a template without its `${…}` and the literals inside those. */
function literals(expression: string): string[] {
  const found: string[] = [];
  let index = 0;
  while (index < expression.length) {
    const char = expression[index];
    if (char === '"' || char === "'") {
      const end = afterString(expression, index);
      found.push(expression.slice(index + 1, end - 1));
      index = end;
    } else if (char === "`") {
      let text = "";
      let at = index + 1;
      while (at < expression.length && expression[at] !== "`") {
        if (expression[at] === "\\") at += 2;
        else if (expression[at] === "$" && expression[at + 1] === "{") {
          const end = closing(expression, at + 1);
          found.push(...literals(expression.slice(at + 2, end)));
          text += " ";
          at = end + 1;
        } else text += expression[at++];
      }
      found.push(text);
      index = at + 1;
    } else index++;
  }
  return found;
}

/**
 * The class strings of the motifs of a folder: `className="…"`, a default
 * `className = "…"`, and every string of a `className={…}`, with those of the
 * `${…}` of its templates. Only what is held in a variable outside a
 * `className` is not seen (build.test.ts, and the shots, are what see it).
 */
function classStrings(source: string): string[] {
  const found: string[] = [];
  for (const match of source.matchAll(/className\s*=\s*/g)) {
    const start = match.index + match[0].length;
    if (source[start] === '"') found.push(source.slice(start + 1, source.indexOf('"', start + 1)));
    else if (source[start] === "{")
      found.push(...literals(source.slice(start + 1, closing(source, start))));
  }
  return found;
}

const nodeRequire = createRequire(import.meta.url);

/**
 * Loads a stylesheet that an `@import` of Tailwind names, as the build does:
 * one of Tailwind's own (`tailwindcss/theme.css`), or a file beside the one
 * that imports it (`../../theme.css`).
 */
function loadStylesheet(id: string, base: string) {
  const path = id.startsWith(".") ? join(base, id) : nodeRequire.resolve(id);
  return Promise.resolve({ path, base: dirname(path), content: readFileSync(path, "utf8") });
}

/** A Tailwind that has the app's theme, as styles.css has it (Tailwind's theme, then theme.css). */
const APP_UTILITIES = `@import "tailwindcss/theme.css" layer(theme);
@import "./theme.css";
@tailwind utilities;`;

/** `CSS.escape`, which Node does not have: how Tailwind writes a class name in a selector. */
function cssEscape(value: string): string {
  return Array.from(value)
    .map((char, index) => {
      const code = char.codePointAt(0) ?? 0;
      const digit = char >= "0" && char <= "9";
      if (code === 0) return "�";
      if (
        (code >= 1 && code <= 31) ||
        code === 127 ||
        (index === 0 && digit) ||
        (index === 1 && digit && value.startsWith("-"))
      ) {
        return `\\${code.toString(16)} `;
      }
      if (index === 0 && char === "-" && value.length === 1) return `\\${char}`;
      if (code >= 128 || char === "-" || char === "_" || /[0-9A-Za-z]/.test(char)) return char;
      return `\\${char}`;
    })
    .join("");
}

/**
 * Which of the class names make a rule in the CSS that Tailwind built from
 * them: the ones whose selector (`.size-12`, `.md\:w-56`) is there.
 */
function madeBy(css: string, tokens: readonly string[]): string[] {
  return tokens.filter((token) => {
    const selector = cssEscape(token).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\.${selector}(?![A-Za-z0-9_-])`).test(css);
  });
}

/** The class names that a source writes (`className` strings), once each, split on spaces. */
function classNames(source: string): string[] {
  return [
    ...new Set(
      classStrings(source)
        .flatMap((text) => text.split(/\s+/))
        .filter((token) => token !== ""),
    ),
  ];
}

/**
 * The class names of a source that are utilities of Tailwind, with the app's
 * theme, and do not carry `<folder>:`. One compile for all of them, and the
 * output says which made a rule: `build()` keeps what it has built before, so
 * a compiler asked one token after another would report every token after the
 * first that was real. Without the theme, `size-12`, `md:w-56`,
 * `fill-peach-400`, `font-bold` and `gap-3` make nothing at all.
 */
async function unprefixed(folder: string, source: string): Promise<string[]> {
  const tokens = classNames(source).filter((token) => !token.startsWith(`${folder}:`));
  const compiler = await compile(APP_UTILITIES, {
    base: join(dir, ".."),
    loadStylesheet,
  });
  return madeBy(compiler.build(tokens), tokens);
}

/**
 * The class names of a source that carry `<folder>:` and make nothing in the
 * folder's own sheet of utilities (utilities.css, with its prefix): a typo, a
 * hook that was prefixed by mistake, a class that Tailwind does not know.
 */
async function prefixedButUnmade(folder: string, source: string): Promise<string[]> {
  const tokens = classNames(source).filter((token) => token.startsWith(`${folder}:`));
  const sheet = join(dir, folder, "utilities.css");
  const compiler = await compile(readFileSync(sheet, "utf8"), {
    base: dirname(sheet),
    loadStylesheet,
  });
  const made = new Set(madeBy(compiler.build(tokens), tokens));
  return tokens.filter((token) => !made.has(token));
}

/** The folders of the skins that draw with classes (their motifs are `.tsx`), with those files. */
function motifFiles(): { folder: string; file: string; source: string }[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "crete" && !entry.name.startsWith("_"))
    .flatMap((entry) =>
      readdirSync(join(dir, entry.name))
        .filter((file) => file.endsWith(".tsx"))
        .map((file) => ({
          folder: entry.name,
          file,
          source: readFileSync(join(dir, entry.name, file), "utf8"),
        })),
    );
}

test("plugin — dans le dossier d'un skin, chaque utilitaire de Tailwind porte le préfixe du dossier", async () => {
  // styles.css does not scan the folders of the skins, and the utilities.css
  // of a folder makes only the utilities with its prefix (`nuit:size-12`):
  // an utility without it would make nothing, and draw the motif unstyled.
  // A class that is not one of Tailwind (`route-dots`, of styles.css; a hook)
  // keeps its name. The guard compiles with the app's theme: without it, it
  // would see only the utilities that need none (`absolute`, `flex`).
  const files = motifFiles();
  const bare = (
    await Promise.all(
      files.map(async ({ folder, file, source }) =>
        (await unprefixed(folder, source)).map((token) => `skins/${folder}/${file}: ${token}`),
      ),
    )
  ).flat();
  expect(bare).toEqual([]);
  // Not an empty search: the motifs draw with prefixed utilities.
  expect(
    files
      .filter(({ folder }) => folder === "nuit")
      .flatMap(({ source }) => classStrings(source))
      .join(" "),
  ).toMatch(/(^|\s)nuit:[a-z]/);
});

test("plugin — le garde des préfixes voit ce qu'il doit voir : un utilitaire sans préfixe qui a besoin du thème, et lui seul, est refusé", async () => {
  // The guard above must not pass for lack of eyes. A fake motif, in a fake
  // folder: the utilities that read the theme (sizes, colours, spacing, fonts),
  // the ones that do not, a prefixed one, and classes that are not Tailwind's.
  const motif = `<g className="fake:absolute size-12 md:w-56 fill-peach-400 text-white font-bold gap-3 opacity-90 absolute" />
    <path className={clsx("hidden", cond ? "md:size-20" : "fake:flex", \`w-40 \${size}\`)} />
    <g className="route-dots header-sun hero-art fake:size-12" />`;

  const found = await unprefixed("fake", motif);

  expect(found.toSorted()).toEqual(
    [
      "absolute",
      "fill-peach-400",
      "font-bold",
      "gap-3",
      "hidden",
      "md:size-20",
      "md:w-56",
      "opacity-90",
      "size-12",
      "text-white",
      "w-40",
    ].toSorted(),
  );
  // Not cumulative: a clean file after a dirty one reports nothing.
  expect(
    await unprefixed("fake", '<g className="fake:absolute fake:size-12 route-dots" />'),
  ).toEqual([]);
});

test("plugin — chaque classe préfixée d'un dossier fait un utilitaire dans la feuille du dossier", async () => {
  // The reverse of the guard above: a class with the prefix that makes nothing
  // (`nuit:size-1x`, or a hook that was prefixed by mistake) draws unstyled too.
  const unmade = (
    await Promise.all(
      motifFiles().map(async ({ folder, file, source }) =>
        (await prefixedButUnmade(folder, source)).map(
          (token) => `skins/${folder}/${file}: ${token}`,
        ),
      ),
    )
  ).flat();
  expect(unmade).toEqual([]);
  // It sees them: a fake class beside real ones.
  expect(
    await prefixedButUnmade(
      "nuit",
      '<g className="nuit:absolute nuit:size-12 nuit:md:w-56 nuit:no-such-utility nuit:header-sun" />',
    ),
  ).toEqual(["nuit:no-such-utility", "nuit:header-sun"]);
});

test("plugin — theme-vars.css : chaque couleur, rayon et police du thème, lue sur la page là où elle sert", () => {
  // The prefixed utilities of a skin read the colours, radii and fonts that its
  // palette and its fonts set on the page (`var(--color-iris-600)`), not a
  // prefixed copy of Crête's: the same names as the `@theme` of theme.css, and
  // the stacks that a skin's fonts.css may set besides (README.md, « Fonts »),
  // which Tailwind's own theme declares.
  const theme = readFileSync(new URL("../theme.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  const start = theme.indexOf("@theme {");
  const names = [
    ...theme
      .slice(start, theme.indexOf("@theme inline", start))
      .matchAll(/(--(?:color|radius|font)-[a-z0-9-]+)\s*:/g),
  ].map(([, name = ""]) => name);
  expect(names.length).toBeGreaterThan(50);
  const vars = readFileSync(new URL("theme-vars.css", import.meta.url), "utf8").replace(
    /\/\*[\s\S]*?\*\//g,
    "",
  );
  expect(vars.trim()).toBe(
    `@theme inline {\n${[...new Set([...names, "--font-mono", "--font-serif"])].map((name) => `  ${name}: var(${name});`).join("\n")}\n}`,
  );
});
