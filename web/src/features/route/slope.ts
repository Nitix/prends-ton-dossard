// The steepness of a track in five zones, the colours of the elevation profile
// (from the « Chrono » variant, in the tones of the dawn). Each colour is a mark:
// the legend writes what it means, and the cursor of the profile says the slope
// in words; the colour alone never tells it.

export type SlopeZone = 1 | 2 | 3 | 4 | 5;

export const SLOPE_ZONES: readonly SlopeZone[] = [1, 2, 3, 4, 5];

/**
 * The upper bound of each zone, in percent of the absolute gradient: runnable
 * under 5 %, then 10, 15 and 25; the fifth zone is beyond.
 */
export const SLOPE_STEPS = [5, 10, 15, 25] as const;

/**
 * The colour of each zone, from the cool of the sky before dawn to the heat of
 * the sun: periwinkle, indigo, orchid, tangerine, raspberry. They are drawn as
 * solid areas on the white card, along the ink line, so each one is dark enough
 * to have 3:1 against the card (WCAG 2, for a graphic) and against the ink, and
 * far enough from its neighbours to be told apart with normal vision and with
 * protanopia or deuteranopia (slope.test.ts measures all of it). They were
 * checked with the validator of the data-visualisation method, for neighbours
 * and for any two zones. Change one, and the tests say what it costs.
 */
export const SLOPE_COLORS: Record<SlopeZone, string> = {
  1: "#828adf",
  2: "#6d49f4",
  3: "#994f9d",
  4: "#e8651d",
  5: "#d40554",
};

/** The zone of a gradient, in percent, up or down. */
export function slopeZone(percent: number): SlopeZone {
  const steep = Math.abs(percent);
  const index = SLOPE_STEPS.findIndex((step) => steep < step);
  return SLOPE_ZONES[index === -1 ? 4 : index] ?? 5;
}
