import { describe, expect, test } from "vitest";

import { toTrack, type TrackPoint } from "./gpx";
import { nearestKm, pointAtKm, trackIndex } from "./trackIndex";

// The arithmetic of the link between the map and the profile, which a plain Node
// runs: where a kilometer is, and which kilometer is nearest to a place.

/** 2.2 km due north: three points, 0.01° (1.112 km) apart. */
const NORTH = toTrack([
  { lat: 45, lon: 6 },
  { lat: 45.01, lon: 6 },
  { lat: 45.02, lon: 6 },
]);

/** A number that a generator of the test draws, the same at every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/**
 * A winding track of n points, of about `km` kilometers: it goes north-east,
 * wanders, and comes back across itself, as a trail does.
 */
function winding(n: number, km = 40): TrackPoint[] {
  const span = km / 111;
  return toTrack(
    Array.from({ length: n }, (_, i) => {
      const progress = i / (n - 1);
      return {
        lat: 45 + span * 0.5 * Math.sin(progress * Math.PI * 3) + 0.002 * Math.sin(progress * 400),
        lon: 6 + span * progress + 0.003 * Math.cos(progress * 170),
      };
    }),
  );
}

/**
 * The nearest kilometer by looking at every segment: what the index must find,
 * faster. The same flat map: the longitudes are shrunk by the cosine of the
 * latitude in the middle of the track.
 */
function bruteNearestKm(points: TrackPoint[], lat: number, lon: number): number {
  const latitudes = points.map((point) => point.lat);
  const middle = (Math.min(...latitudes) + Math.max(...latitudes)) / 2;
  const cos = Math.cos((middle * Math.PI) / 180);
  let best = Infinity;
  let bestKm = points[0]?.km ?? 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!a || !b) continue;
    const ax = a.lon * cos;
    const bx = b.lon * cos;
    const dx = bx - ax;
    const dy = b.lat - a.lat;
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.min(1, Math.max(0, ((lon * cos - ax) * dx + (lat - a.lat) * dy) / length))
        : 0;
    const ex = ax + t * dx - lon * cos;
    const ey = a.lat + t * dy - lat;
    const distance = ex * ex + ey * ey;
    if (distance < best) {
      best = distance;
      bestKm = a.km + t * (b.km - a.km);
    }
  }
  return bestKm;
}

describe("pointAtKm", () => {
  test("pointAtKm — à un point, ce point ; entre deux, sur le segment, au prorata", () => {
    const index = trackIndex(NORTH);
    const [first, second, last] = NORTH;
    if (!first || !second || !last) throw new Error("three points");

    expect(pointAtKm(index, 0)).toEqual({ lat: 45, lon: 6 });
    expect(pointAtKm(index, second.km)).toEqual({ lat: 45.01, lon: 6 });
    expect(pointAtKm(index, last.km)).toEqual({ lat: 45.02, lon: 6 });
    // A quarter of the way: half of the first segment.
    const quarter = pointAtKm(index, second.km / 2);
    expect(quarter?.lat).toBeCloseTo(45.005, 9);
    expect(quarter?.lon).toBe(6);
    // Three quarters: half of the second one.
    expect(pointAtKm(index, (second.km + last.km) / 2)?.lat).toBeCloseTo(45.015, 9);
  });

  test("pointAtKm — avant le départ, le départ ; après l'arrivée, l'arrivée", () => {
    const index = trackIndex(NORTH);

    expect(pointAtKm(index, -3)).toEqual({ lat: 45, lon: 6 });
    expect(pointAtKm(index, 999)).toEqual({ lat: 45.02, lon: 6 });
    expect(pointAtKm(index, Number.NaN)).toEqual({ lat: 45, lon: 6 });
  });

  test("pointAtKm — deux points au même endroit, un point seul, aucun point", () => {
    const still = trackIndex(
      toTrack([
        { lat: 45, lon: 6 },
        { lat: 45, lon: 6 },
        { lat: 45.01, lon: 6 },
      ]),
    );
    expect(pointAtKm(still, 0)).toEqual({ lat: 45, lon: 6 });
    expect(JSON.stringify(pointAtKm(still, 0.5))).not.toContain("null");

    expect(pointAtKm(trackIndex(toTrack([{ lat: 45, lon: 6 }])), 2)).toEqual({ lat: 45, lon: 6 });
    expect(pointAtKm(trackIndex([]), 2)).toBeUndefined();
  });

  test("pointAtKm — sur une longue trace, chaque point à son kilomètre", () => {
    const points = winding(20_000);
    const index = trackIndex(points);
    for (const i of [0, 1, 777, 9_999, 15_432, 19_999]) {
      const point = points[i];
      if (!point) throw new Error(`no point ${i}`);
      const found = pointAtKm(index, point.km);
      expect(found?.lat).toBeCloseTo(point.lat, 9);
      expect(found?.lon).toBeCloseTo(point.lon, 9);
    }
  });
});

