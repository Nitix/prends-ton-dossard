import { afterEach, describe, expect, test, vi } from "vitest";

import {
  PARIS,
  daysBetween,
  effectiveDate,
  eventDays,
  eventRange,
  groupByMonth,
  isUpcoming,
  monthGrid,
  msUntilTomorrow,
  overlaps,
  parseDate,
  today,
} from "./dates";

const MONDAY = 1;
const SUNDAY = 7;

const date = (s: string) => Temporal.PlainDate.from(s);
const iso = (d: Temporal.PlainDate) => d.toString();

function first(grid: Temporal.PlainDate[][]): Temporal.PlainDate {
  const day = grid[0]?.[0];
  if (!day) throw new Error("empty grid");
  return day;
}

function last(grid: Temporal.PlainDate[][]): Temporal.PlainDate {
  const day = grid.at(-1)?.at(-1);
  if (!day) throw new Error("empty grid");
  return day;
}

// A two-day event over the 2026 Marathon weekend: 13 and 14 June.
const weekend = { start_date: "2026-06-13", end_date: "2026-06-14" };
// An event spanning two months.
const monthEnd = { start_date: "2026-06-30", end_date: "2026-07-01" };

describe("module load", () => {
  const native = Object.getOwnPropertyDescriptor(globalThis, "Temporal");

  afterEach(() => {
    if (native) Object.defineProperty(globalThis, "Temporal", native);
    vi.resetModules();
  });

  // On Safari the polyfill is loaded after the static imports have run, so
  // evaluating this module must not touch Temporal.
  test("never touches Temporal at module scope", async () => {
    expect(native).toBeDefined();
    Reflect.deleteProperty(globalThis, "Temporal");
    vi.resetModules();

    const fresh = await import("./dates");

    expect(fresh.PARIS).toBe("Europe/Paris");
  });
});

describe("PARIS", () => {
  test("is the Paris time zone", () => {
    expect(PARIS).toBe("Europe/Paris");
  });
});

describe("today", () => {
  test("is already the next day in Paris late on a summer evening (UTC+2)", () => {
    expect(iso(today(Temporal.Instant.from("2026-06-13T22:30:00Z")))).toBe("2026-06-14");
  });

  test("is still the same day in Paris one minute before midnight there", () => {
    expect(iso(today(Temporal.Instant.from("2026-06-13T21:59:00Z")))).toBe("2026-06-13");
  });

  test("is already the next day in Paris late on a winter evening (UTC+1)", () => {
    expect(iso(today(Temporal.Instant.from("2026-01-15T23:30:00Z")))).toBe("2026-01-16");
  });

  test("defaults to the current instant", () => {
    const before = Temporal.Now.instant().toZonedDateTimeISO(PARIS).toPlainDate();
    const result = today();
    const after = Temporal.Now.instant().toZonedDateTimeISO(PARIS).toPlainDate();

    expect(result.equals(before) || result.equals(after)).toBe(true);
  });
});

describe("msUntilTomorrow", () => {
  test("is one minute at 23:59 in Paris in winter (UTC+1)", () => {
    expect(msUntilTomorrow(Temporal.Instant.from("2026-11-01T22:59:00Z"))).toBe(60_000);
  });

  test("is thirty seconds at 23:59:30 in Paris in summer (UTC+2)", () => {
    expect(msUntilTomorrow(Temporal.Instant.from("2026-06-13T21:59:30Z"))).toBe(30_000);
  });

  test("is a whole day at midnight in Paris", () => {
    expect(msUntilTomorrow(Temporal.Instant.from("2026-06-13T22:00:00Z"))).toBe(86_400_000);
  });

  test("is 23 hours on the day the clocks go forward", () => {
    // Midnight in Paris on 29 March 2026, the day of the change to summer time.
    expect(msUntilTomorrow(Temporal.Instant.from("2026-03-28T23:00:00Z"))).toBe(23 * 3_600_000);
  });

  test("ends where today() changes", () => {
    const now = Temporal.Instant.from("2026-11-01T10:15:00Z");
    const midnight = now.add({ milliseconds: msUntilTomorrow(now) });

    expect(iso(today(midnight.subtract({ milliseconds: 1 })))).toBe("2026-11-01");
    expect(iso(today(midnight))).toBe("2026-11-02");
  });
});

describe("parseDate", () => {
  test("reads an ISO civil date", () => {
    const d = parseDate("2026-06-14");

    expect(d.year).toBe(2026);
    expect(d.month).toBe(6);
    expect(d.day).toBe(14);
  });

  test("rejects a date that does not exist", () => {
    expect(() => parseDate("2026-02-30")).toThrow(RangeError);
  });

  test("rejects something that is not a date", () => {
    expect(() => parseDate("demain")).toThrow(RangeError);
  });
});

