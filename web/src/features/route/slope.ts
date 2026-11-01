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

/**
 * The same zones at night (the dark theme), where the profile is drawn on the
 * dark card with a white line. The colours of the day have 3:1 on the dark card
 * but only 2.5:1 with the white line, so each zone has its own colour there:
 * the same hue (within 6 degrees) in the same order, held to the same numbers
 * (3:1 on the card and with the line, the same distances between zones), and
 * inside the lightness band of the validator for a dark ground. The blue, the
 * mustard and the red are the light ones, the green and the orange the dark ones.
 */
export const SLOPE_COLORS_DARK: Record<SlopeZone, string> = {
  1: "#5e76df",
  2: "#197b5b",
  3: "#b88c00",
  4: "#c13c00",
  5: "#eb3394",
};

/**
 * What the drawing paints a zone with: the colour of the theme (styles.css has
 * both palettes, `--color-slope-1` to `-5`), so that it follows the theme of
 * the page without being drawn again.
 */
export const SLOPE_FILLS: Record<SlopeZone, string> = {
  1: "var(--color-slope-1)",
  2: "var(--color-slope-2)",
  3: "var(--color-slope-3)",
  4: "var(--color-slope-4)",
  5: "var(--color-slope-5)",
};

/** The zone of a gradient, in percent, up or down. */
export function slopeZone(percent: number): SlopeZone {
  const steep = Math.abs(percent);
  const index = SLOPE_STEPS.findIndex((step) => steep < step);
  return SLOPE_ZONES[index === -1 ? 4 : index] ?? 5;
}
