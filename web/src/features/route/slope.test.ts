import { expect, test } from "vitest";

import { contrast, deltaE, type Vision } from "../../test/colour";
import { themeColour } from "../../test/theme";
import { SLOPE_COLORS, SLOPE_COLORS_DARK, SLOPE_FILLS, SLOPE_ZONES, slopeZone } from "./slope";

test("slopeZone — cinq zones, une pente sur la borne est dans la zone du dessus", () => {
  expect([0, 4.9, 5, 9.9, 10, 14.9, 15, 24.9, 25, 60].map(slopeZone)).toEqual([
    1, 1, 2, 2, 3, 3, 4, 4, 5, 5,
  ]);
});

test("slopeZone — une descente compte comme une montée", () => {
  expect([-3, -7, -12, -20, -30].map(slopeZone)).toEqual([1, 2, 3, 4, 5]);
});

test("slope — une couleur à chaque zone, toutes différentes", () => {
  const colors = SLOPE_ZONES.map((zone) => SLOPE_COLORS[zone]);
  expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  expect(new Set(colors).size).toBe(SLOPE_ZONES.length);
});

// The colours of the zones are marks on the white card of the profile, and the
// ink line is drawn along them: each must stand out from the card (3:1, the
// contrast WCAG 2 asks of a graphic) and from the line, and the zones must not
// melt into one another, with a colour vision deficiency either.

const WHITE = "#ffffff";

const zoneColors = SLOPE_ZONES.map((zone) => ({ zone, color: SLOPE_COLORS[zone] }));

/** Two zones side by side in the order of the slope: 1 and 2, 2 and 3... */
const neighbours = zoneColors.slice(1).map((next, i) => [zoneColors[i], next] as const);

/** Any two zones: a profile that goes from a plateau to a wall puts 1 against 5. */
const pairs = zoneColors.flatMap((first, i) =>
  zoneColors.slice(i + 1).map((next) => [first, next] as const),
);

/**
 * The least difference (distance in OKLab, times 100) between two zones, with
 * protanopia and deuteranopia as Machado et al. (2009) model them: 8 is the
 * target of the data-visualisation method this follows (a distance of 6 to 8 is
 * a floor that needs the words as well, which the legend and the cursor give
 * here), and 15 with normal vision, below which two colours are hard to tell
 * apart even when all of them are seen.
 */
const LEAST = { deficient: 8, normal: 15 } as const;

const VISIONS: readonly Vision[] = ["protan", "deutan"];

test("slope — every zone colour has 3:1 against white", () => {
  for (const { zone, color } of zoneColors) {
    expect(contrast(color, WHITE), `zone ${zone}, ${color}`).toBeGreaterThanOrEqual(3);
  }
});

test("slope — the ink line stays visible over every zone", () => {
  const ink = themeColour("ink");
  for (const { zone, color } of zoneColors) {
    expect(contrast(color, ink), `zone ${zone}, ${color}`).toBeGreaterThanOrEqual(3);
  }
});

test("slope — neighbouring zones stay distinct, with normal vision and with a colour vision deficiency", () => {
  for (const [first, next] of neighbours) {
    const names = `zones ${first?.zone} and ${next?.zone}`;
    expect(
      deltaE(first?.color ?? "", next?.color ?? ""),
      `${names}, normal vision`,
    ).toBeGreaterThanOrEqual(LEAST.normal);
    for (const vision of VISIONS) {
      expect(
        deltaE(first?.color ?? "", next?.color ?? "", vision),
        `${names}, ${vision}`,
      ).toBeGreaterThanOrEqual(LEAST.deficient);
    }
  }
});

test("slope — two zones that meet at a break, 1 against 5, stay as distinct", () => {
  for (const [first, next] of pairs) {
    const names = `zones ${first?.zone} and ${next?.zone}`;
    expect(
      deltaE(first?.color ?? "", next?.color ?? ""),
      `${names}, normal vision`,
    ).toBeGreaterThanOrEqual(LEAST.normal);
    for (const vision of VISIONS) {
      expect(
        deltaE(first?.color ?? "", next?.color ?? "", vision),
        `${names}, ${vision}`,
      ).toBeGreaterThanOrEqual(LEAST.deficient);
    }
  }
});

// At night (the dark theme), the profile is drawn on the dark card with a
// white line: the colours of the day lose their 3:1 against that line, so the
// zones have their own colours there, the same hues in the same order (blue,
// green, mustard, orange, red), held to the same numbers.

const night = SLOPE_ZONES.map((zone) => ({ zone, color: SLOPE_COLORS_DARK[zone] }));
const nightNeighbours = night.slice(1).map((next, i) => [night[i], next] as const);
const nightPairs = night.flatMap((first, i) =>
  night.slice(i + 1).map((next) => [first, next] as const),
);

test("slope — la nuit : chaque zone a 3:1 sur la carte sombre et avec la ligne claire", () => {
  const card = themeColour("card", "dark");
  const line = themeColour("relief", "dark");
  for (const { zone, color } of night) {
    expect(contrast(color, card), `zone ${zone}, ${color} on ${card}`).toBeGreaterThanOrEqual(3);
    expect(contrast(color, line), `zone ${zone}, ${color} with ${line}`).toBeGreaterThanOrEqual(3);
  }
  // The line itself stands out of the card, above the profile.
  expect(contrast(line, card)).toBeGreaterThanOrEqual(3);
});

test("slope — la nuit : les zones voisines, et deux zones quelconques, restent distinctes", () => {
  for (const [first, next] of [...nightNeighbours, ...nightPairs]) {
    const names = `zones ${first?.zone} and ${next?.zone}`;
    expect(
      deltaE(first?.color ?? "", next?.color ?? ""),
      `${names}, normal vision`,
    ).toBeGreaterThanOrEqual(LEAST.normal);
    for (const vision of VISIONS) {
      expect(
        deltaE(first?.color ?? "", next?.color ?? "", vision),
        `${names}, ${vision}`,
      ).toBeGreaterThanOrEqual(LEAST.deficient);
    }
  }
});

test("slope — le dessin prend les couleurs du thème : celles de styles.css, de jour comme de nuit", () => {
  const colors = SLOPE_ZONES.map((zone) => SLOPE_COLORS_DARK[zone]);
  expect(colors.every((color) => /^#[0-9a-f]{6}$/.test(color))).toBe(true);
  expect(new Set(colors).size).toBe(SLOPE_ZONES.length);
  for (const zone of SLOPE_ZONES) {
    expect(SLOPE_FILLS[zone]).toBe(`var(--color-slope-${zone})`);
    expect(themeColour(`slope-${zone}`, "light")).toBe(SLOPE_COLORS[zone]);
    expect(themeColour(`slope-${zone}`, "dark")).toBe(SLOPE_COLORS_DARK[zone]);
  }
  // By day, the line of the profile is the ink that the tests above measure.
  expect(themeColour("relief", "light")).toBe(themeColour("ink", "light"));
});