describe("effectiveDate", () => {
  test("is the date of the format when it has its own", () => {
    expect(iso(effectiveDate({ date: "2026-06-14" }, { start_date: "2026-06-13" }))).toBe(
      "2026-06-14",
    );
  });

  test("falls back to the start of the event", () => {
    expect(iso(effectiveDate({}, { start_date: "2026-06-13" }))).toBe("2026-06-13");
  });

  test("treats an empty date as absent (empty text field from the API)", () => {
    expect(iso(effectiveDate({ date: "" }, { start_date: "2026-06-13" }))).toBe("2026-06-13");
  });
});

describe("eventRange", () => {
  test("goes from the start to the end date", () => {
    const { start, end } = eventRange(weekend);

    expect(iso(start)).toBe("2026-06-13");
    expect(iso(end)).toBe("2026-06-14");
  });

  test("ends on the start date for a one-day event", () => {
    const { start, end } = eventRange({ start_date: "2026-06-13" });

    expect(iso(start)).toBe("2026-06-13");
    expect(iso(end)).toBe("2026-06-13");
  });

  test("treats an empty end date as absent (empty text field from the API)", () => {
    const { end } = eventRange({ start_date: "2026-06-13", end_date: "" });

    expect(iso(end)).toBe("2026-06-13");
  });
});

describe("eventDays", () => {
  test("lists every day of a multi-day event, both ends included", () => {
    expect(eventDays(monthEnd).map(iso)).toEqual(["2026-06-30", "2026-07-01"]);
  });

  test("lists the single day of a one-day event", () => {
    expect(eventDays({ start_date: "2026-06-13" }).map(iso)).toEqual(["2026-06-13"]);
  });

  test("crosses a year boundary", () => {
    expect(eventDays({ start_date: "2026-12-30", end_date: "2027-01-02" }).map(iso)).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
  });
});

describe("isUpcoming", () => {
  test("is true on the last day of the event", () => {
    expect(isUpcoming(weekend, date("2026-06-14"))).toBe(true);
  });

  test("is true during the event, before its last day", () => {
    expect(isUpcoming(weekend, date("2026-06-13"))).toBe(true);
  });

  test("is true before the event", () => {
    expect(isUpcoming(weekend, date("2026-05-01"))).toBe(true);
  });

  test("is false the day after the event", () => {
    expect(isUpcoming(weekend, date("2026-06-15"))).toBe(false);
  });

  test("is true for a one-day event that starts today", () => {
    expect(isUpcoming({ start_date: "2026-06-14" }, date("2026-06-14"))).toBe(true);
  });

  test("is false for a one-day event that was yesterday", () => {
    expect(isUpcoming({ start_date: "2026-06-13" }, date("2026-06-14"))).toBe(false);
  });
});

describe("overlaps", () => {
  test("a month-end event overlaps both June and July", () => {
    expect(overlaps(monthEnd, date("2026-06-01"), date("2026-06-30"))).toBe(true);
    expect(overlaps(monthEnd, date("2026-07-01"), date("2026-07-31"))).toBe(true);
  });

  test("a month-end event does not overlap May or August", () => {
    expect(overlaps(monthEnd, date("2026-05-01"), date("2026-05-31"))).toBe(false);
    expect(overlaps(monthEnd, date("2026-08-01"), date("2026-08-31"))).toBe(false);
  });

  test("the bounds of the window are inclusive", () => {
    expect(overlaps(weekend, date("2026-06-14"), date("2026-06-20"))).toBe(true);
    expect(overlaps(weekend, date("2026-06-01"), date("2026-06-13"))).toBe(true);
    expect(overlaps(weekend, date("2026-06-15"), date("2026-06-20"))).toBe(false);
    expect(overlaps(weekend, date("2026-06-01"), date("2026-06-12"))).toBe(false);
  });

  test("an event that contains the whole window overlaps it", () => {
    const long = { start_date: "2026-06-01", end_date: "2026-06-30" };

    expect(overlaps(long, date("2026-06-10"), date("2026-06-12"))).toBe(true);
  });

  test("a one-day event overlaps a window that contains its day", () => {
    expect(overlaps({ start_date: "2026-06-13" }, date("2026-06-13"), date("2026-06-13"))).toBe(
      true,
    );
  });
});

