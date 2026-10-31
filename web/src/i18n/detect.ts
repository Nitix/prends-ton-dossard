/** The languages the texts exist in. */
export type Lang = "fr" | "en";

/**
 * The language of the texts and the label the dates and numbers are formatted
 * with. They are two things: a browser set to `en-GB` gets English texts and
 * day-first dates, one set to `fr-CA` gets French texts and Canadian ones.
 */
export type DetectedLocale = { lang: Lang; formatLocale: string };

function isLang(language: string): language is Lang {
  return language === "fr" || language === "en";
}

/** The canonical form of a language tag (`EN-us` gives `en-US`), or undefined when it is malformed. */
function canonicalize(tag: string): string | undefined {
  try {
    return Intl.getCanonicalLocales(tag)[0];
  } catch {
    return undefined;
  }
}

/**
 * Picks the first language of the browser's list that the app handles, in
 * order, and keeps its full label for formatting. When none is handled, the
 * app is in French.
 */
export function detectLocale(languages: readonly string[]): DetectedLocale {
  for (const tag of languages) {
    const formatLocale = canonicalize(tag);
    if (formatLocale === undefined) continue;
    const { language } = new Intl.Locale(formatLocale);
    if (isLang(language)) return { lang: language, formatLocale };
  }
  return { lang: "fr", formatLocale: "fr-FR" };
}
