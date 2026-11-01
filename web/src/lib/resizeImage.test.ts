import { describe, expect, test } from "vitest";

import { AVATAR_MAX_PX, fitWithin } from "./resizeImage";

describe("fitWithin", () => {
  test.each([
    { width: 4032, height: 3024, max: 512, expected: { width: 512, height: 384 } },
    { width: 3024, height: 4032, max: 512, expected: { width: 384, height: 512 } },
    // Never enlarged.
    { width: 300, height: 200, max: 512, expected: { width: 300, height: 200 } },
    { width: 512, height: 512, max: 512, expected: { width: 512, height: 512 } },
    // At least one pixel on the short side.
    { width: 5000, height: 1, max: 512, expected: { width: 512, height: 1 } },
  ])("$width × $height within $max gives $expected.width × $expected.height", (row) => {
    expect(fitWithin(row.width, row.height, row.max)).toEqual(row.expected);
  });

  test("rounds to whole pixels", () => {
    // 1000 × 333 scaled by 0.512 is 512 × 170.496.
    expect(fitWithin(1000, 333, 512)).toEqual({ width: 512, height: 170 });
  });
});

test("an avatar is at most 512 px on its longest side", () => {
  expect(AVATAR_MAX_PX).toBe(512);
});