describe("groupByMonth", () => {
  const dates = [date("2026-05-20"), date("2026-06-01"), date("2026-06-14")];

  test("groups the items by month, in order", () => {
    const groups = groupByMonth(dates, (d) => d);

    expect(groups).toHaveLength(2);
    expect(groups.map((g) => g.month.toString())).toEqual(["2026-05", "2026-06"]);
    expect(groups[0]?.items.map(iso)).toEqual(["2026-05-20"]);
    expect(groups[1]?.items.map(iso)).toEqual(["2026-06-01", "2026-06-14"]);
  });

  test("keeps the same month of different years apart", () => {
    const groups = groupByMonth([date("2026-06-14"), date("2027-06-14")], (d) => d);

    expect(groups.map((g) => g.month.toString())).toEqual(["2026-06", "2027-06"]);
  });

  test("groups arbitrary items through the accessor", () => {
    const events = [
      { name: "A", start: date("2026-06-13") },
      { name: "B", start: date("2026-07-02") },
      { name: "C", start: date("2026-07-05") },
    ];

    const groups = groupByMonth(events, (e) => e.start);

    expect(groups.map((g) => g.items.map((e) => e.name))).toEqual([["A"], ["B", "C"]]);
  });

  test("returns no group for no item", () => {
    expect(groupByMonth([], (d: Temporal.PlainDate) => d)).toEqual([]);
  });
});

describe("monthGrid", () => {
  test("June 2026, weeks starting on Monday: 5 weeks, 1 June to 5 July", () => {
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-06"), MONDAY);

    expect(grid).toHaveLength(5);
    expect(iso(first(grid))).toBe("2026-06-01");
    expect(iso(last(grid))).toBe("2026-07-05");
  });

  test("June 2026, weeks starting on Sunday: starts on 31 May", () => {
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-06"), SUNDAY);

    expect(iso(first(grid))).toBe("2026-05-31");
    expect(iso(last(grid))).toBe("2026-07-04");
  });

  test("February 2026, weeks starting on Monday: starts on 26 January", () => {
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-02"), MONDAY);

    expect(iso(first(grid))).toBe("2026-01-26");
    // 1 Feb 2026 is a Sunday and 28 Feb a Saturday: 5 full weeks.
    expect(grid).toHaveLength(5);
    expect(iso(last(grid))).toBe("2026-03-01");
  });

  test("December 2026, weeks starting on Monday: ends on 3 January 2027", () => {
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-12"), MONDAY);

    expect(iso(last(grid))).toBe("2027-01-03");
  });

  test("every row is a full week of 7 consecutive days", () => {
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-06"), MONDAY);
    const days = grid.flat();

    expect(grid.every((week) => week.length === 7)).toBe(true);
    expect(days.every((d, i) => i === 0 || daysBetween(days[i - 1]!, d) === 1)).toBe(true);
    expect(grid.every((week) => week[0]?.dayOfWeek === MONDAY)).toBe(true);
  });

  test("a month that starts on the first day of the week begins its grid with the 1st", () => {
    // 1 February 2027 is a Monday and the month has exactly 28 days: 4 weeks.
    const grid = monthGrid(Temporal.PlainYearMonth.from("2027-02"), MONDAY);

    expect(grid).toHaveLength(4);
    expect(iso(first(grid))).toBe("2027-02-01");
    expect(iso(last(grid))).toBe("2027-02-28");
  });

  test("a month can need 6 weeks", () => {
    // 1 August 2026 is a Saturday: Mon 27 Jul to Sun 6 Sep.
    const grid = monthGrid(Temporal.PlainYearMonth.from("2026-08"), MONDAY);

    expect(grid).toHaveLength(6);
    expect(iso(first(grid))).toBe("2026-07-27");
    expect(iso(last(grid))).toBe("2026-09-06");
  });

  test("rejects a first day of the week outside 1..7", () => {
    const month = Temporal.PlainYearMonth.from("2026-06");

    expect(() => monthGrid(month, 0)).toThrow(RangeError);
    expect(() => monthGrid(month, 8)).toThrow(RangeError);
    expect(() => monthGrid(month, 1.5)).toThrow(RangeError);
  });
});

describe("daysBetween", () => {
  test("counts the days from one date to the other", () => {
    expect(daysBetween(date("2026-04-30"), date("2026-06-14"))).toBe(45);
  });

  test("is 0 for the same day", () => {
    expect(daysBetween(date("2026-06-14"), date("2026-06-14"))).toBe(0);
  });

  test("is negative when the second date is earlier", () => {
    expect(daysBetween(date("2026-06-14"), date("2026-04-30"))).toBe(-45);
  });

  test("counts whole days across the spring clock change", () => {
    expect(daysBetween(date("2026-03-28"), date("2026-03-30"))).toBe(2);
  });

  test("counts whole days across years", () => {
    expect(daysBetween(date("2026-12-31"), date("2027-01-01"))).toBe(1);
  });
});
