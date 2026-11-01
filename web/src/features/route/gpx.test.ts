import { describe, expect, test } from "vitest";

import { gpxStats, HYSTERESIS_M, simplify, toTrack, type TrackPoint } from "./gpx";

// What reads a file (`parseGpx`) needs the DOMParser of a browser, and is tested
// in parseGpx.test.tsx. Here is the arithmetic on the points, which a plain
// Node runs.

/** A track of the given altitudes, a little to the north at each point (about 11 m). */
function climb(altitudes: number[]): TrackPoint[] {
  return toTrack(altitudes.map((ele, i) => ({ lat: 45 + i / 10_000, lon: 6, ele })));
}

/** n points of a straight line to the east, with no altitude. */
function line(n: number): TrackPoint[] {
  return toTrack(Array.from({ length: n }, (_, i) => ({ lat: 45, lon: 6 + i / 10_000 })));
}

describe("gpxStats", () => {
  test("gpxStats — distance de haversine", () => {
    // One degree of latitude is R × π / 180 on a sphere of radius 6 371 km.
    const degree = gpxStats(
      toTrack([
        { lat: 0, lon: 0 },
        { lat: 1, lon: 0 },
      ]),
    );
    expect(degree.km).toBeCloseTo(111.195, 2);
    expect(Math.abs(degree.km - 111.1949) / 111.1949).toBeLessThan(0.001);

    // Paris to London, by the law of cosines (343.556 km).
    const channel = gpxStats(
      toTrack([
        { lat: 48.8566, lon: 2.3522 },
        { lat: 51.5074, lon: -0.1278 },
      ]),
    );
    expect(Math.abs(channel.km - 343.556) / 343.556).toBeLessThan(0.001);
  });

  test("gpxStats — la distance cumule les segments, de 0 au premier point", () => {
    const points = toTrack([
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
      { lat: 2, lon: 0 },
    ]);
    expect(points.map((p) => p.km)[0]).toBe(0);
    expect(points[1]?.km).toBeCloseTo(111.195, 2);
    expect(points[2]?.km).toBeCloseTo(222.39, 2);
    expect(gpxStats(points).km).toBe(points[2]?.km);
  });

  test("gpxStats — le bruit sous 3 m ne compte pas", () => {
    expect(HYSTERESIS_M).toBe(3);

    // A flat track whose altitude shakes by 2 m: nothing climbed, nothing descended.
    const flat = gpxStats(climb(Array.from({ length: 60 }, (_, i) => 100 + (i % 2 === 0 ? 0 : 2))));
    expect(flat.gain).toBe(0);
    expect(flat.loss).toBe(0);

    // A real climb of 100 m with the same noise on top: the sum of the rises
    // would be 150 m, the climb is what is above the last valley.
    const noisy = climb(Array.from({ length: 101 }, (_, i) => i + (i % 2 === 0 ? 0 : 2)));
    const naive = noisy.reduce((sum, p, i) => {
      const before = noisy[i - 1]?.ele;
      return before !== undefined && p.ele !== undefined && p.ele > before
        ? sum + p.ele - before
        : sum;
    }, 0);
    expect(naive).toBeGreaterThan(140);
    const { gain, loss } = gpxStats(noisy);
    expect(gain).toBeGreaterThanOrEqual(100);
    expect(gain).toBeLessThanOrEqual(104);
    expect(loss).toBe(0);
  });

  test("gpxStats — un écart de 3 m compte, de 2 m non", () => {
    expect(gpxStats(climb([100, 103])).gain).toBe(3);
    expect(gpxStats(climb([100, 102.9])).gain).toBe(0);
    expect(gpxStats(climb([103, 100])).loss).toBe(3);
    expect(gpxStats(climb([103, 100.1])).loss).toBe(0);
  });

  test("gpxStats — une montée de 100 m compte 100", () => {
    const up = gpxStats(climb([0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]));
    expect(up).toMatchObject({ gain: 100, loss: 0, min: 0, max: 100 });

    const down = gpxStats(climb([100, 80, 60, 40, 20, 0]));
    expect(down).toMatchObject({ gain: 0, loss: 100, min: 0, max: 100 });

    // Up, down, up again: the two climbs and the descent in between are counted.
    const hills = gpxStats(climb([0, 50, 100, 50, 0, 50, 100]));
    expect(hills).toMatchObject({ gain: 200, loss: 100 });
  });

  test("gpxStats — un point sans altitude ne coupe pas la mesure", () => {
    const points = toTrack([
      { lat: 45, lon: 6, ele: 0 },
      { lat: 45.001, lon: 6 },
      { lat: 45.002, lon: 6, ele: 50 },
    ]);
    expect(gpxStats(points)).toMatchObject({ gain: 50, loss: 0, min: 0, max: 50 });
  });

  test("gpxStats — sans altitude, ni dénivelé ni extrêmes, mais la distance", () => {
    const stats = gpxStats(line(20));
    expect(stats.km).toBeGreaterThan(0.1);
    expect(stats.gain).toBe(0);
    expect(stats.loss).toBe(0);
    expect(stats.min).toBeUndefined();
    expect(stats.max).toBeUndefined();
    expect("min" in stats).toBe(false);
    expect("max" in stats).toBe(false);
  });

  test("gpxStats — une trace vide ou d'un point", () => {
    expect(gpxStats([])).toEqual({ km: 0, gain: 0, loss: 0 });
    expect(gpxStats(climb([300]))).toEqual({ km: 0, gain: 0, loss: 0, min: 300, max: 300 });
  });
});

describe("simplify", () => {
  test("simplify — 1000 points au plus, premier et dernier gardés", () => {
    // 2 000 is the one where a point every two is not enough: the last one is
    // not on the grid, and keeping it as well would make 1 001.
    for (const n of [1001, 1999, 2000, 2001, 2500, 12_345]) {
      const points = line(n);
      const simple = simplify(points);
      const kms = simple.map((p) => p.km);
      expect({
        n,
        atMost1000: simple.length <= 1000,
        enough: simple.length > 300,
        first: simple[0] === points[0],
        last: simple.at(-1) === points.at(-1),
        inOrder: kms.every((km, i) => km >= (kms[i - 1] ?? 0)),
      }).toEqual({ n, atMost1000: true, enough: true, first: true, last: true, inOrder: true });
    }
  });

  test("simplify — un point sur ceil(n / max)", () => {
    const points = line(2500);
    // ceil(2500 / 1000) = 3: the points 0, 3, 6… and the last one, 2499 (= 3 × 833).
    expect(simplify(points).map((p) => p.km)).toEqual(
      Array.from({ length: 834 }, (_, i) => points[i * 3]?.km),
    );
    // With another maximum: ceil(2500 / 100) = 25, the points 0, 25… 2475 make 100 already,
    // so the last one takes the place of the 2475th rather than make 101.
    const hundred = simplify(points, 100);
    expect(hundred).toHaveLength(100);
    expect(hundred[1]).toBe(points[25]);
    expect(hundred[98]).toBe(points[2450]);
    expect(hundred.at(-1)).toBe(points[2499]);
  });

  test("simplify — une trace assez courte reste telle quelle", () => {
    const points = line(1000);
    expect(simplify(points)).toEqual(points);
    expect(simplify([])).toEqual([]);
    const two = line(2);
    expect(simplify(two, 2)).toEqual(two);
  });
});
