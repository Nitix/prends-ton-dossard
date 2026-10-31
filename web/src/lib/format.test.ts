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
