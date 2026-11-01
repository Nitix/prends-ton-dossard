import type { Messages } from "../../i18n/fr";
import type { Formatters } from "../../lib/format";
import type { FormatRecord } from "../../lib/types";

/**
 * The fields of a format that its name, its measures and its price come from.
 * The API sends `""` and `0` for what is not set: an empty value counts as
 * absent.
 */
type FormatFields = Pick<
  FormatRecord,
  "name" | "distance_km" | "duration_min" | "time_limit_min" | "elevation_gain_m" | "price_eur"
>;

/**
 * What a format is mainly measured by, in this order of priority: its
 * distance ("42,2 km"), its duration ("6h"), its time limit ("max 48h").
 */
function mainMeasure(format: FormatFields, f: Formatters, t: Messages): string | undefined {
  if (format.distance_km) return f.km(format.distance_km);
  if (format.duration_min) return f.duration(format.duration_min);
  if (format.time_limit_min) return t.format.max(f.duration(format.time_limit_min));
  return undefined;
}

/**
 * What a format is called: the name typed by the user, otherwise one made of
 * its type and its main measure ("Trail 42,2 km", "Route 6h", "Backyard max
 * 48h"). A format with no measure is called by its type.
 */
export function formatDisplayName(
  format: Omit<FormatFields, "elevation_gain_m" | "price_eur">,
  raceTypeLabel: string,
  f: Formatters,
  t: Messages,
): string {
  const name = format.name?.trim();
  if (name) return name;
  const measure = mainMeasure(format, f, t);
  return measure === undefined ? raceTypeLabel : `${raceTypeLabel} ${measure}`;
}

/**
 * The parts of the line that describes a format on a card, to be joined with
 * a separator: its name, its elevation gain, its time limit and its price.
 *
 * A format that has a name of its own also says what it is made of ("Marathon
 * de Lyon · Route 42,2 km"), leaving out its type when the name has it already
 * ("Trail court · 15 km"). The time limit is only added when the name does not
 * already say it, that is when there is a distance or a duration too. The
 * price, when there is one, comes last.
 */
export function formatMeasures(
  format: FormatFields,
  raceTypeLabel: string,
  f: Formatters,
  t: Messages,
): string[] {
  const name = format.name?.trim();
  const measure = mainMeasure(format, f, t);
  const parts: string[] = [];
  if (name) {
    parts.push(name);
    const typeInName = name.toLocaleLowerCase().includes(raceTypeLabel.toLocaleLowerCase());
    const made = typeInName
      ? measure
      : formatDisplayName({ ...format, name: undefined }, raceTypeLabel, f, t);
    if (made) parts.push(made);
  } else {
    parts.push(formatDisplayName(format, raceTypeLabel, f, t));
  }
  if (format.elevation_gain_m) parts.push(t.format.elevation(f.meters(format.elevation_gain_m)));
  if (format.time_limit_min && (format.distance_km || format.duration_min)) {
    parts.push(t.format.max(f.duration(format.time_limit_min)));
  }
  if (format.price_eur) parts.push(f.price(format.price_eur));
  return parts;
}
