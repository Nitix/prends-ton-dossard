import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { weatherKind, weatherLabel } from "./labels";

// The table of the spec (§ 10.6): the WMO codes, in French and in English, and the icon.
const ROWS: { codes: number[]; fr: string; en: string; kind: string }[] = [
  { codes: [0], fr: "Ciel dégagé", en: "Clear sky", kind: "clear" },
  { codes: [1, 2], fr: "Peu nuageux", en: "Partly cloudy", kind: "partly" },
  { codes: [3], fr: "Couvert", en: "Overcast", kind: "overcast" },
  { codes: [45, 48], fr: "Brouillard", en: "Fog", kind: "fog" },
  { codes: [51, 53, 55, 56, 57], fr: "Bruine", en: "Drizzle", kind: "drizzle" },
  { codes: [61, 63], fr: "Pluie", en: "Rain", kind: "rain" },
  { codes: [65], fr: "Forte pluie", en: "Heavy rain", kind: "rain" },
  { codes: [66, 67], fr: "Pluie verglaçante", en: "Freezing rain", kind: "rain" },
  { codes: [71, 73, 75, 77], fr: "Neige", en: "Snow", kind: "snow" },
  { codes: [80, 81], fr: "Averses", en: "Showers", kind: "rain" },
  { codes: [82], fr: "Fortes averses", en: "Heavy showers", kind: "rain" },
  { codes: [85, 86], fr: "Averses de neige", en: "Snow showers", kind: "snow" },
  { codes: [95], fr: "Orage", en: "Thunderstorm", kind: "storm" },
  { codes: [96, 99], fr: "Orage et grêle", en: "Thunderstorm with hail", kind: "storm" },
];

describe("weatherLabel — chaque code", () => {
  test.each(ROWS.flatMap((row) => row.codes.map((code) => ({ code, ...row }))))(
    "code $code : $fr / $en",
    ({ code, fr: inFrench, en: inEnglish, kind }) => {
      expect(weatherLabel(code, fr)).toBe(inFrench);
      expect(weatherLabel(code, en)).toBe(inEnglish);
      expect(weatherKind(code)).toBe(kind);
    },
  );

  test.each([4, 10, 60, 100, -1, 61.5, Number.NaN])("le code %s est un temps inconnu", (code) => {
    expect(weatherLabel(code, fr)).toBe("Temps inconnu");
    expect(weatherLabel(code, en)).toBe("Unknown weather");
    expect(weatherKind(code)).toBe("unknown");
  });
});
