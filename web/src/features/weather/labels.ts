import type { Messages } from "../../i18n/fr";

/** The words that a WMO code can have (the keys of `t.weather.kinds`). */
type Words = keyof Messages["weather"]["kinds"];

/** What the icon of a day draws: the weather, in few shapes. */
export type WeatherKind =
  | "clear"
  | "partly"
  | "overcast"
  | "fog"
  | "drizzle"
  | "rain"
  | "snow"
  | "storm"
  | "unknown";

// The table of the spec (§ 10.6): the WMO codes of Open-Meteo, their words and their icon.
const ROWS: { codes: number[]; words: Words; kind: WeatherKind }[] = [
  { codes: [0], words: "clear", kind: "clear" },
  { codes: [1, 2], words: "partly", kind: "partly" },
  { codes: [3], words: "overcast", kind: "overcast" },
  { codes: [45, 48], words: "fog", kind: "fog" },
  { codes: [51, 53, 55, 56, 57], words: "drizzle", kind: "drizzle" },
  { codes: [61, 63], words: "rain", kind: "rain" },
  { codes: [65], words: "heavyRain", kind: "rain" },
  { codes: [66, 67], words: "freezingRain", kind: "rain" },
  { codes: [71, 73, 75, 77], words: "snow", kind: "snow" },
  { codes: [80, 81], words: "showers", kind: "rain" },
  { codes: [82], words: "heavyShowers", kind: "rain" },
  { codes: [85, 86], words: "snowShowers", kind: "snow" },
  { codes: [95], words: "storm", kind: "storm" },
  { codes: [96, 99], words: "hail", kind: "storm" },
];

function rowOf(code: number) {
  return ROWS.find((row) => row.codes.includes(code));
}

/** The weather of a WMO code in words ("Averses"); "Temps inconnu" for a code that is not in the table. */
export function weatherLabel(code: number, t: Messages): string {
  return t.weather.kinds[rowOf(code)?.words ?? "unknown"];
}

/** The icon of a WMO code. */
export function weatherKind(code: number): WeatherKind {
  return rowOf(code)?.kind ?? "unknown";
}
