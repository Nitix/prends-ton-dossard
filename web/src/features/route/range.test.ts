import { describe, expect, test } from "vitest";

import { clampRange, MIN_SPAN_KM, pointsIn, zoomAround } from "./range";

describe("range", () => {
  test("range — clampRange garde la portion dans la trace, d'au moins 200 m", () => {
    expect(clampRange({ from: 2, to: 5 }, 10)).toEqual({ from: 2, to: 5 });
    // Pushed back inside, with its length.
    expect(clampRange({ from: -1, to: 2 }, 10)).toEqual({ from: 0, to: 3 });
    expect(clampRange({ from: 8, to: 11 }, 10)).toEqual({ from: 7, to: 10 });
    // Reversed ends are put in order.
    expect(clampRange({ from: 5, to: 2 }, 10)).toEqual({ from: 2, to: 5 });
    // Too short: widened around its middle, to 200 m.
    const short = clampRange({ from: 4, to: 4.01 }, 10);
    expect(short.to - short.from).toBeCloseTo(MIN_SPAN_KM, 9);
    expect((short.from + short.to) / 2).toBeCloseTo(4.005, 9);
    // At the very start, still 200 m, still inside.
    expect(clampRange({ from: 0, to: 0 }, 10)).toEqual({ from: 0, to: MIN_SPAN_KM });
    // Longer than the track: the whole track. A track shorter than 200 m is its own minimum.
    expect(clampRange({ from: -5, to: 50 }, 10)).toEqual({ from: 0, to: 10 });
    expect(clampRange({ from: 0.01, to: 0.02 }, 0.1)).toEqual({ from: 0, to: 0.1 });
  });

  test("range — zoomAround zoome autour d'un kilomètre, et la trace entière redonne null", () => {
    // Twice shorter around the middle of the track.
    expect(zoomAround(null, 5, 0.5, 10)).toEqual({ from: 2.5, to: 7.5 });
    // The point under the pointer stays at the same place of the range.
    const zoomed = zoomAround({ from: 2, to: 6 }, 3, 0.5, 10);
    expect(zoomed?.from).toBeCloseTo(2.5, 9);
    expect(zoomed?.to).toBeCloseTo(4.5, 9);
    // Zoomed out, pushed back inside the track.
    expect(zoomAround({ from: 0, to: 4 }, 0, 2, 10)).toEqual({ from: 0, to: 8 });
    expect(zoomAround({ from: 6, to: 10 }, 10, 2, 10)).toEqual({ from: 2, to: 10 });
    // It covers the track: no portion.
    expect(zoomAround({ from: 2, to: 8 }, 5, 2, 10)).toBeNull();
    expect(zoomAround(null, 5, 1, 10)).toBeNull();
    // Never under 200 m.
    const tiny = zoomAround({ from: 4, to: 4.3 }, 4.1, 0.1, 10);
    expect((tiny?.to ?? 0) - (tiny?.from ?? 0)).toBeCloseTo(MIN_SPAN_KM, 9);
  });

  test("range — pointsIn : les bouts sont interpolés", () => {
    const points = [
      { km: 0, lat: 45, lon: 6, ele: 100 },
      { km: 1, lat: 45.01, lon: 6, ele: 200 },
      { km: 2, lat: 45.02, lon: 6, ele: 400 },
      { km: 3, lat: 45.03, lon: 6 },
    ];
    const inside = pointsIn(points, { from: 0.5, to: 2.5 });
    expect(inside.map((p) => p.km)).toEqual([0.5, 1, 2, 2.5]);
    expect(inside[0]?.lat).toBeCloseTo(45.005, 9);
    expect(inside[0]?.ele).toBeCloseTo(150, 9);
    // An end on a point does not repeat it.
    expect(pointsIn(points, { from: 1, to: 2 }).map((p) => p.km)).toEqual([1, 2]);
    // Between two points: both ends are interpolated; no altitude if a neighbour has none.
    const between = pointsIn(points, { from: 2.2, to: 2.8 });
    expect(between.map((p) => p.km)).toEqual([2.2, 2.8]);
    expect(between[0] && "ele" in between[0]).toBe(false);
    const last = pointsIn(points, { from: 2.5, to: 3 });
    expect(last.at(-1)).toBe(points[3]);
    expect(last[0] && "ele" in last[0]).toBe(false);
    // Nothing to read in an empty track.
    expect(pointsIn([], { from: 0, to: 1 })).toEqual([]);
  });
});
