import { beforeAll, describe, expect, test } from "vitest";

import { ensureTemporal } from "../../lib/temporal";
import { toEventView } from "../events/api";
import { event2Record, eventRecord } from "../events/testFixture";
import { weatherWindow } from "./window";

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
