import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

// What moves on its own costs a phone: an animation that never ends keeps the
// compositor at work (and the battery with it) for as long as it is on screen,
// all the more on a layer that is blurred. The sky of « Crête » is still: what
// moves, moves once (a dialog that rises, a ring that draws itself, a check that
// pops), and not at all when less motion is asked for.
//
// One exception, documented in src/skins/README.md (« Motion »): the decoration
// of a skin's motifs, in the `motion.css` of its folder (« Carnet »: the patches
// of its sheet of dots, its orbits, a pulse), on these conditions, which the
// tests below check:
// - only under `@media (prefers-reduced-motion: no-preference)`;
// - only inside a drawing that has `data-moving`, which the motif gives while
//   the person has the background on (« Animer le fond », lib/ambient.ts);
// - only in classes of the skin's own (`<id>-*`), never a class of the app;
// - only `transform` and `opacity`, which the compositor does alone;
// - the skin says it has an animated background, so that the settings offer the switch.

const root = fileURLToPath(new URL(".", import.meta.url));

/** The source files of the app and its stylesheets, not its tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$|\.gen\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The path of a file from src/, with slashes. */
const slashed = (file: string) => relative(root, file).replaceAll("\\", "/");

// An iteration count of `infinite` (in a declaration, in an animation of the
// theme, or in a class of Tailwind with a value), and the endless animations of
// Tailwind.
const ENDLESS =
  /(?:animation|--animate-[\w-]+)[^;{}]*\binfinite\b|animate-\[[^\]]*infinite[^\]]*\]|\banimate-(?:spin|ping|pulse|bounce)\b/g;

/** The `motion.css` of a skin's folder (`skins/carnet/motion.css`), and the id of the skin. */
const motionSheetOf = (file: string) => /^skins\/([a-z][\w-]*)\/motion\.css$/.exec(file)?.[1];

const NO_PREFERENCE = "@media (prefers-reduced-motion: no-preference)";

type Block = { chain: string[]; prelude: string; body: string };

/** The blocks of a stylesheet, those inside `@media` and `@supports` too, with the at-rules that hold each. */
function blocks(css: string, chain: string[] = []): Block[] {
  const found: Block[] = [];
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf("{", at);
    if (open === -1) break;
    let depth = 1;
    let end = open + 1;
    while (end < css.length && depth > 0) {
      if (css[end] === "{") depth++;
      else if (css[end] === "}") depth--;
      end++;
    }
    const prelude = css.slice(at, open).trim();
    const body = css.slice(open + 1, end - 1);
    if (/^@(?:media|supports)\b/.test(prelude)) found.push(...blocks(body, [...chain, prelude]));
    else found.push({ chain, prelude, body });
    at = end;
  }
  return found;
}

