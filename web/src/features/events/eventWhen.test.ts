import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { plain } from "../../test/said";
import { dayOrMonth, eventWhen } from "./eventWhen";

const date = (s: string) => Temporal.PlainDate.from(s);
const FR = createFormatters("fr-FR");
const GB = createFormatters("en-GB");

/** The days of a race, as `eventWhen` takes them. */
const days = (start: string, end: string, extra: { date_precision?: string } = {}) => ({
  event: extra,
  start: date(start),
  end: date(end),
});

const june = days("2027-06-01", "2027-06-30", { date_precision: "month" });

describe("eventWhen", () => {
  test("a single day, short by default and long with the year", () => {
    const one = days("2026-06-13", "2026-06-13");
    expect(plain(eventWhen(one, FR, fr))).toBe("sam. 13 juin");
    expect(plain(eventWhen(one, FR, fr, "short"))).toBe("sam. 13 juin");
    expect(plain(eventWhen(one, FR, fr, "long"))).toBe("sam. 13 juin 2026");
  });

  test("a short range within a month and across months", () => {
    expect(plain(eventWhen(days("2026-06-13", "2026-06-14"), FR, fr))).toBe(
      "du sam. 13 juin au dim. 14 juin",
    );
    expect(plain(eventWhen(days("2026-06-30", "2026-07-01"), FR, fr))).toBe(
      "du mar. 30 juin au mer. 1 juil.",
    );
  });

  test("a long range gives the year to both days", () => {
    expect(plain(eventWhen(days("2026-06-13", "2026-06-14"), FR, fr, "long"))).toBe(
      "du sam. 13 juin 2026 au dim. 14 juin 2026",
    );
    expect(plain(eventWhen(days("2026-12-31", "2027-01-01"), FR, fr, "long"))).toBe(
      "du jeu. 31 déc. 2026 au ven. 1 janv. 2027",
    );
  });

  test("in English, with the words and the dates of the language", () => {
    expect(plain(eventWhen(days("2026-06-13", "2026-06-14"), GB, en, "long"))).toBe(
      "Sat, 13 Jun 2026 to Sun, 14 Jun 2026",
    );
    expect(plain(eventWhen(days("2026-06-13", "2026-06-13"), GB, en))).toBe("Sat 13 Jun");
  });

  test("a race known by its month says the month and that the date is to be set, in both languages and both styles", () => {
    expect(plain(eventWhen(june, FR, fr))).toBe("juin 2027 · date à préciser");
    expect(plain(eventWhen(june, FR, fr, "long"))).toBe("juin 2027 · date à préciser");
    expect(plain(eventWhen(june, GB, en))).toBe("June 2027 · date to be set");
  });

  test("an end that is the start is one day", () => {
    expect(plain(eventWhen(days("2026-06-13", "2026-06-13", {}), FR, fr))).toBe("sam. 13 juin");
  });
});

describe("dayOrMonth", () => {
  const dated = { start_date: "2026-06-13" };
  const month = { start_date: "2027-06-01", date_precision: "month" };

  test("a day, short and long", () => {
    expect(plain(dayOrMonth(dated, date("2026-06-14"), FR, fr))).toBe("dim. 14 juin");
    expect(plain(dayOrMonth(dated, date("2026-06-14"), FR, fr, "long"))).toBe("dim. 14 juin 2026");
    expect(plain(dayOrMonth(dated, date("2026-06-14"), GB, en))).toBe("Sun 14 Jun");
  });

  test("a race known by its month says its month, whatever the day given", () => {
    expect(plain(dayOrMonth(month, date("2027-06-01"), FR, fr))).toBe(
      "juin 2027 · date à préciser",
    );
    expect(plain(dayOrMonth(month, date("2027-06-30"), FR, fr, "long"))).toBe(
      "juin 2027 · date à préciser",
    );
    expect(plain(dayOrMonth(month, date("2027-06-01"), GB, en))).toBe("June 2027 · date to be set");
  });
});
