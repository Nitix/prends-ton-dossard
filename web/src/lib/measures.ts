import type { Measure, RaceTypeRecord } from "./types";

/** The four measures of a format, in the order the form shows them and the admin lists them. */
export const MEASURES: readonly Measure[] = ["distance", "elevation", "duration", "time_limit"];

/**
 * The measures that a race type uses, in the usual order. A type that has chosen
 * none (the API sends an empty list), a list with nothing the form knows, or no
 * type at all, as in a format whose type is not chosen yet, uses all four.
 */
export function measuresOf(raceType: RaceTypeRecord | undefined): Measure[] {
  const chosen = raceType?.measures ?? [];
  const known = MEASURES.filter((measure) => chosen.includes(measure));
  return known.length > 0 ? known : [...MEASURES];
}

/**
 * The measures that the form of a format shows first. A format needs a
 * distance, a duration or a time limit, so a type whose measures have none of
 * the three (the elevation alone) shows the distance too: the person is never
 * left without a field to meet the requirement.
 */
export function shownMeasures(raceType: RaceTypeRecord | undefined): Measure[] {
  const used = measuresOf(raceType);
  return used.some((measure) => measure !== "elevation") ? used : ["distance", ...used];
}