describe("nearestKm", () => {
  test("nearestKm — le kilomètre du point du tracé le plus proche, entre deux points s'il le faut", () => {
    const index = trackIndex(NORTH);
    const [, second, last] = NORTH;
    if (!second || !last) throw new Error("three points");

    // On a point, and a little to the east of it.
    expect(nearestKm(index, 45.01, 6)).toBeCloseTo(second.km, 9);
    expect(nearestKm(index, 45.01, 6.001)).toBeCloseTo(second.km, 9);
    // Beside the middle of the first segment: half of it, not one of its ends.
    expect(nearestKm(index, 45.005, 5.999)).toBeCloseTo(second.km / 2, 6);
    // Beyond the ends: the ends.
    expect(nearestKm(index, 44.9, 6)).toBe(0);
    expect(nearestKm(index, 45.5, 6.2)).toBeCloseTo(last.km, 9);
  });

  test("nearestKm — un aller-retour : le retour quand on est plus près du retour", () => {
    // North on lon 6, then back south on lon 6.002 (about 160 m to the east).
    const outAndBack = toTrack([
      { lat: 45, lon: 6 },
      { lat: 45.02, lon: 6 },
      { lat: 45.02, lon: 6.002 },
      { lat: 45, lon: 6.002 },
    ]);
    const index = trackIndex(outAndBack);
    const turn = outAndBack[2]?.km ?? 0;

    expect(nearestKm(index, 45.01, 6.0004)).toBeLessThan(turn);
    expect(nearestKm(index, 45.01, 6.0016)).toBeGreaterThan(turn);
  });

  test("nearestKm — un point seul, et aucun point", () => {
    expect(nearestKm(trackIndex(toTrack([{ lat: 45, lon: 6 }])), 46, 7)).toBe(0);
    expect(nearestKm(trackIndex([]), 46, 7)).toBeUndefined();
  });

  test("nearestKm — trouve ce que trouve la recherche sur chaque segment", () => {
    // The index skips the parts of the track that are too far: it must never skip the nearest.
    const points = winding(5_000);
    const index = trackIndex(points);
    const random = seeded(42);
    for (let i = 0; i < 400; i++) {
      // Around the track, and some way off it.
      const lat = 44.8 + random() * 0.6;
      const lon = 5.9 + random() * 0.6;
      expect(nearestKm(index, lat, lon), `at ${lat}, ${lon}`).toBeCloseTo(
        bruteNearestKm(points, lat, lon),
        6,
      );
    }
  });

  test("nearestKm — 100 000 points : une recherche prend bien moins qu'une image", () => {
    // A long ultra of 100 000 points (a point every 2 m over 200 km): the map
    // asks at every move of the pointer, and an image is 16 ms.
    const points = winding(100_000, 200);
    const builtAt = performance.now();
    const index = trackIndex(points);
    const built = performance.now() - builtAt;

    const random = seeded(7);
    const queries = Array.from({ length: 2_000 }, () => {
      // Most near the track, as a pointer that follows it; some far off.
      const point = points[Math.floor(random() * points.length)];
      const off = random() < 0.8 ? 0.0005 : 0.2;
      return {
        lat: (point?.lat ?? 45) + (random() - 0.5) * off,
        lon: (point?.lon ?? 6) + (random() - 0.5) * off,
      };
    });
    const startedAt = performance.now();
    let sum = 0;
    for (const { lat, lon } of queries) sum += nearestKm(index, lat, lon) ?? 0;
    const perQuery = (performance.now() - startedAt) / queries.length;

    expect(sum).toBeGreaterThan(0);
    // Loosely: a slow machine, or a busy one, has room.
    expect(perQuery, `${perQuery.toFixed(4)} ms per search`).toBeLessThan(2);
    expect(built, `${built.toFixed(1)} ms to build`).toBeLessThan(200);
    // And it is right there too.
    for (const { lat, lon } of queries.slice(0, 20)) {
      expect(nearestKm(index, lat, lon)).toBeCloseTo(bruteNearestKm(points, lat, lon), 6);
    }
  });

  test("nearestKm puis pointAtKm — un point du tracé revient sur lui-même", () => {
    const points = winding(3_000);
    const index = trackIndex(points);
    for (const i of [0, 10, 1_500, 2_999]) {
      const point = points[i];
      if (!point) throw new Error(`no point ${i}`);
      const km = nearestKm(index, point.lat, point.lon) ?? Number.NaN;
      const back = pointAtKm(index, km);
      expect(back?.lat).toBeCloseTo(point.lat, 7);
      expect(back?.lon).toBeCloseTo(point.lon, 7);
    }
  });
});
