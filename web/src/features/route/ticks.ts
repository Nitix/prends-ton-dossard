// The graduations of the elevation profile: round numbers, in a fixed count
// whatever the length and the altitudes of the track.

/** The steps that are told apart by the eye, within a power of ten: 1, 2, 2.5 and 5 (2.5 only for the distance). */
const MANTISSAS = [1, 2, 2.5, 5];

/** The most graduations on the distance, whose fewest is then 4. */
const MAX_DISTANCE_TICKS = 6;

/** The most intervals between the graduations of the altitudes: 3 to 5 graduations. */
const MAX_ALTITUDE_INTERVALS = 4;

/** The scale of the altitudes is at least this high, whatever the track: a flat one has one too. */
const MIN_ALTITUDE_SPAN_M = 10;

/** Float noise out: 0.1 × 3 is 0.30000000000000004. */
const clean = (n: number): number => Number(n.toFixed(6));

/**
 * The graduations of the distance, in kilometers: from 0, evenly, at a round
 * step (0.1, 0.2, 0.5, 1, 2, 2.5, 5, 10…) that makes 4 to 6 of them up to
 * `km`. The label is written with one decimal at most, so a step is never
 * finer than 0.1: a track shorter than about 1.5 km has fewer graduations.
 */
export function distanceTicks(km: number): number[] {
  if (!(km > 0)) return [0];
  for (let exponent = -1; ; exponent++) {
    for (const mantissa of MANTISSAS) {
      const step = clean(mantissa * 10 ** exponent);
      // A step that one decimal cannot write (0.25) is not a step.
      if (clean(step * 10) !== Math.round(step * 10)) continue;
      const count = Math.floor(km / step + 1e-9) + 1;
      if (count <= MAX_DISTANCE_TICKS) {
        return Array.from({ length: count }, (_, i) => clean(i * step));
      }
    }
  }
}

/**
 * The scale of the altitudes, in whole meters: it goes from a round number at
 * or below the lowest altitude to one at or above the highest, with 3 to 5
 * graduations at a round step (1, 2, 5, 10, 20, 50…). It is at least 10 m high.
 */
export function altitudeScale(
  min: number,
  max: number,
): { from: number; to: number; ticks: number[] } {
  let low = min;
  let high = max;
  if (high - low < MIN_ALTITUDE_SPAN_M) {
    const middle = (low + high) / 2;
    low = middle - MIN_ALTITUDE_SPAN_M / 2;
    high = middle + MIN_ALTITUDE_SPAN_M / 2;
  }

  for (let exponent = 0; ; exponent++) {
    for (const mantissa of [1, 2, 5]) {
      const step = mantissa * 10 ** exponent;
      // Plus 0: the ceiling of -0.3 is -0, which Intl writes "-0 m".
      const from = Math.floor(low / step) * step + 0;
      const to = Math.ceil(high / step) * step + 0;
      const intervals = Math.round((to - from) / step);
      if (intervals <= MAX_ALTITUDE_INTERVALS) {
        return {
          from,
          to,
          ticks: Array.from({ length: intervals + 1 }, (_, i) => from + i * step),
        };
      }
    }
  }
}
