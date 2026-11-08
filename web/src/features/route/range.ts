// A portion of a track, in kilometers from its start: what the elevation
// profile zooms on and the map follows (see RouteSection).

export type KmRange = { from: number; to: number };

/** The shortest portion there is: 200 m (or the whole track, when it is shorter). */
export const MIN_SPAN_KM = 0.2;

/** Float noise: a portion that ends this close to the track's ends is taken for reaching them. */
const EPSILON = 1e-9;

/**
 * A portion put right: its ends in order, inside `[0, lastKm]`, at least
 * `MIN_SPAN_KM` long (widened around its middle) or the whole track when that
 * is shorter. A portion that goes out of the track is pushed back in, keeping
 * its length.
 */
export function clampRange(range: KmRange, lastKm: number): KmRange {
  const low = Math.min(range.from, range.to);
  const high = Math.max(range.from, range.to);
  const span = Math.min(lastKm, Math.max(Math.min(MIN_SPAN_KM, lastKm), high - low));
  const middle = (low + high) / 2;
  const from = Math.min(lastKm - span, Math.max(0, middle - span / 2));
  return { from, to: from + span };
}

/**
 * The portion after a zoom around a kilometer: `factor` 0.5 makes it twice
 * shorter, 2 twice longer, and the kilometer stays at the same place of it.
 * `null` is the whole track, before and after: it is what comes back when the
 * portion covers the whole track.
 */
export function zoomAround(
  range: KmRange | null,
  km: number,
  factor: number,
  lastKm: number,
): KmRange | null {
  const current = range ?? { from: 0, to: lastKm };
  const span = current.to - current.from;
  const ratio = span > 0 ? Math.min(1, Math.max(0, (km - current.from) / span)) : 0.5;
  const next = span * factor;
  const from = km - ratio * next;
  const zoomed = clampRange({ from, to: from + next }, lastKm);
  return zoomed.from <= EPSILON && zoomed.to >= lastKm - EPSILON ? null : zoomed;
}

/** A point between two others, at a kilometer: every number they both have is worked out along the way. */
function between<P extends { km: number }>(a: P, b: P, km: number): P {
  const ratio = b.km === a.km ? 0 : (km - a.km) / (b.km - a.km);
  const point: Record<string, unknown> = { ...a };
  for (const [key, value] of Object.entries(a)) {
    const other = (b as Record<string, unknown>)[key];
    if (typeof value === "number" && typeof other === "number") {
      point[key] = value + (other - value) * ratio;
    } else if (!(key in b)) {
      // A value that the other has not (an altitude): the point between has none either.
      delete point[key];
    }
  }
  point["km"] = km;
  // The copy of a point of the track, with the numbers it has worked out: still a point of its kind.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return point as P;
}

/** The index of the first point at or after a kilometer, or after it when `strict` (the length if none). */
function firstFrom(points: { km: number }[], km: number, strict = false): number {
  let low = 0;
  let high = points.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const here = points[middle]?.km ?? 0;
    if (strict ? here <= km : here < km) low = middle + 1;
    else high = middle;
  }
  return low;
}

/**
 * The points of a portion, read in the whole track (their kilometers are the
 * track's): the points inside it, and its two ends worked out between the
 * points around them. An end that is on a point is that point.
 */
export function pointsIn<P extends { km: number }>(points: P[], range: KmRange): P[] {
  if (points.length === 0) return [];
  const start = firstFrom(points, range.from);
  const end = firstFrom(points, range.to, true);
  const inside = points.slice(start, end);
  const before = points[start - 1];
  const after = points[end];
  const head = inside[0];
  const tail = inside.at(-1);
  const result = [...inside];
  if (head?.km !== range.from) {
    const next = head ?? after;
    if (before && next) result.unshift(between(before, next, range.from));
  }
  if (tail?.km !== range.to && (tail !== undefined || result.length > 0 || before)) {
    const previous = tail ?? before;
    if (previous && after) result.push(between(previous, after, range.to));
  }
  return result;
}
