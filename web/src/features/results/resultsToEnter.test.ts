import { describe, expect, test } from "vitest";

import type { ParticipationRecord } from "../../lib/types";
import { eventRecord, f42, p1, trailType } from "../events/testFixture";
import {
  RESULTS_WINDOW_DAYS,
  isResultToEnter,
  toEnterOf,
  toEnterRow,
  type RegisteredRecord,
  type ToEnter,
} from "./resultsToEnter";

const date = (s: string) => Temporal.PlainDate.from(s);
const TODAY = "2026-04-30";

const registered: ParticipationRecord = { ...p1, status: "registered" };

/** A registered participation of the trail (or of the event with this name) on this day. */
function rowOf(id: string, day: string, eventName = "Trail des Crêtes"): ToEnter {
  return {
    participation: { ...registered, id },
    event: { ...eventRecord, name: eventName },
    format: f42,
    raceType: trailType,
    date: date(day),
    lastDay: date(day),
  };
}

const ids = (rows: ToEnter[], today = TODAY) =>
  toEnterOf(rows, date(today)).map(({ participation }) => participation.id);

describe("toEnterOf", () => {
  test("toEnterOf — seulement les épreuves passées depuis 60 jours au plus", () => {
    expect(RESULTS_WINDOW_DAYS).toBe(60);
    const rows = [
      // To come, and today: the race is not over yet.
      rowOf("tomorrow", "2026-05-01"),
      rowOf("today", "2026-04-30"),
      // Yesterday: over.
      rowOf("yesterday", "2026-04-29"),
      // Exactly 60 days ago (1 March) is still there; 61 days ago is not.
      rowOf("60-days", "2026-03-01"),
      rowOf("61-days", "2026-02-28"),
      rowOf("last-year", "2025-04-30"),
    ];

    expect(ids(rows)).toEqual(["yesterday", "60-days"]);
    // The window moves with the day.
    expect(ids(rows, "2026-05-01")).toEqual(["today", "yesterday"]);
    expect(ids(rows, "2026-04-29")).toEqual(["60-days", "61-days"]);
    // Nothing at all.
    expect(ids([])).toEqual([]);
  });

  test("toEnterOf — la plus récente d'abord", () => {
    const rows = [
      rowOf("old", "2026-03-15", "Marathon d'hiver"),
      rowOf("recent", "2026-04-26", "Trail des Crêtes"),
      // The same day: the name of the event, then the participation.
      rowOf("b-2", "2026-04-12", "Trail du Printemps"),
      rowOf("a", "2026-04-12", "10 km de Lyon"),
      rowOf("b-1", "2026-04-12", "Trail du Printemps"),
    ];

    expect(ids(rows)).toEqual(["recent", "a", "b-1", "b-2", "old"]);
    // The list it was given is not reordered.
    expect(rows.map(({ participation }) => participation.id)).toEqual([
      "old",
      "recent",
      "b-2",
      "a",
      "b-1",
    ]);
  });
});

const record = (event: object): RegisteredRecord => ({
  ...registered,
  expand: {
    event: { ...eventRecord, ...event },
    format: { ...f42, expand: { race_type: trailType } },
  },
});

describe("toEnterRow", () => {
  test("toEnterRow — le jour d'une épreuve est le sien", () => {
    expect(toEnterRow(record({})).date.toString()).toBe("2026-06-14");
  });

  test("resultsToEnter — une course au mois à partir de la fin du mois", () => {
    const june = {
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
    };
    const row = toEnterRow({
      ...record(june),
      expand: {
        ...record(june).expand,
        format: { ...f42, date: "", expand: { race_type: trailType } },
      },
    });

    // The race is over the day after the last day of its month, not the day after its 1st.
    expect(row.lastDay.toString()).toBe("2027-06-30");
    expect(row.date.toString()).toBe("2027-06-01");
    expect(toEnterOf([row], date("2027-06-15"))).toEqual([]);
    expect(toEnterOf([row], date("2027-06-30"))).toEqual([]);
    expect(toEnterOf([row], date("2027-07-01"))).toEqual([row]);
    // The window of 60 days counts from the end of the month: 29 August is the 60th day.
    expect(toEnterOf([row], date("2027-08-29"))).toEqual([row]);
    expect(toEnterOf([row], date("2027-08-30"))).toEqual([]);
  });
});

const isToEnter = (status: ParticipationRecord["status"], day: string, today = TODAY) =>
  isResultToEnter(status, date(day), date(today));

describe("isResultToEnter", () => {
  test("isResultToEnter — inscrit, la course est finie depuis 1 à 60 jours", () => {
    // To come, and today: the race is not over yet.
    expect(isToEnter("registered", "2026-05-01")).toBe(false);
    expect(isToEnter("registered", "2026-04-30")).toBe(false);
    // Yesterday, and exactly 60 days ago: over, and still asked for.
    expect(isToEnter("registered", "2026-04-29")).toBe(true);
    expect(isToEnter("registered", "2026-03-01")).toBe(true);
    // 61 days ago: left alone.
    expect(isToEnter("registered", "2026-02-28")).toBe(false);
  });

  test("isResultToEnter — une autre participation n'est pas à saisir, même passée depuis 3 jours", () => {
    for (const status of ["interested", "supporter", "finished", "dnf", "dns"] as const) {
      expect(isToEnter(status, "2026-04-27")).toBe(false);
    }
  });

  test("isResultToEnter — toEnterOf garde exactement ce qu'il dit", () => {
    // The block and the predicate cannot drift apart: the block is the predicate.
    const days = ["2026-05-01", "2026-04-30", "2026-04-29", "2026-03-01", "2026-02-28"];
    const rows = days.map((day) => rowOf(day, day));
    expect(ids(rows)).toEqual(
      days.filter((day) => isToEnter("registered", day)).toSorted((a, b) => b.localeCompare(a)),
    );
  });
});
