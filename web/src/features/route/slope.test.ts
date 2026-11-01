import { expect, test } from "vitest";

import { SLOPE_COLORS, SLOPE_ZONES, slopeZone } from "./slope";

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
