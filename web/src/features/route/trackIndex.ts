// The link between the map of a track and its elevation profile: where a
// kilometer of the profile is on the map, and which kilometer of the track is
// nearest to a place of the map. The map asks at every move of a pointer, on
// tracks of up to some 100 000 points: an index is built once per track, and a
// question is a binary search, or a look at a few parts of the track.

import type { TrackPoint } from "./gpx";

/** The kilometers in a degree of latitude, on the sphere of `gpx.ts`. */
const KM_PER_DEGREE = (6371 * Math.PI) / 180;

/**
 * How many segments a part of the track holds. Each part has its box: a search
 * skips a part whose box is further than the nearest segment found so far.
 */
const PART = 64;

/**
 * A track, ready for the questions of the map: its points, the kilometers from
 * the start (cumulated along the track, as `toTrack` worked them out), and the
 * same points on a flat map in kilometers (equirectangular: the longitudes
 * shrunk by the cosine of the latitude in the middle of the track, true enough
 * at the size of a race), with the box of each part of `PART` segments.
 */
export type TrackIndex = {
  readonly lat: Float64Array;
  readonly lon: Float64Array;
  readonly km: Float64Array;
  readonly x: Float64Array;
  readonly y: Float64Array;
  /** What a longitude is multiplied by, in kilometers, on the flat map. */
  readonly xScale: number;
  /** The box of each part: its least x and y, then its greatest, four numbers a part. */
  readonly boxes: Float64Array;
};

/** The index of a track. Build it once per track (a `useMemo`): it goes over every point. */
export function trackIndex(points: readonly TrackPoint[]): TrackIndex {
  const n = points.length;
  const lat = new Float64Array(n);
  const lon = new Float64Array(n);
  const km = new Float64Array(n);
  let south = Infinity;
  let north = -Infinity;
  for (const [i, point] of points.entries()) {
    lat[i] = point.lat;
    lon[i] = point.lon;
    km[i] = point.km;
    if (point.lat < south) south = point.lat;
    if (point.lat > north) north = point.lat;
  }

  const middle = n === 0 ? 0 : (south + north) / 2;
  const xScale = Math.cos((middle * Math.PI) / 180) * KM_PER_DEGREE;
  const x = lon.map((value) => value * xScale);
  const y = lat.map((value) => value * KM_PER_DEGREE);

  // Part p holds the segments from point p × PART to the point PART further
  // (or the last point): its box holds both ends of all of them, so a segment
  // is in the box of its part.
  const parts = Math.max(0, Math.ceil((n - 1) / PART));
  const boxes = new Float64Array(parts * 4);
  for (let p = 0; p < parts; p++) {
    const from = p * PART;
    const to = Math.min(from + PART, n - 1);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = from; i <= to; i++) {
      const px = x[i] ?? 0;
      const py = y[i] ?? 0;
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
      if (py > maxY) maxY = py;
    }
    boxes.set([minX, minY, maxX, maxY], p * 4);
  }

  return { lat, lon, km, x, y, xScale, boxes };
}

/**
 * The place of the track at a distance from its start: between the two points
 * around it, in proportion (a binary search on the kilometers). Before the
 * start, the start; after the finish, the finish. Nothing for a track with no point.
 */
export function pointAtKm(index: TrackIndex, at: number): { lat: number; lon: number } | undefined {
  const { lat, lon, km } = index;
  const last = km.length - 1;
  if (last < 0) return undefined;
  const firstKm = km[0] ?? 0;
  const lastKm = km[last] ?? 0;
  if (!(at > firstKm)) return { lat: lat[0] ?? 0, lon: lon[0] ?? 0 };
  if (at >= lastKm) return { lat: lat[last] ?? 0, lon: lon[last] ?? 0 };

  // The last point at or before `at`, and the one after it.
  let low = 0;
  let high = last;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((km[middle] ?? 0) <= at) low = middle;
    else high = middle;
  }
  const fromKm = km[low] ?? 0;
  const length = (km[high] ?? 0) - fromKm;
  const ratio = length > 0 ? (at - fromKm) / length : 0;
  const a = { lat: lat[low] ?? 0, lon: lon[low] ?? 0 };
  const b = { lat: lat[high] ?? 0, lon: lon[high] ?? 0 };
  return { lat: a.lat + (b.lat - a.lat) * ratio, lon: a.lon + (b.lon - a.lon) * ratio };
}

/**
 * The kilometer of the track nearest to a place: the nearest point of its
 * segments, on the flat map of the index, between two points if need be. The
 * part whose box is nearest is looked at first; then only the parts whose box
 * is nearer than what was found (the nearest part of a segment cannot be closer
 * than the box around it). Nothing for a track with no point.
 */
export function nearestKm(index: TrackIndex, lat: number, lon: number): number | undefined {
  const { km, x, y, boxes } = index;
  if (km.length === 0) return undefined;
  if (km.length === 1) return km[0];
  const qx = lon * index.xScale;
  const qy = lat * KM_PER_DEGREE;
  const parts = boxes.length / 4;

  // How far each box is, squared (0 inside it).
  const bounds = new Float64Array(parts);
  let first = 0;
  for (let p = 0; p < parts; p++) {
    const dx = Math.max((boxes[p * 4] ?? 0) - qx, 0, qx - (boxes[p * 4 + 2] ?? 0));
    const dy = Math.max((boxes[p * 4 + 1] ?? 0) - qy, 0, qy - (boxes[p * 4 + 3] ?? 0));
    const bound = dx * dx + dy * dy;
    bounds[p] = bound;
    if (bound < (bounds[first] ?? Infinity)) first = p;
  }

  let best = Infinity;
  let bestKm = km[0] ?? 0;
  const look = (p: number) => {
    const to = Math.min((p + 1) * PART, km.length - 1);
    for (let i = p * PART; i < to; i++) {
      const ax = x[i] ?? 0;
      const ay = y[i] ?? 0;
      const dx = (x[i + 1] ?? 0) - ax;
      const dy = (y[i + 1] ?? 0) - ay;
      const length = dx * dx + dy * dy;
      // Where the place falls on the segment, from 0 (its start) to 1 (its end).
      const t =
        length > 0 ? Math.min(1, Math.max(0, ((qx - ax) * dx + (qy - ay) * dy) / length)) : 0;
      const ex = ax + t * dx - qx;
      const ey = ay + t * dy - qy;
      const distance = ex * ex + ey * ey;
      if (distance < best) {
        best = distance;
        const fromKm = km[i] ?? 0;
        bestKm = fromKm + t * ((km[i + 1] ?? 0) - fromKm);
      }
    }
  };

  look(first);
  for (let p = 0; p < parts; p++) {
    if (p !== first && (bounds[p] ?? 0) < best) look(p);
  }
  return bestKm;
}
