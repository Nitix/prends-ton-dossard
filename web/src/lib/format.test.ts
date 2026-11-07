import { afterEach, describe, expect, test } from "vitest";

import { createFormatters } from "./format";

/** Intl separates numbers and units with several kinds of non-breaking spaces. */
const plain = (s: string) => s.replace(/\s/g, " ");

const date = (s: string) => Temporal.PlainDate.from(s);

describe("date", () => {
  test.each([
    { locale: "fr-FR", expected: "dim. 14 juin" },
    { locale: "en-GB", expected: "Sun 14 Jun" },
    { locale: "en-US", expected: "Sun, Jun 14" },
  ])("$locale: $expected", ({ locale, expected }) => {
    expect(plain(createFormatters(locale).date(date("2026-06-14")))).toBe(expected);
  });

  test.each([
    { locale: "fr-FR", expected: "dim. 14 juin 2026" },
    { locale: "en-GB", expected: "Sun, 14 Jun 2026" },
    { locale: "en-US", expected: "Sun, Jun 14, 2026" },
  ])("dateLong, $locale: $expected", ({ locale, expected }) => {
    expect(plain(createFormatters(locale).dateLong(date("2026-06-14")))).toBe(expected);
  });
});

describe("dayMonth", () => {
  test.each([
    { locale: "fr-FR", expected: "12 janv." },
    { locale: "en-GB", expected: "12 Jan" },
  ])("$locale: $expected", ({ locale, expected }) => {
    expect(plain(createFormatters(locale).dayMonth(date("2026-01-12")))).toBe(expected);
  });
});

describe("monthTitle", () => {
  test.each([
    { locale: "fr-FR", expected: "juin 2026" },
    { locale: "en-GB", expected: "June 2026" },
    { locale: "en-US", expected: "June 2026" },
  ])("$locale: $expected", ({ locale, expected }) => {
    const month = Temporal.PlainYearMonth.from("2026-06");
    expect(plain(createFormatters(locale).monthTitle(month))).toBe(expected);
  });
});

describe("inDays", () => {
  test("counts the days to come", () => {
    expect(plain(createFormatters("fr-FR").inDays(45))).toBe("dans 45 jours");
    expect(plain(createFormatters("en-GB").inDays(45))).toBe("in 45 days");
  });

  test("says today in words", () => {
    expect(plain(createFormatters("fr-FR").inDays(0))).toBe("aujourd’hui");
    expect(plain(createFormatters("en-GB").inDays(0))).toBe("today");
  });

  test("says tomorrow in words", () => {
    expect(plain(createFormatters("fr-FR").inDays(1))).toBe("demain");
    expect(plain(createFormatters("en-GB").inDays(1))).toBe("tomorrow");
  });
});

describe("distances", () => {
  test("km keeps at most one decimal", () => {
    const f = createFormatters("fr-FR");
    expect(plain(f.km(42.195))).toBe("42,2 km");
    expect(plain(f.km(8))).toBe("8 km");
    expect(plain(createFormatters("en-GB").km(42.195))).toBe("42.2 km");
  });

  test("meters has no decimal and groups thousands", () => {
    const f = createFormatters("fr-FR");
    expect(plain(f.meters(2400))).toBe("2 400 m");
    expect(plain(f.meters(850.4))).toBe("850 m");
    expect(plain(createFormatters("en-GB").meters(2400))).toBe("2,400 m");
  });
});

describe("price", () => {
  test("price — deux décimales sauf pour un prix rond", () => {
    const fr = createFormatters("fr-FR");
    expect(plain(fr.price(65))).toBe("65 €");
    expect(plain(fr.price(42.5))).toBe("42,50 €");
    expect(plain(fr.price(19.99))).toBe("19,99 €");
    const gb = createFormatters("en-GB");
    expect(plain(gb.price(65))).toBe("€65");
    expect(plain(gb.price(42.5))).toBe("€42.50");
  });
});

describe("list", () => {
  test("joins names with a conjunction", () => {
    const names = ["Alice", "Paul", "Julie"];
    expect(createFormatters("fr-FR").list(names)).toBe("Alice, Paul et Julie");
    expect(createFormatters("en-GB").list(names)).toBe("Alice, Paul and Julie");
  });

  test("handles one and two names", () => {
    const f = createFormatters("fr-FR");
    expect(f.list(["Alice"])).toBe("Alice");
    expect(f.list(["Alice", "Paul"])).toBe("Alice et Paul");
  });
});

