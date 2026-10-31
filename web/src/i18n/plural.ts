import type { Lang } from "./detect";

const rules = new Map<Lang, Intl.PluralRules>();

function rulesFor(lang: Lang): Intl.PluralRules {
  let found = rules.get(lang);
  if (!found) {
    found = new Intl.PluralRules(lang);
    rules.set(lang, found);
  }
  return found;
}

/**
 * Picks the form that agrees with `n`. French and English only have a singular
 * and a plural, but they do not draw the line at the same place: in French 0 is
 * singular ("0 course"), in English it is plural ("0 races").
 */
export function plural(lang: Lang, n: number, forms: { one: string; other: string }): string {
  return rulesFor(lang).select(n) === "one" ? forms.one : forms.other;
}
