import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { INPUT, READ_ONLY_INPUT } from "./components/Field";
import { contrast } from "./test/colour";
import { SKIN_CASES, linearStops, themeColour, themeValue, type Theme } from "./test/theme";

// Contrasts that the classes of the app decide, measured on the values of the
// theme (styles.css) with the formula of WCAG 2, by day and at night, and on
// those of every other skin (src/skins/) in each mode it has.

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const root = fileURLToPath(new URL(".", import.meta.url));

/** The source files of the app, not its tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.gen\.ts$/.test(entry.name) ? [path] : [];
  });
}

/** Every class string of the sources that has all these classes (a string is what is between two quotes). */
function classStrings(...classes: string[]): { where: string; classes: string }[] {
  return sources(root).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(/"([^"\n]*)"|`([^`]*)`/g)]
      .map((match) => match[1] ?? match[2] ?? "")
      .filter((text) => classes.every((name) => new RegExp(`(?:^|\\s)${name}(?=\\s|$)`).test(text)))
      .map((text) => ({ where: relative(root, file), classes: text })),
  );
}

function channels(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

const hexOf = (rgb: number[]) =>
  `#${rgb
    .map((value) =>
      Math.round(Math.min(255, Math.max(0, value)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

/**
 * The colours of a paint of the dawn (`--dawn-deep`…, which the utilities of
 * styles.css paint with and a skin sets), at its stops and at every sixteenth
 * of the way between two of them (a gradient is mixed in sRGB, and a point
 * between two stops can be lighter than both).
 */
function gradientColours(property: string, mode: Theme, skin: string): string[] {
  const stops = linearStops(themeValue(property, mode, skin));
  if (stops.length < 2) {
    throw new Error(`${property} has no gradient of #rrggbb stops (${skin}, ${mode})`);
  }
  return stops.slice(1).flatMap((to, i) => {
    const from = channels(stops[i] ?? "");
    const end = channels(to);
    return Array.from({ length: 17 }, (_, step) =>
      hexOf(from.map((value, c) => value + ((end[c] ?? 0) - value) * (step / 16))),
    );
  });
}

/** A colour through `filter: brightness(factor)`: each channel multiplied, in sRGB. */
const brightened = (hex: string, factor: number) =>
  hexOf(channels(hex).map((value) => value * factor));

/**
 * A class of a class string, under any variants (`aria-[current=page]:bg-dawn-deep`),
 * with those variants. A string may be a template with strings in it (`${a ? "x" : ""}`):
 * a class ends at a space or a quote.
 */
function withVariants(classes: string, name: string): string[] {
  return [
    ...classes.matchAll(
      new RegExp(`(?:^|[\\s"'])((?:[a-z-]+(?:-\\[[^\\]\\s]*\\])?:)*)${name}(?=[\\s"']|$)`, "g"),
    ),
  ].map((match) => match[1] ?? "");
}

describe("contrast", () => {
  test("contrast — ce que peint l'aube profonde écrit dans --dawn-deep-ink, jamais en blanc écrit dans la classe", () => {
    // What `bg-dawn-deep` paints (the main button, the «+», the current tab, a
    // chosen day, a chip…) writes its text in `text-dawn-deep-ink`, under the
    // same variants: white in Crête, the dark of a skin whose deep dawn is light.
    const painted = sources(root).flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(/"([^"\n]*)"|`([^`]*)`/g)]
        .map((match) => match[1] ?? match[2] ?? "")
        .filter((text) => withVariants(text, "bg-dawn-deep").length > 0)
        .map((text) => ({ where: relative(root, file), classes: text })),
    );
    // Not an empty search: the pieces above, and those of a variant (the current tab).
    expect(painted.length).toBeGreaterThanOrEqual(8);
    expect(painted.some(({ classes }) => /aria-\[current=page\]:bg-dawn-deep/.test(classes))).toBe(
      true,
    );
    const problems = painted.flatMap(({ where, classes }) => [
      ...withVariants(classes, "text-white").map((variant) => `${where}: ${variant}text-white`),
      ...withVariants(classes, "bg-dawn-deep")
        .filter((variant) => !withVariants(classes, "text-dawn-deep-ink").includes(variant))
        .map((variant) => `${where}: ${variant}bg-dawn-deep without ${variant}text-dawn-deep-ink`),
    ]);
    expect(problems).toEqual([]);
  });

  test("contrast — le texte d'un bouton en dégradé (--dawn-deep-ink) garde 4,5:1 au survol, à l'appui et au focus, le jour et la nuit", () => {
    // The pills of sunrise that carry a text: the main button, the + button, a chosen tab or day…
    const buttons = classStrings("bg-dawn-deep", "text-dawn-deep-ink");
    expect(buttons.length, "no class string writes on bg-dawn-deep").toBeGreaterThan(0);
    // The sunrise is painted in its own colours, whatever the theme: the same
    // stops by day and at night, as its ink. A skin sets its own (`--dawn-deep`, `--dawn-deep-ink`).
    for (const { where, classes } of buttons) {
      // The filters of its states (`hover:brightness-110`…), and the button at rest.
      const factors = [
        1,
        ...[...classes.matchAll(/(?:^|\s)(?:[a-z-]+:)*brightness-(\d+)(?=\s|$)/g)].map(
          (match) => Number(match[1]) / 100,
        ),
      ];
      for (const { skin, mode, label } of SKIN_CASES) {
        const colours = gradientColours("--dawn-deep", mode, skin);
        const ink = themeValue("--dawn-deep-ink", mode, skin);
        for (const factor of factors) {
          const worst = Math.min(
            ...colours.map((colour) => contrast(ink, brightened(colour, factor))),
          );
          expect(
            worst,
            `${where}: ${ink} on bg-dawn-deep at brightness ${factor} (${label})`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  test("contrast — le bord d'un champ a 3:1 sur son fond, dans chaque état, le jour et la nuit", () => {
    // A field is told by its edge (WCAG 1.4.11): at rest, under the pointer,
    // with the focus and when it is refused, against the ground it is drawn on.
    const fields = [
      { what: "a field", classes: INPUT, ground: "field" },
      { what: "a field to copy from (read-only)", classes: READ_ONLY_INPUT, ground: "neutral-50" },
    ];
    for (const { what, classes, ground } of fields) {
      const borders = [
        ...classes.matchAll(/(?:^|\s)((?:[a-z-]+:)*)border-([a-z]+-\d+)(?=\s|$)/g),
      ].map((match) => ({ state: match[1] || "at rest", colour: match[2] ?? "" }));
      expect(
        borders.map(({ state }) => state),
        `the edge of ${what}`,
      ).toContain("at rest");
      for (const { skin, mode, label } of SKIN_CASES) {
        for (const { state, colour } of borders) {
          const ratio = contrast(themeColour(colour, mode, skin), themeColour(ground, mode, skin));
          expect(
            ratio,
            `${what}: border-${colour} ${state} on ${ground} (${label})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // The ring of a field with the focus is drawn by styles.css over the classes.
    const focused = /:focus\s*\{\s*border-color:\s*var\(--color-([a-z]+-\d+)\)/.exec(styles)?.[1];
    expect(focused, "the border of a field with the focus in styles.css").toBeDefined();
    for (const { skin, mode, label } of SKIN_CASES) {
      expect(
        contrast(themeColour(focused ?? "", mode, skin), themeColour("field", mode, skin)),
        `a field with the focus: border-${focused} (${label})`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
