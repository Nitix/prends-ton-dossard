import { createContext, use, useEffect, useMemo, type ReactNode } from "react";

import { createFormatters, type Formatters } from "../lib/format";
import { detectLocale, type Lang } from "./detect";
import { en } from "./en";
import { fr, type Messages } from "./fr";

type I18n = {
  /** The language of the texts. */
  lang: Lang;
  /** The label that dates and numbers are formatted with. */
  formatLocale: string;
  /** The texts, in `lang`. */
  t: Messages;
  /** The formatters, in `formatLocale`. */
  f: Formatters;
};

const dictionaries: Record<Lang, Messages> = { fr, en };

const I18nContext = createContext<I18n | null>(null);

/**
 * Gives the texts and formatters of the language of the browser to the app,
 * and keeps `<html lang>` in line with it. `languages` is only meant for
 * tests: it defaults to `navigator.languages`.
 */
export function I18nProvider({
  children,
  languages = navigator.languages,
}: {
  children: ReactNode;
  languages?: readonly string[];
}) {
  const value = useMemo<I18n>(() => {
    const { lang, formatLocale } = detectLocale(languages);
    return { lang, formatLocale, t: dictionaries[lang], f: createFormatters(formatLocale) };
  }, [languages]);

  useEffect(() => {
    document.documentElement.lang = value.lang;
  }, [value.lang]);

  return <I18nContext value={value}>{children}</I18nContext>;
}

export function useI18n(): I18n {
  const value = use(I18nContext);
  if (!value) throw new Error("useI18n must be used inside an I18nProvider");
  return value;
}
