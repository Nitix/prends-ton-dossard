// The graduations of the elevation profile: round numbers, in a fixed count
// whatever the length and the altitudes of the track.
//
// Both functions look for their step in a list of candidates built up front,
// never in an open loop: a value that is not finite or beyond reason (a crafted
// file, not a track) gets a scale all the same, and the search always ends.

/** The steps that are told apart by the eye, within a power of ten: 1, 2, 2.5 and 5 (2.5 only for the distance). */
const MANTISSAS = [1, 2, 2.5, 5];

/** The most graduations on the distance, whose fewest is then 4. */
const MAX_DISTANCE_TICKS = 6;

/** The most intervals between the graduations of the altitudes: 3 to 5 graduations. */
const MAX_ALTITUDE_INTERVALS = 4;

/** The scale of the altitudes is at least this high, whatever the track: a flat one has one too. */
const MIN_ALTITUDE_SPAN_M = 10;

/**
 * The scale of the altitudes is kept within this, up and down: a value beyond
 * is taken for it. It is ten times what a GPX file may say (see `MAX_ELEVATION_M`
 * in gpx.ts), and keeps every product below an overflow.
 */
const MAX_SCALE_M = 1_000_000;

/** Float noise out: 0.1 × 3 is 0.30000000000000004. */
const clean = (n: number): number => Number(n.toFixed(6));

/** The steps for the distance, from 0.1 km (the label has one decimal) up to the largest number there is. */
const DISTANCE_STEPS: number[] = Array.from({ length: 310 }, (_, i) => i - 1)
  .flatMap((exponent) => MANTISSAS.map((mantissa) => clean(mantissa * 10 ** exponent)))
  // A step that one decimal cannot write (0.25) is not a step.
  .filter((step) => Number.isFinite(step) && clean(step * 10) === Math.round(step * 10));

/** The steps for the altitudes, in whole meters, from 1 m to 5 000 km: well beyond the clamped scale. */
const ALTITUDE_STEPS: number[] = Array.from({ length: 7 }, (_, exponent) => exponent).flatMap(
  (exponent) => [1, 2, 5].map((mantissa) => mantissa * 10 ** exponent),
);

/**
 * The graduations of the distance, in kilometers, of a portion of the track:
 * the multiples of a round step (0.1, 0.2, 0.5, 1, 2, 2.5, 5, 10…) inside it,
 * at the first step that makes 6 of them at most (4 to 6 for a portion that
 * starts at 0 and is longer than about 1.5 km). The label is written with one
 * decimal at most, so a step is never finer than 0.1. A portion that is not
 * made of finite numbers, or has no length, has the one graduation at its start
 * (0 if that is not a number either).
 */
export function distanceTicks(from: number, to: number): number[] {
  if (!Number.isFinite(from) || !Number.isFinite(to) || !(to > from)) {
    return [Number.isFinite(from) ? from : 0];
  }
  const first = (step: number) => Math.ceil(from / step - 1e-9);
  const count = (step: number) => Math.floor(to / step + 1e-9) - first(step) + 1;
  // The first step that makes few enough of them; the largest step, which no finite length outgrows, if none does.
  const step =
    DISTANCE_STEPS.find((candidate) => count(candidate) <= MAX_DISTANCE_TICKS) ??
    DISTANCE_STEPS.at(-1) ??
    1;
  const length = Math.max(1, count(step));
  return Array.from({ length }, (_, i) => clean((first(step) + i) * step));
}

/** An altitude kept within the scale: a number that is not one is taken for sea level. */
const withinScale = (ele: number): number =>
  Number.isNaN(ele) ? 0 : Math.min(MAX_SCALE_M, Math.max(-MAX_SCALE_M, ele));

/**
 * The scale of the altitudes, in whole meters: it goes from a round number at
 * or below the lowest altitude to one at or above the highest, with 3 to 5
 * graduations at a round step (1, 2, 5, 10, 20, 50…). It is at least 10 m high,
 * and never goes below 0 for a track that does not. Altitudes beyond a million
 * meters, or that are not numbers, are brought back to that: the scale is
 * always finite.
 */
export function altitudeScale(
  min: number,
  max: number,
): { from: number; to: number; ticks: number[] } {
  const lowest = withinScale(min);
  const highest = withinScale(max);
  let low = lowest;
  let high = highest;
  if (high - low < MIN_ALTITUDE_SPAN_M) {
    const middle = (low + high) / 2;
    low = middle - MIN_ALTITUDE_SPAN_M / 2;
    high = middle + MIN_ALTITUDE_SPAN_M / 2;
    // Centred on a track at sea level, it would show −5 m: it goes up instead.
    if (lowest >= 0 && low < 0) {
      low = 0;
      high = MIN_ALTITUDE_SPAN_M;
    }
  }

  // The intervals of the scale at a step: from the round number below `low` to
  // the one above `high`. Plus 0: the ceiling of -0.3 is -0, which Intl writes "-0 m".
  const fromIndex = (step: number) => Math.floor(low / step) + 0;
  const intervalsAt = (step: number) => Math.ceil(high / step) - fromIndex(step);

  const step =
    ALTITUDE_STEPS.find((candidate) => intervalsAt(candidate) <= MAX_ALTITUDE_INTERVALS) ??
    ALTITUDE_STEPS.at(-1) ??
    1;
  const from = fromIndex(step) * step + 0;
  const intervals = Math.max(1, intervalsAt(step));
  return {
    from,
    to: from + intervals * step,
    ticks: Array.from({ length: intervals + 1 }, (_, i) => from + i * step),
  };
}
