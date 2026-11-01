import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { contrast } from "./test/colour";
import { themeColour } from "./test/theme";

// A dashed border says « not confirmed » or « to confirm » next to the words,
// so that the state is never told by colour alone: but a dash that is pale on
// the page cannot be seen either. Every dashed border of the app is a graphic
// that carries a state, and has the 3:1 that WCAG 2 asks of one, against the
// two grounds it sits between: the white of a card (the inside of the row, and
// the card around the chips) and the very light lilac of the sheet of the page;
// at night (the dark theme), the dark card and the dark sheet.

const GROUNDS = {
  "the white of a card": "#ffffff",
  "the sheet (neutral-50)": themeColour("neutral-50"),
  "a card at night": themeColour("card", "dark"),
  "the sheet at night": themeColour("neutral-50", "dark"),
};

const root = fileURLToPath(new URL(".", import.meta.url));

/** The source files of the app, not its tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$|\.gen\.ts$/.test(entry.name) ? [path] : [];
  });
}

/**
 * Every class string that makes a border dashed, with the colour it gives the
 * border: the nearest quotes around `border-dashed` bound the string.
 */
function dashedBorders(): { where: string; classes: string; colour: string | undefined }[] {
  return sources(root).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    return [...text.matchAll(/\bborder-dashed\b/g)].map((match) => {
      const at = match.index ?? 0;
      const start = Math.max(
        text.lastIndexOf('"', at),
        text.lastIndexOf("'", at),
        text.lastIndexOf("`", at),
      );
      const end = Math.min(
        ...['"', "'", "`"].map((quote) => {
          const found = text.indexOf(quote, at);
          return found === -1 ? text.length : found;
        }),
      );
      const classes = text.slice(start + 1, end);
      const colour = classes.match(
        /(?:^|\s)border-(?!dashed|solid|dotted|none|\d|[tblrxyse]-)([a-z]+(?:-\d+)?)(?=\s|$)/,
      )?.[1];
      return { where: relative(root, file), classes, colour };
    });
  });
}

test("dashed — every dashed border has 3:1 against a card and against the sheet, by day and at night", () => {
  const borders = dashedBorders();
  // Not an empty search: the rows of the page of an event and of a list, the
  // chips of the participants, the upcoming races and the confirmations to give.
  expect(new Set(borders.map((border) => border.where)).size).toBeGreaterThanOrEqual(5);

  for (const { where, classes, colour } of borders) {
    expect(
      colour,
      `${where}: "${classes}" gives its dashed border no colour of the theme`,
    ).toBeDefined();
    for (const [ground, background] of Object.entries(GROUNDS)) {
      const hex = themeColour(colour ?? "", ground.endsWith("at night") ? "dark" : "light");
      expect(
        contrast(hex, background),
        `${where}: border-${colour} (${hex}) on ${ground}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});
