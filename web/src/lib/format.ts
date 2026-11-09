// Formatting of dates, numbers and lists, only with Intl, in the formatting
// locale of the user (`fr-FR`, `en-GB`, `en-US`…, see ../i18n/detect.ts).
//
// `Temporal` is only touched inside functions, never at module scope: Safari
// loads the polyfill after the static imports have run (see ./temporal.ts).

import { PARIS } from "./dates";

export type Formatters = {
  /** Short weekday, day and short month: "dim. 14 juin", "Sun 14 Jun". */
  date(d: Temporal.PlainDate): string;
  /** Day and short month, with no weekday: "12 janv.", "12 Jan". */
  dayMonth(d: Temporal.PlainDate): string;
  /** Like `date`, with the year. */
  dateLong(d: Temporal.PlainDate): string;
  /** A date up to its day, with the same punctuation as `dateLong`, for the start of a range in one month: "sam. 13", "Sat, 13". */
  dateToDay(d: Temporal.PlainDate): string;
  /** The weekday of a date, alone: "lun." ("short"), "lundi" ("long"), "L" ("narrow"). */
  weekday(d: Temporal.PlainDate, style: "narrow" | "short" | "long"): string;
  /** Month and year: "juin 2026". */
  monthTitle(m: Temporal.PlainYearMonth): string;
  /** A number of days from today, in words when there are some: "dans 45 jours", "aujourd’hui". */
  inDays(n: number): string;
  /**
   * How long ago, in words when there are some: "maintenant", "il y a 2 heures",
   * "hier". Months and years are counted: "il y a 1 mois", never "le mois dernier",
   * which is not what 30 to 59 days are. The value is negative for the past (see
   * `elapsed` in ./dates.ts).
   */
  ago(value: number, unit: Intl.RelativeTimeFormatUnit): string;
  /** An instant as a long date and the time, in Paris: "1 novembre 2026 à 05:30". */
  dateTime(instant: Temporal.Instant): string;
  /** The time of an instant, in Paris: "14:05". */
  time(instant: Temporal.Instant): string;
  /**
   * The start time of a format, `HH:MM` as the site keeps it (a time of the day, at the place of the race: Paris time for a race in France; there
   * is no zone to convert): "7 h 30" in French, "7:30" in en-GB, "7:30 AM" in en-US. A text that is
   * not a time is given back as it is.
   */
  startTime(hhmm: string): string;
  /** A whole number in the language of the site, rounded; a small negative one is "0", never "-0". */
  integer(n: number): string;
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
  /**
   * A race time given in seconds, narrow style like `duration`: "4h 12min 30s", "4h 12m 30s".
   * A unit that is zero is left out, unless it is between two others: "1h 0min 5s", not "1h 5s".
   */
  raceTime(seconds: number): string;
  /** A rank in words, agreeing with its number: "1er", "12e" in French, "1st", "12th" in English. */
  ordinal(n: number): string;
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

const SECONDS_PER_HOUR = 3600;
const SECONDS_PER_MINUTE = 60;

// The ending of an ordinal number for each form of the plural rules of the
// language: "1er", "2e" in French (only 1 has a form of its own), "1st", "2nd",
// "3rd" and "4th" in English.
const ORDINAL_ENDINGS: Record<
  "fr" | "en",
  Partial<Record<Intl.LDMLPluralRule, string>> & { other: string }
> = {
  fr: { one: "er", other: "e" },
  en: { one: "st", two: "nd", few: "rd", other: "th" },
};

/**
 * A part of a formatted time, with its hour as one digit at least: Firefox writes the hour on two
 * digits (« 09 h 00 », « 07:30 AM »), Chrome and Safari on one: it is told the same everywhere.
 */
function plainHour(part: Intl.DateTimeFormatPart): string {
  return part.type === "hour" ? String(Number(part.value)) : part.value;
}

export function createFormatters(locale: string): Formatters {
  const relativeTime = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  const counted = new Intl.RelativeTimeFormat(locale, { numeric: "always" });
  const kilometers = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: "kilometer",
    maximumFractionDigits: 1,
  });
  const integers = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    signDisplay: "negative",
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
  // The same, with the minutes told even when there are none.
  const narrowDurationWithMinutes = new Intl.DurationFormat(locale, {
    style: "narrow",
    minutesDisplay: "always",
  });
  // The start time of a format: a time of the day, so it is formatted in UTC as it is written.
  const clock = new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
  const ordinals = new Intl.PluralRules(locale, { type: "ordinal" });
  // The app is in French or in English, and the locale may be a regional one (`fr-CA`): its language says which.
  const endings = ORDINAL_ENDINGS[new Intl.Locale(locale).language === "fr" ? "fr" : "en"];

  // The date goes through `toLocaleString`, which works with the native
  // Temporal as well as with the polyfill.
  const dayOptions = { weekday: "short", day: "numeric", month: "short" } as const;
  const dateParts = new Intl.DateTimeFormat(locale, {
    ...dayOptions,
    year: "numeric",
    timeZone: "UTC",
  });

  return {
    date: (d) => d.toLocaleString(locale, dayOptions),
    dayMonth: (d) => d.toLocaleString(locale, { day: "numeric", month: "short" }),
    dateLong: (d) => d.toLocaleString(locale, { ...dayOptions, year: "numeric" }),
    dateToDay: (d) => {
      // A civil date as the UTC day of a `Date`, which is what `formatToParts` takes.
      const parts = dateParts.formatToParts(Date.UTC(d.year, d.month - 1, d.day));
      const day = parts.findIndex((part) => part.type === "day");
      return parts
        .slice(0, day + 1)
        .map((part) => part.value)
        .join("");
    },
    weekday: (d, style) => d.toLocaleString(locale, { weekday: style }),
    // A year and month in the ISO calendar cannot be formatted with the
    // calendar of the locale ("Mismatched calendars"), a date can.
    monthTitle: (m) =>
      m.toPlainDate({ day: 1 }).toLocaleString(locale, { month: "long", year: "numeric" }),
    inDays: (n) => relativeTime.format(n, "day"),
    ago: (value, unit) =>
      (unit === "month" || unit === "year" ? counted : relativeTime).format(value, unit),
    dateTime: (instant) =>
      instant.toLocaleString(locale, { dateStyle: "long", timeStyle: "short", timeZone: PARIS }),
    time: (instant) => instant.toLocaleString(locale, { timeStyle: "short", timeZone: PARIS }),
    startTime: (hhmm) => {
      const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm);
      if (!m) return hhmm;
      const parts = clock.formatToParts(Date.UTC(2000, 0, 1, Number(m[1]), Number(m[2])));
      // French writes « 7 h 30 », not « 7:30 »: the digits and the day period are the locale's, the colon is not.
      if (new Intl.Locale(locale).language !== "fr") return parts.map(plainHour).join("");
      return parts
        .map((part) => (part.type === "literal" ? "\u00A0h\u00A0" : plainHour(part)))
        .join("");
    },
    integer: (n) => integers.format(n),
    km: (n) => kilometers.format(n),
    meters: (n) => meters.format(n),
    price: (eur) => euros.format(eur),
    list: (names) => conjunction.format(names),
    // A unit that is zero is left out: 2880 minutes is "48h".
    duration: (minutes) =>
      narrowDuration.format({ hours: Math.floor(minutes / 60), minutes: minutes % 60 }),
    raceTime: (seconds) => {
      const hours = Math.floor(seconds / SECONDS_PER_HOUR);
      const minutes = Math.floor((seconds % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE);
      const rest = seconds % SECONDS_PER_MINUTE;
      const zeroInTheMiddle = hours > 0 && minutes === 0 && rest > 0;
      return (zeroInTheMiddle ? narrowDurationWithMinutes : narrowDuration).format({
        hours,
        minutes,
        seconds: rest,
      });
    },
    ordinal: (n) => `${n}${endings[ordinals.select(n)] ?? endings.other}`,
    firstDayOfWeek: () => {
      const intlLocale: WeekInfoLocale = new Intl.Locale(locale);
      const info = intlLocale.getWeekInfo?.() ?? intlLocale.weekInfo;
      return info?.firstDay ?? MONDAY;
    },
  };
}