describe("duration", () => {
  test("writes hours and minutes in the narrow style", () => {
    expect(plain(createFormatters("fr-FR").duration(2790))).toBe("46h 30min");
    expect(plain(createFormatters("en-GB").duration(2790))).toBe("46h 30m");
  });

  test("drops the unit that is zero", () => {
    expect(plain(createFormatters("fr-FR").duration(2880))).toBe("48h");
    expect(plain(createFormatters("en-US").duration(45))).toBe("45m");
  });
});

describe("raceTime", () => {
  test("raceTime — heures, minutes, secondes", () => {
    // Narrow style, like `duration`: Intl.DurationFormat writes no space between a number and its unit.
    expect(plain(createFormatters("fr-FR").raceTime(15130))).toBe("4h 12min 10s");
    expect(plain(createFormatters("en-GB").raceTime(15150))).toBe("4h 12m 30s");
  });

  test("raceTime — une unité qui est zéro est omise, sauf entre deux autres", () => {
    const fr = createFormatters("fr-FR");
    expect(plain(fr.raceTime(14400))).toBe("4h");
    expect(plain(fr.raceTime(2520))).toBe("42min");
    expect(plain(fr.raceTime(125))).toBe("2min 5s");
    expect(plain(fr.raceTime(59))).toBe("59s");
    // 1 h 0 min 5 s, not "1h 5s": a zero in the middle is told.
    expect(plain(fr.raceTime(3605))).toBe("1h 0min 5s");
    expect(plain(createFormatters("en-US").raceTime(3605))).toBe("1h 0m 5s");
  });

  test("raceTime — plus de 24 heures, sans passer aux jours", () => {
    expect(plain(createFormatters("fr-FR").raceTime(100 * 3600 + 30 * 60))).toBe("100h 30min");
  });
});

describe("ordinal", () => {
  test("ordinal — 1er, 2e, 12e / 1st, 2nd, 12th", () => {
    const fr = createFormatters("fr-FR");
    expect([1, 2, 3, 12, 21, 100].map((n) => fr.ordinal(n))).toEqual([
      "1er",
      "2e",
      "3e",
      "12e",
      "21e",
      "100e",
    ]);
    const gb = createFormatters("en-GB");
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101].map((n) => gb.ordinal(n))).toEqual([
      "1st",
      "2nd",
      "3rd",
      "4th",
      "11th",
      "12th",
      "13th",
      "21st",
      "22nd",
      "23rd",
      "101st",
    ]);
  });

  test("ordinal — la langue est celle de la région : fr-CA est français, en-US anglais", () => {
    expect(createFormatters("fr-CA").ordinal(1)).toBe("1er");
    expect(createFormatters("en-US").ordinal(2)).toBe("2nd");
  });
});

describe("firstDayOfWeek", () => {
  test.each([
    { locale: "fr-FR", expected: 1 },
    { locale: "en-GB", expected: 1 },
    { locale: "en-US", expected: 7 },
  ])("$locale: $expected", ({ locale, expected }) => {
    expect(createFormatters(locale).firstDayOfWeek()).toBe(expected);
  });

  describe("on older engines", () => {
    const proto = Intl.Locale.prototype;
    const getWeekInfo = Object.getOwnPropertyDescriptor(proto, "getWeekInfo");

    afterEach(() => {
      if (getWeekInfo) Object.defineProperty(proto, "getWeekInfo", getWeekInfo);
      Reflect.deleteProperty(proto, "weekInfo");
    });

    test("reads the weekInfo property when getWeekInfo is missing", () => {
      Object.defineProperty(proto, "getWeekInfo", { value: undefined, configurable: true });
      Object.defineProperty(proto, "weekInfo", {
        get: () => ({ firstDay: 7 }),
        configurable: true,
      });
      expect(createFormatters("fr-FR").firstDayOfWeek()).toBe(7);
    });

    test("falls back to Monday when neither exists", () => {
      Object.defineProperty(proto, "getWeekInfo", { value: undefined, configurable: true });
      expect(createFormatters("en-US").firstDayOfWeek()).toBe(1);
    });
  });
});

