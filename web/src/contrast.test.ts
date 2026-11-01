import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

import { INPUT, READ_ONLY_INPUT } from "./components/Field";
import { contrast } from "./test/colour";
import { block, themeColour, type Theme } from "./test/theme";

// Contrasts that the classes of the app decide, measured on the values of the
// theme (styles.css) with the formula of WCAG 2, by day and at night.

const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const root = fileURLToPath(new URL(".", import.meta.url));
const THEMES: Theme[] = ["light", "dark"];

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
 * The colours of a linear gradient of a `@utility` of styles.css, at its stops
 * and at every sixteenth of the way between two of them (a gradient is mixed
 * in sRGB, and a point between two stops can be lighter than both).
 */
function gradientColours(utility: string): string[] {
  const body = block(styles, `@utility ${utility}`);
  const stops = [...(body ?? "").matchAll(/(#[0-9a-fA-F]{6})\s+\d+%/g)].map((m) => m[1] ?? "");
  if (stops.length < 2) throw new Error(`@utility ${utility} has no gradient of #rrggbb stops`);
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

describe("contrast", () => {
  test("contrast — le texte blanc d'un bouton en dégradé garde 4,5:1 au survol, à l'appui et au focus, le jour et la nuit", () => {
    // The pills of sunrise that carry white text: the main button, the + button, a chosen tab or day…
    const buttons = classStrings("bg-dawn-deep", "text-white");
    expect(buttons.length, "no class string paints white text on bg-dawn-deep").toBeGreaterThan(0);
    // The sunrise is painted in its own colours, whatever the theme: the same
    // stops by day and at night, as the white of the text.
    const colours = gradientColours("bg-dawn-deep");
    for (const { where, classes } of buttons) {
      // The filters of its states (`hover:brightness-110`…), and the button at rest.
      const factors = [
        1,
        ...[...classes.matchAll(/(?:^|\s)(?:[a-z-]+:)*brightness-(\d+)(?=\s|$)/g)].map(
          (match) => Number(match[1]) / 100,
        ),
      ];
      for (const theme of THEMES) {
        for (const factor of factors) {
          const worst = Math.min(
            ...colours.map((colour) => contrast("#ffffff", brightened(colour, factor))),
          );
          expect(
            worst,
            `${where}: white on bg-dawn-deep at brightness ${factor} (${theme})`,
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
      for (const theme of THEMES) {
        for (const { state, colour } of borders) {
          const ratio = contrast(themeColour(colour, theme), themeColour(ground, theme));
          expect(
            ratio,
            `${what}: border-${colour} ${state} on ${ground} (${theme})`,
          ).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // The ring of a field with the focus is drawn by styles.css over the classes.
    const focused = /:focus\s*\{\s*border-color:\s*var\(--color-([a-z]+-\d+)\)/.exec(styles)?.[1];
    expect(focused, "the border of a field with the focus in styles.css").toBeDefined();
    for (const theme of THEMES) {
      expect(
        contrast(themeColour(focused ?? "", theme), themeColour("field", theme)),
        `a field with the focus: border-${focused} (${theme})`,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});
