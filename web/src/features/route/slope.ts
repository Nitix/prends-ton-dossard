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
 * The colour of each zone, from gentle to steep, in the rainbow of the « Chrono »
 * variant: blue, green, mustard, orange, red (the raspberry of the dawn). Each
 * is the hue of its zone darkened until it has 3:1 against the white card
 * (WCAG 2, for a graphic) and against the ink line drawn along it. Green,
 * mustard and orange are the hues that a deuteranope brings together: here the
 * orange is much darker, and the mustard stays yellow against a bluish green.
 * slope.test.ts measures the distance of neighbours, and of any two zones, with
 * normal vision and with protanopia and deuteranopia; the validator of the
 * data-visualisation method agrees. Change a colour, and the tests say what it
 * costs.
 */
export const SLOPE_COLORS: Record<SlopeZone, string> = {
  1: "#7c8dd6",
  2: "#4ca378",
  3: "#ba8907",
  4: "#b74802",
  5: "#ce0a6d",
};

/** The zone of a gradient, in percent, up or down. */
export function slopeZone(percent: number): SlopeZone {
  const steep = Math.abs(percent);
  const index = SLOPE_STEPS.findIndex((step) => steep < step);
  return SLOPE_ZONES[index === -1 ? 4 : index] ?? 5;
}
