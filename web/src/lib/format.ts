// Formatting of dates, numbers and lists, only with Intl, in the formatting
// locale of the user (`fr-FR`, `en-GB`, `en-US`…, see ../i18n/detect.ts).
//
// `Temporal` is only touched inside functions, never at module scope: Safari
// loads the polyfill after the static imports have run (see ./temporal.ts).

export type Formatters = {
  /** Short weekday, day and short month: "dim. 14 juin", "Sun 14 Jun". */
  date(d: Temporal.PlainDate): string;
  /** Like `date`, with the year. */
  dateLong(d: Temporal.PlainDate): string;
  /** The weekday of a date, alone: "lun." ("short"), "lundi" ("long"), "L" ("narrow"). */
  weekday(d: Temporal.PlainDate, style: "narrow" | "short" | "long"): string;
  /** Month and year: "juin 2026". */
  monthTitle(m: Temporal.PlainYearMonth): string;
  /** A number of days from today, in words when there are some: "dans 45 jours", "aujourd’hui". */
  inDays(n: number): string;
  /** Kilometers, at most one decimal: "42,2 km". */
  km(n: number): string;
  /** Meters, no decimal: "2 400 m". */
  meters(n: number): string;
  /** A price in euros, with cents unless it is a round amount: "65 €", "42,50 €", "€42.50". */
  price(eur: number): string;
  /** Names joined with a conjunction: "Alice, Paul et Julie". */
  list(names: string[]): string;
  /** A number of minutes as hours and minutes, narrow style: "46h 30min". Meant for positive durations. */
  duration(minutes: number): string;
  /** The first day of the week, from 1 (Monday) to 7 (Sunday). Monday when the engine cannot tell. */
  firstDayOfWeek(): number;
};

// Chromium used to expose the week info as a `weekInfo` property, and newer
// engines as a `getWeekInfo()` method.
type WeekInfoLocale = {
  getWeekInfo?: () => { firstDay: number };
  weekInfo?: { firstDay: number };
};

const MONDAY = 1;

export function createFormatters(locale: string): Formatters {
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const kilometers = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    maximumFractionDigits: 1,
  });
  const meters = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "meter",
    maximumFractionDigits: 0,
  });
  const euros = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    trailingZeroDisplay: "stripIfInteger",
  });
  const conjunction = new Intl.ListFormat(locale, { type: "conjunction" });
  const narrowDuration = new Intl.DurationFormat(locale, { style: "narrow" });

  // The date goes through `toLocaleString`, which works with the native
  // Temporal as well as with the polyfill.
  const dayOptions = { weekday: "short", day: "numeric", month: "short" } as const;

  return {
    date: (d) => d.toLocaleString(locale, dayOptions),
    dateLong: (d) => d.toLocaleString(locale, { ...dayOptions, year: "numeric" }),
    weekday: (d, style) => d.toLocaleString(locale, { weekday: style }),
    // A year and month in the ISO calendar cannot be formatted with the
    // calendar of the locale ("Mismatched calendars"), a date can.
    monthTitle: (m) =>
      m.toPlainDate({ day: 1 }).toLocaleString(locale, { month: "long", year: "numeric" }),
    inDays: (n) => relativeTime.format(n, "day"),
    km: (n) => kilometers.format(n),
    meters: (n) => meters.format(n),
    price: (eur) => euros.format(eur),
    list: (names) => conjunction.format(names),
    // A unit that is zero is left out: 2880 minutes is "48h".
    duration: (minutes) =>
      narrowDuration.format({ hours: Math.floor(minutes / 60), minutes: minutes % 60 }),
    firstDayOfWeek: () => {
      const intlLocale: WeekInfoLocale = new Intl.Locale(locale);
      const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
      return info?.firstDay ?? MONDAY;
    },
  };
}
