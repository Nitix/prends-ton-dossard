// Reading a GPX track in the browser, and what is worked out from its points:
// the distance, the elevation gain and loss, and the track reduced for drawing.
// The server never reads a track: it only keeps the file (see the v3 design,
// « Trace et parcours »).

/** A point of a track, with the distance from its start. */
export type TrackPoint = {
  lat: number;
  lon: number;
  /** The altitude in meters, when the file gives one. */
  ele?: number;
  /** The kilometers from the first point, along the track. */
  km: number;
};

/** What a file is that cannot be read as a track: not XML, or with no point. */
export class GpxError extends Error {}

/** A position, as read in the file, before the distances are worked out. */
export type RawPoint = { lat: number; lon: number; ele?: number };

const EARTH_RADIUS_KM = 6371;

const RADIANS_PER_DEGREE = Math.PI / 180;

/** The distance in kilometers between two positions, on a sphere (haversine formula). */
function haversineKm(a: RawPoint, b: RawPoint): number {
  const dLat = (b.lat - a.lat) * RADIANS_PER_DEGREE;
  const dLon = (b.lon - a.lon) * RADIANS_PER_DEGREE;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * RADIANS_PER_DEGREE) *
      Math.cos(b.lat * RADIANS_PER_DEGREE) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** The positions of a track with the kilometers cumulated along it, from 0 at the first. */
export function toTrack(raw: RawPoint[]): TrackPoint[] {
  let km = 0;
  return raw.map((point, i) => {
    const before = raw[i - 1];
    if (before) km += haversineKm(before, point);
    // An altitude that is not given is left out, rather than set to `undefined`.
    return point.ele === undefined
      ? { lat: point.lat, lon: point.lon, km }
      : { lat: point.lat, lon: point.lon, ele: point.ele, km };
  });
}

/** A number written in a file, or `undefined` when there is none: a blank is not a 0. */
function numberOf(text: string | null | undefined): number | undefined {
  if (text === null || text === undefined || text.trim() === "") return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The points of a GPX file: those of its track (`trkpt`, all its segments one
 * after the other), or of its route (`rtept`) when it has no track point. A
 * point without a usable position is left out; an altitude that is missing or
 * not a number is just not set. The elements are found by their local name, so
 * the file may or may not declare the GPX namespace, and may prefix it.
 *
 * @throws {GpxError} when the text is not XML, or has no point to draw.
 */
export function parseGpx(xml: string): TrackPoint[] {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  // Every browser says that it could not parse with a `parsererror` element.
  if (doc.getElementsByTagNameNS("*", "parsererror").length > 0) {
    throw new GpxError("The file is not valid XML.");
  }

  let elements = doc.getElementsByTagNameNS("*", "trkpt");
  if (elements.length === 0) elements = doc.getElementsByTagNameNS("*", "rtept");

  const raw: RawPoint[] = [];
  for (const element of elements) {
    const lat = numberOf(element.getAttribute("lat"));
    const lon = numberOf(element.getAttribute("lon"));
    if (lat === undefined || lon === undefined) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const ele = numberOf(element.getElementsByTagNameNS("*", "ele")[0]?.textContent);
    raw.push(ele === undefined ? { lat, lon } : { lat, lon, ele });
  }

  if (raw.length === 0) throw new GpxError("The file has no track point.");
  return toTrack(raw);
}

export type GpxStats = {
  /** The length of the track. */
  km: number;
  /** The elevation gain in meters, 0 without altitudes. */
  gain: number;
  /** The elevation loss in meters (a positive number), 0 without altitudes. */
  loss: number;
  /** The lowest altitude: absent when no point has one. */
  min?: number;
  /** The highest altitude: absent when no point has one. */
  max?: number;
};

/**
 * How much a GPS altitude has to move, from the last valley (or peak), to count
 * as a climb (or a descent). Under it, it is the noise of the receiver, which
 * adds up to a gain that was never climbed.
 */
export const HYSTERESIS_M = 3;

/**
 * The elevation gain and loss of a series of altitudes, with a hysteresis: the
 * leg in progress goes on to its last peak (or valley), and it is counted when
 * the altitude comes back by `HYSTERESIS_M` from that extreme, or at the end.
 * A rise (or fall) from the last valley (or peak) of `HYSTERESIS_M` or more
 * starts a leg; less is noise.
 */
function climb(altitudes: number[]): { gain: number; loss: number } {
  const [first, ...rest] = altitudes;
  if (first === undefined) return { gain: 0, loss: 0 };

  let gain = 0;
  let loss = 0;
  // Where the current leg started (the last confirmed valley or peak), and the
  // furthest the altitude has gone in the direction of the leg.
  let anchor = first;
  let extreme = first;
  let direction: "none" | "up" | "down" = "none";

  for (const ele of rest) {
    if (direction === "none") {
      if (ele - anchor >= HYSTERESIS_M) {
        direction = "up";
        extreme = ele;
      } else if (anchor - ele >= HYSTERESIS_M) {
        direction = "down";
        extreme = ele;
      }
    } else if (direction === "up") {
      if (ele > extreme) {
        extreme = ele;
      } else if (extreme - ele >= HYSTERESIS_M) {
        gain += extreme - anchor;
        anchor = extreme;
        extreme = ele;
        direction = "down";
      }
    } else if (ele < extreme) {
      extreme = ele;
    } else if (ele - extreme >= HYSTERESIS_M) {
      loss += anchor - extreme;
      anchor = extreme;
      extreme = ele;
      direction = "up";
    }
  }

  // The leg in progress at the end of the track.
  if (direction === "up") gain += extreme - anchor;
  if (direction === "down") loss += anchor - extreme;
  return { gain, loss };
}

/**
 * The numbers of a track, from all its points (a reduced track would lose some
 * of the climbs). The points without an altitude are skipped for the elevation.
 */
export function gpxStats(points: TrackPoint[]): GpxStats {
  const km = points.at(-1)?.km ?? 0;
  const altitudes = points.flatMap((point) => (point.ele === undefined ? [] : [point.ele]));
  if (altitudes.length === 0) return { km, gain: 0, loss: 0 };

  let min = Infinity;
  let max = -Infinity;
  for (const ele of altitudes) {
    if (ele < min) min = ele;
    if (ele > max) max = ele;
  }
  return { km, ...climb(altitudes), min, max };
}

/** How many points a drawing needs: more is a path that the eye cannot tell from this one. */
export const MAX_DRAWN_POINTS = 1000;

/**
 * A track reduced for drawing: one point out of `ceil(n / max)`, and always the
 * first and the last. A track that is short enough is returned as it is. The
 * kilometers of the points kept are those of the whole track.
 */
export function simplify<P extends TrackPoint>(points: P[], max = MAX_DRAWN_POINTS): P[] {
  const limit = Math.max(2, max);
  const last = points.at(-1);
  if (points.length <= limit || last === undefined) return points;

  const step = Math.ceil(points.length / limit);
  const kept = points.filter((_, i) => i % step === 0);
  if (kept.at(-1) !== last) {
    // The last point is not on the grid. It goes after the others, or in the
    // place of the last of them when that would make one too many.
    if (kept.length < limit) kept.push(last);
    else kept[kept.length - 1] = last;
  }
  return kept;
}
