import { describe, expect, test } from "vitest";

import { monthGrid } from "../../lib/dates";
import { sortEvents, toEventViews, type EventView } from "../events/api";
import { event2Record, eventRecord } from "../events/testFixture";
import { eventsByDay } from "./eventsByDay";

const MONDAY = 1;
const SUNDAY = 7;

const date = (s: string) => Temporal.PlainDate.from(s);
const month = (s: string) => Temporal.PlainYearMonth.from(s);
const names = (list: EventView[] | undefined) => list?.map((view) => view.event.name);

/** June 2026 with weeks that start on Monday: 1 June to 5 July (the last week is 29 June to 5 July). */
const june = () => monthGrid(month("2026-06"), MONDAY).flat();

/** An event of the fixture, with an id, a name and dates of its own. */
const eventOn = (id: string, name: string, start: string, end = "") => ({
  ...event2Record,
  id,
  name,
  start_date: start,
  end_date: end,
});

// 30 June to 1 July: across a month boundary.
const monthEnd = {
  ...eventRecord,
  id: "end",
  name: "Trail de fin de mois",
  start_date: "2026-06-30",
  end_date: "2026-07-01",
};

describe("eventsByDay", () => {
  test("an event of two days across a month boundary is on both days of the grid", () => {
    const days = june();
    expect(days.at(-7)?.toString()).toBe("2026-06-29");
    expect(days.at(-1)?.toString()).toBe("2026-07-05");

    const byDay = eventsByDay(toEventViews([monthEnd]), days);

    expect(names(byDay.get("2026-06-29"))).toEqual([]);
    expect(names(byDay.get("2026-06-30"))).toEqual(["Trail de fin de mois"]);
    expect(names(byDay.get("2026-07-01"))).toEqual(["Trail de fin de mois"]);
    expect(names(byDay.get("2026-07-02"))).toEqual([]);
  });

  test("the key of a day is its ISO date, and every day of the grid has one", () => {
    const days = june();

    const byDay = eventsByDay([], days);

    expect([...byDay.keys()]).toEqual(days.map((day) => day.toString()));
    expect(byDay.get("2026-06-15")).toEqual([]);
  });

  test("an event of one day is on that day only", () => {
    const byDay = eventsByDay(toEventViews([event2Record]), june());

    expect(names(byDay.get("2026-06-22"))).toEqual(["10 km de Lyon"]);
    const withEvents = [...byDay].filter(([, list]) => list.length > 0).map(([key]) => key);
    expect(withEvents).toEqual(["2026-06-22"]);
  });

  test("an event is on each day of its range, the first and the last included", () => {
    const byDay = eventsByDay(toEventViews([eventRecord]), june());

    expect(names(byDay.get("2026-06-12"))).toEqual([]);
    expect(names(byDay.get("2026-06-13"))).toEqual(["Trail des Crêtes"]);
    expect(names(byDay.get("2026-06-14"))).toEqual(["Trail des Crêtes"]);
    expect(names(byDay.get("2026-06-15"))).toEqual([]);
  });

  test("an event that starts before the grid shows on the days of the grid it covers", () => {
    const early = { ...eventRecord, start_date: "2026-05-28", end_date: "2026-06-02" };

    const byDay = eventsByDay(toEventViews([early]), june());

    expect(byDay.has("2026-05-28")).toBe(false);
    expect(names(byDay.get("2026-06-01"))).toEqual(["Trail des Crêtes"]);
    expect(names(byDay.get("2026-06-02"))).toEqual(["Trail des Crêtes"]);
    expect(names(byDay.get("2026-06-03"))).toEqual([]);
  });

  test("an event that goes on after the grid does not add days to it", () => {
    const long = { ...eventRecord, start_date: "2026-07-04", end_date: "2026-07-20" };

    const byDay = eventsByDay(toEventViews([long]), june());

    expect(names(byDay.get("2026-07-05"))).toEqual(["Trail des Crêtes"]);
    expect(byDay.has("2026-07-06")).toBe(false);
    expect(byDay.size).toBe(june().length);
  });

  test("an event outside the grid is nowhere", () => {
    const august = { ...eventRecord, start_date: "2026-08-01", end_date: "" };

    const byDay = eventsByDay(toEventViews([august]), june());

    expect([...byDay.values()].flat()).toEqual([]);
  });

  test("a year change: the grid of December has days of January, with an event across New Year", () => {
    const days = monthGrid(month("2026-12"), MONDAY).flat();
    const newYear = {
      ...eventRecord,
      name: "Corrida",
      start_date: "2026-12-31",
      end_date: "2027-01-02",
    };

    const byDay = eventsByDay(toEventViews([newYear]), days);

    expect(days.at(-1)?.toString()).toBe("2027-01-03");
    expect(names(byDay.get("2026-12-30"))).toEqual([]);
    expect(names(byDay.get("2026-12-31"))).toEqual(["Corrida"]);
    expect(names(byDay.get("2027-01-01"))).toEqual(["Corrida"]);
    expect(names(byDay.get("2027-01-02"))).toEqual(["Corrida"]);
    expect(names(byDay.get("2027-01-03"))).toEqual([]);
  });

  test("a grid that starts on a Sunday works the same", () => {
    const days = monthGrid(month("2026-06"), SUNDAY).flat();

    const byDay = eventsByDay(toEventViews([monthEnd]), days);

    expect(days[0]?.toString()).toBe("2026-05-31");
    expect(days.at(-1)?.toString()).toBe("2026-07-04");
    expect(names(byDay.get("2026-07-01"))).toEqual(["Trail de fin de mois"]);
  });

  test("the events of a day keep the order they were given in", () => {
    const views = toEventViews([
      eventOn("b", "Bravo", "2026-06-22"),
      eventOn("a", "Alpha", "2026-06-22"),
      eventOn("c", "Charlie", "2026-06-22"),
    ]);

    const byDay = eventsByDay(views, june());

    expect(names(byDay.get("2026-06-22"))).toEqual(["Bravo", "Alpha", "Charlie"]);
  });

  test("sorted events give a day in order of start, then of name", () => {
    // Starts on the 20th, then on the 22nd (two of them, Zulu before Alpha as given).
    const views = toEventViews([
      eventOn("z", "Zulu", "2026-06-22", "2026-06-23"),
      eventOn("a", "Alpha", "2026-06-22", "2026-06-23"),
      eventOn("e", "Echo", "2026-06-20", "2026-06-23"),
    ]);

    const byDay = eventsByDay(sortEvents(views, "asc"), june());

    expect(names(byDay.get("2026-06-22"))).toEqual(["Echo", "Alpha", "Zulu"]);
    expect(names(byDay.get("2026-06-23"))).toEqual(["Echo", "Alpha", "Zulu"]);
    expect(names(byDay.get("2026-06-20"))).toEqual(["Echo"]);
  });

  test("the same date given twice is one key, and the event is not listed twice", () => {
    const byDay = eventsByDay(toEventViews([event2Record]), [
      date("2026-06-22"),
      date("2026-06-22"),
    ]);

    expect(byDay.size).toBe(1);
    expect(names(byDay.get("2026-06-22"))).toEqual(["10 km de Lyon"]);
  });
});
