import { beforeAll, describe, expect, test } from "vitest";

import { ensureTemporal } from "../../lib/temporal";
import { toEventView } from "../events/api";
import { event2Record, eventRecord } from "../events/testFixture";
import { weatherPhase, weatherWindow } from "./window";

beforeAll(async () => {
  await ensureTemporal();
});

const day = (s: string) => Temporal.PlainDate.from(s);
// From 13 to 14 June.
const view = () => toEventView(eventRecord);

describe("weatherWindow", () => {
  test("weatherWindow — de J-7 au dernier jour, et pas avant ni après", () => {
    expect(weatherWindow(view(), day("2026-06-05"))).toBe(false); // J-8
    expect(weatherWindow(view(), day("2026-06-06"))).toBe(true); // J-7
    expect(weatherWindow(view(), day("2026-06-13"))).toBe(true); // the first day
    expect(weatherWindow(view(), day("2026-06-14"))).toBe(true); // the last day
    expect(weatherWindow(view(), day("2026-06-15"))).toBe(false); // the day after the end
  });

  test("weatherWindow — une course d'un seul jour : le jour même est la fin", () => {
    const single = toEventView(event2Record); // 22 June, no end date
    expect(weatherWindow(single, day("2026-06-15"))).toBe(true);
    expect(weatherWindow(single, day("2026-06-22"))).toBe(true);
    expect(weatherWindow(single, day("2026-06-23"))).toBe(false);
  });

  test("weatherWindow — jamais pour une course connue par son mois", () => {
    const month = toEventView({ ...eventRecord, date_precision: "month" });
    expect(weatherWindow(month, day("2026-06-13"))).toBe(false);
  });
});

describe("weatherPhase", () => {
  test("weatherPhase — avant, dedans, après, et sans jour", () => {
    expect(weatherPhase(view(), day("2026-06-05"))).toEqual({
      phase: "not_yet",
      from: day("2026-06-06"),
    });
    expect(weatherPhase(view(), day("2026-06-06"))).toEqual({ phase: "now" });
    expect(weatherPhase(view(), day("2026-06-14"))).toEqual({ phase: "now" });
    expect(weatherPhase(view(), day("2026-06-15"))).toEqual({ phase: "over" });
    const month = toEventView({ ...eventRecord, date_precision: "month" });
    expect(weatherPhase(month, day("2026-06-13"))).toEqual({ phase: "no_day" });
  });

  // The same table as `windowOpenings` in server/weather/routes_test.go: the day the
  // window opens, as the page works it out, is the server's `from`, across both
  // changes of the clocks of Paris.
  test.each([
    ["2026-06-13", "2026-06-06"],
    ["2026-03-29", "2026-03-22"],
    ["2026-04-03", "2026-03-27"],
    ["2026-10-25", "2026-10-18"],
    ["2026-10-28", "2026-10-21"],
    ["2026-11-22", "2026-11-15"],
    ["2027-01-03", "2026-12-27"],
  ])("weatherPhase — la course du %s ouvre la météo le %s, comme le serveur", (start, from) => {
    const race = toEventView({ ...eventRecord, start_date: start, end_date: "" });
    expect(weatherPhase(race, day(from).subtract({ days: 1 }))).toEqual({
      phase: "not_yet",
      from: day(from),
    });
    expect(weatherPhase(race, day(from))).toEqual({ phase: "now" });
  });
});