describe("weekday", () => {
  // 2026-06-15 is a Monday.
  test.each([
    { locale: "fr-FR", style: "short", expected: "lun." },
    { locale: "fr-FR", style: "long", expected: "lundi" },
    { locale: "en-GB", style: "short", expected: "Mon" },
    { locale: "en-GB", style: "long", expected: "Monday" },
    { locale: "en-US", style: "short", expected: "Mon" },
  ] as const)("$locale, $style: $expected", ({ locale, style, expected }) => {
    expect(createFormatters(locale).weekday(date("2026-06-15"), style)).toBe(expected);
  });

  test("follows the day it is given", () => {
    expect(createFormatters("fr-FR").weekday(date("2026-06-21"), "short")).toBe("dim.");
  });
});

describe("ago", () => {
  test("ago — « maintenant », « il y a 2 heures », « hier »", () => {
    const fr = createFormatters("fr-FR");
    expect(plain(fr.ago(0, "second"))).toBe("maintenant");
    expect(plain(fr.ago(-2, "hour"))).toBe("il y a 2 heures");
    expect(plain(fr.ago(-1, "day"))).toBe("hier");
    expect(plain(fr.ago(-5, "minute"))).toBe("il y a 5 minutes");
    expect(plain(fr.ago(-2, "day"))).toBe("avant-hier");
    expect(plain(fr.ago(-2, "month"))).toBe("il y a 2 mois");
    const gb = createFormatters("en-GB");
    expect(plain(gb.ago(0, "second"))).toBe("now");
    expect(plain(gb.ago(-2, "hour"))).toBe("2 hours ago");
    expect(plain(gb.ago(-1, "day"))).toBe("yesterday");
  });

  // 30 to 59 days is not "last month", and 365 to 729 days is not "last year".
  test("ago — un mois et un an se comptent, sans « le mois dernier » ni « l'année dernière »", () => {
    const fr = createFormatters("fr-FR");
    expect(plain(fr.ago(-1, "month"))).toBe("il y a 1 mois");
    expect(plain(fr.ago(-1, "year"))).toBe("il y a 1 an");
    expect(plain(fr.ago(-3, "year"))).toBe("il y a 3 ans");
    const gb = createFormatters("en-GB");
    expect(plain(gb.ago(-1, "month"))).toBe("1 month ago");
    expect(plain(gb.ago(-1, "year"))).toBe("1 year ago");
  });
});

describe("dateTime", () => {
  test("dateTime — la date longue et l'heure, à Paris", () => {
    // 04:30 UTC is 05:30 in Paris in November (UTC+1).
    const winter = Temporal.Instant.from("2026-11-01T04:30:22.123Z");
    expect(plain(createFormatters("fr-FR").dateTime(winter))).toBe("1 novembre 2026 à 05:30");
    expect(plain(createFormatters("en-GB").dateTime(winter))).toBe("1 November 2026 at 05:30");
  });

  test("dateTime — l'heure d'été, et le jour de Paris même quand celui d'UTC est un autre", () => {
    // 22:30 UTC on 14 June is 00:30 on 15 June in Paris (UTC+2).
    const summer = Temporal.Instant.from("2026-06-14T22:30:00Z");
    expect(plain(createFormatters("fr-FR").dateTime(summer))).toBe("15 juin 2026 à 00:30");
  });
});

describe("time", () => {
  test("time — l'heure de Paris", () => {
    // 12:05 UTC in June is 14:05 in Paris (UTC+2).
    const instant = Temporal.Instant.from("2026-06-08T12:05:00Z");
    expect(createFormatters("fr-FR").time(instant)).toBe("14:05");
    expect(createFormatters("en-GB").time(instant)).toBe("14:05");
  });
});

describe("dateToDay", () => {
  test.each([
    { locale: "fr-FR", expected: "sam. 13" },
    { locale: "en-GB", expected: "Sat, 13" },
    { locale: "en-US", expected: "Sat, Jun 13" },
  ])("dateToDay, $locale: $expected", ({ locale, expected }) => {
    expect(plain(createFormatters(locale).dateToDay(date("2026-06-13")))).toBe(expected);
  });
});

describe("integer", () => {
  test("integer — arrondi, dans la langue, jamais « -0 »", () => {
    const fr = createFormatters("fr-FR");
    expect(fr.integer(17.3)).toBe("17");
    expect(fr.integer(-0.4)).toBe("0");
    expect(fr.integer(-2.6)).toBe("-3");
    expect(plain(fr.integer(1234.5))).toBe("1 235");
    expect(createFormatters("en-GB").integer(1234.4)).toBe("1,234");
  });
});