/** What is wrong with the `motion.css` of a skin (nothing, when it follows the rules above). */
function motionProblems(id: string, css: string): string[] {
  const problems: string[] = [];
  const plain = css.replaceAll(/\/\*[\s\S]*?\*\//g, "");
  for (const { chain, prelude, body } of blocks(plain)) {
    if (prelude.startsWith("@keyframes")) {
      const properties = [...body.matchAll(/([\w-]+)\s*:/g)].map(([, property = ""]) => property);
      for (const property of new Set(properties)) {
        if (property !== "transform" && property !== "opacity") {
          problems.push(`${prelude}: ${property}, which is not for the compositor alone`);
        }
      }
      continue;
    }
    if (prelude.startsWith("@")) {
      problems.push(`${prelude}: an at-rule this file does not have`);
      continue;
    }
    const selectors = prelude.split(",").map((selector) => selector.trim());
    const classes = selectors.flatMap((selector) =>
      [...selector.matchAll(/\.([\w-]+)/g)].map(([, name = ""]) => name),
    );
    for (const name of classes) {
      if (!name.startsWith(`${id}-`)) problems.push(`${prelude}: .${name} is not a class of ${id}`);
    }
    if (!/\banimation\b|\banimation-/.test(body)) continue;
    if (!chain.includes(NO_PREFERENCE)) {
      problems.push(`${prelude}: an animation outside ${NO_PREFERENCE}`);
    }
    for (const selector of selectors) {
      if (!selector.includes("[data-moving]")) {
        problems.push(`${selector}: an animation outside a drawing that has data-moving`);
      }
    }
  }
  return problems;
}

test("motion — aucune animation ne tourne sans fin", () => {
  const endless = sources(root).flatMap((file) => {
    const path = slashed(file);
    const text = readFileSync(file, "utf8");
    // The motion of a skin's motifs: the tests below hold it to its conditions.
    if (motionSheetOf(path) !== undefined) return [];
    return [...text.matchAll(ENDLESS)].map((match) => `${path}: ${match[0]}`);
  });
  expect(endless).toEqual([]);
});

test("motion — le mouvement d'un skin n'est que dans son motion.css, sous prefers-reduced-motion: no-preference, dans un dessin qui a data-moving", () => {
  const sheets = sources(root).filter((file) => motionSheetOf(slashed(file)) !== undefined);
  // « Carnet » has one: a skin that moves.
  expect(sheets.map(slashed)).toContain("skins/carnet/motion.css");
  for (const file of sheets) {
    const path = slashed(file);
    const id = motionSheetOf(path) ?? "";
    const text = readFileSync(file, "utf8");
    expect(text.match(ENDLESS) ?? [], `${path}: it moves something`).not.toHaveLength(0);
    expect(motionProblems(id, text), `${path}: its conditions`).toEqual([]);
  }
});

test("motion — un skin qui a un motion.css le dit (animatedBackground), le charge, et ses motifs suivent « Animer le fond »", () => {
  const skins = join(root, "skins");
  const withMotion = readdirSync(skins, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(skins, entry.name, "motion.css")))
    .map((entry) => entry.name);
  const saying = readdirSync(skins, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        existsSync(join(skins, entry.name, "index.ts")) &&
        /^\s*animatedBackground: true,$/m.test(
          readFileSync(join(skins, entry.name, "index.ts"), "utf8"),
        ),
    )
    .map((entry) => entry.name);
  expect(saying.toSorted()).toEqual(withMotion.toSorted());
  for (const id of withMotion) {
    const look = readFileSync(join(skins, id, "look.ts"), "utf8");
    expect(look, `skins/${id}/look.ts loads its motion.css`).toMatch(
      /^import "\.\/motion\.css";$/m,
    );
    // A motif that makes a drawing move (`data-moving`) asks whether the person has the background on.
    const motifs = sources(join(skins, id)).filter((file) => file.endsWith(".tsx"));
    const moving = motifs.filter((file) => readFileSync(file, "utf8").includes("data-moving"));
    expect(moving.length, `the motifs of ${id} that move`).toBeGreaterThan(0);
    for (const file of moving) {
      expect(readFileSync(file, "utf8"), `${slashed(file)} asks useAmbient()`).toMatch(
        /\buseAmbient\(\)/,
      );
    }
  }
});

// The rules above, on sheets written here.

const CONFORMING = `
  .x-orbit { transform-box: view-box; }
  @media (prefers-reduced-motion: no-preference) {
    .x-art[data-moving] .x-orbit { animation: x-orbit 160s linear infinite; }
    @keyframes x-orbit { to { transform: rotate(360deg); } }
    @keyframes x-veil { 0%, 100% { opacity: var(--max); transform: translate3d(0, 0, 0); } }
  }
`;

test("motion — le motion.css d'un skin : sous no-preference, dans un dessin qui bouge, ses classes, transform et opacity", () => {
  expect(motionProblems("x", CONFORMING)).toEqual([]);
  // Comments are not code.
  expect(motionProblems("x", `/* .y-a { animation: a 1s infinite } */ ${CONFORMING}`)).toEqual([]);
});

test("motion — un motion.css qui anime hors de no-preference, hors d'un dessin qui bouge, une classe de l'appli ou autre chose que transform et opacity est refusé", () => {
  expect(
    motionProblems(
      "x",
      ".x-art[data-moving] .x-orbit { animation: x-orbit 160s linear infinite; }",
    ),
  ).toEqual([`.x-art[data-moving] .x-orbit: an animation outside ${NO_PREFERENCE}`]);
  expect(
    motionProblems(
      "x",
      `@media (prefers-reduced-motion: reduce) { .x-art[data-moving] .x-orbit { animation: a 1s infinite; } }`,
    ),
  ).toEqual([`.x-art[data-moving] .x-orbit: an animation outside ${NO_PREFERENCE}`]);
  expect(
    motionProblems(
      "x",
      `@media (prefers-reduced-motion: no-preference) { .x-orbit { animation: x-orbit 160s linear infinite; } }`,
    ),
  ).toEqual([".x-orbit: an animation outside a drawing that has data-moving"]);
  expect(
    motionProblems(
      "x",
      `@media (prefers-reduced-motion: no-preference) { .sheet[data-moving], .y-art[data-moving] { animation: a 1s infinite; } }`,
    ),
  ).toEqual([
    ".sheet[data-moving], .y-art[data-moving]: .sheet is not a class of x",
    ".sheet[data-moving], .y-art[data-moving]: .y-art is not a class of x",
  ]);
  expect(
    motionProblems(
      "x",
      `@media (prefers-reduced-motion: no-preference) { @keyframes x-a { 50% { opacity: 0; filter: blur(2px); left: 1px; } } }`,
    ),
  ).toEqual([
    "@keyframes x-a: filter, which is not for the compositor alone",
    "@keyframes x-a: left, which is not for the compositor alone",
  ]);
});
