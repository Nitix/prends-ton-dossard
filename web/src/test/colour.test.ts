import { expect, test } from "vitest";

import { contrast, deltaE } from "./colour";
import { themeColour } from "./theme";

// The tests of contrast stand on these two helpers: they are checked against
// numbers known from elsewhere, so that a wrong formula cannot pass them.

test("colour — the contrast of WCAG 2, against known values", () => {
  expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
  expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 5);
  expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  // #767676 is the lightest grey that has 4.5:1 on white, 4.54 exactly.
  expect(contrast("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
});

test("colour — the distance is 100 from black to white, 0 for a same colour", () => {
  expect(deltaE("#000000", "#ffffff")).toBeCloseTo(100, 1);
  expect(deltaE("#6d49f4", "#6d49f4")).toBe(0);
  expect(deltaE("#6d49f4", "#e8651d")).toBeCloseTo(deltaE("#e8651d", "#6d49f4"), 8);
});

test("colour — a red and a green that are far apart are close with a deficiency of the reds and greens", () => {
  const normal = deltaE("#c2410c", "#4d7c0f");
  expect(normal).toBeGreaterThan(20);
  expect(deltaE("#c2410c", "#4d7c0f", "protan")).toBeLessThan(normal / 2);
  expect(deltaE("#c2410c", "#4d7c0f", "deutan")).toBeLessThan(normal / 2);
  // A grey has no hue to lose: it is the same grey.
  expect(deltaE("#808080", "#9a9a9a", "protan")).toBeCloseTo(deltaE("#808080", "#9a9a9a"), 3);
});

test("themeColour — a colour of the theme, and the white and the ink the tests rely on", () => {
  expect(themeColour("neutral-50")).toBe("#fbf8ff");
  expect(themeColour("ink")).toBe("#241b35");
  expect(() => themeColour("not-a-colour")).toThrow(/not-a-colour/);
});
