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
 * The colour of each zone: periwinkle, green, gold, tangerine, raspberry. Told
 * apart by their hue and their lightness, also with a colour vision deficiency
 * (the green is a warm one, the raspberry darker than the tangerine).
 */
export const SLOPE_COLORS: Record<SlopeZone, string> = {
  1: "#8da4f2",
  2: "#3fbf84",
  3: "#f8c64b",
  4: "#ff8a4c",
  5: "#d6336f",
};

/** The zone of a gradient, in percent, up or down. */
export function slopeZone(percent: number): SlopeZone {
  const steep = Math.abs(percent);
  const index = SLOPE_STEPS.findIndex((step) => steep < step);
  return SLOPE_ZONES[index === -1 ? 4 : index] ?? 5;
}
