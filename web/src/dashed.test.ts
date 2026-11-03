import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

import { contrast } from "./test/colour";
import { SKIN_CASES, appStylesheet, block, themeColour, type Theme } from "./test/theme";

// A dashed border says « not confirmed » or « to confirm » next to the words,
// so that the state is never told by colour alone: but a dash that is pale on
// the page cannot be seen either. Every dashed border of the app is a graphic
// that carries a state, and has the 3:1 that WCAG 2 asks of one, against the
// two grounds it sits between: the white of a card (the inside of the row, and
// the card around the chips) and the very light lilac of the sheet of the page;
// at night (the dark theme), the dark card and the dark sheet. The same in
// every skin (src/skins/), in each mode it has.

const GROUNDS = SKIN_CASES.flatMap(({ skin, mode, label }) => [
  { ground: `a card (${label})`, background: themeColour("card", mode, skin), skin, mode },
  {
    ground: `the sheet, neutral-50 (${label})`,
    background: themeColour("neutral-50", mode, skin),
    skin,
    mode,
  },
]);

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
  expect(
    borders.length,
    "no class string with border-dashed was found in the sources: the search is broken",
  ).toBeGreaterThan(0);

  for (const { where, classes, colour } of borders) {
    expect(
      colour,
      `${where}: "${classes}" gives its dashed border no colour of the theme`,
    ).toBeDefined();
    for (const { ground, background, skin, mode } of GROUNDS) {
      const hex = themeColour(colour ?? "", mode, skin);
      expect(
        contrast(hex, background),
        `${where}: border-${colour} (${hex}) on ${ground}`,
      ).toBeGreaterThanOrEqual(3);
    }
  }
});

/** The three channels of a `#rrggbb` colour, from 0 to 255. */
const rgb = (hex: string) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/**
 * The pastel of the dawn that an avatar without a photo is painted with
 * (`.avatar-soft` in styles.css), at its stops and at every sixteenth of the
 * way between two (a gradient is mixed in sRGB).
 */
function pastels(theme: Theme, skin?: string): string[] {
  const styles = appStylesheet();
  const gradient = /background-image:\s*linear-gradient\(([^;]*)\);/.exec(
    block(styles, ".avatar-soft") ?? "",
  )?.[1];
  const stops = [...(gradient ?? "").matchAll(/var\(--color-([a-z]+-\d+)\)/g)].map((match) =>
    themeColour(match[1] ?? "", theme, skin),
  );
  return stops.slice(1).flatMap((to, i) =>
    Array.from({ length: 17 }, (_, step) => {
      const from = rgb(stops[i] ?? "");
      const end = rgb(to);
      const mixed = from.map((value, c) =>
        Math.round(value + ((end[c] ?? 0) - value) * (step / 16)),
      );
      return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
    }),
  );
}

test("dashed — la pastille d'un participant à confirmer garde 3:1, avec de la marge, sur le pastel d'un avatar, le jour et la nuit", () => {
  // The dashed edge of a chip runs right around the avatar inside it: against
  // the pastel of initials as well as against the card. 3:1 is what WCAG asks
  // of a graphic; the chip keeps a margin over it (3.5), so that a pastel a
  // shade lighter does not bring it down to the limit.
  const chips = dashedBorders().filter(({ where }) => where.endsWith("ParticipantChips.tsx"));
  expect(chips.length, "the dashed chip of ParticipantChips.tsx was not found").toBeGreaterThan(0);
  for (const { classes, colour } of chips) {
    for (const { skin, mode, label } of SKIN_CASES) {
      const grounds = pastels(mode, skin);
      expect(grounds.length, "the pastel of .avatar-soft").toBeGreaterThan(2);
      const hex = themeColour(colour ?? "", mode, skin);
      for (const ground of grounds) {
        expect(
          contrast(hex, ground),
          `"${classes}": border-${colour} (${hex}) on the pastel ${ground} (${label})`,
        ).toBeGreaterThanOrEqual(3.5);
      }
    }
  }
});
