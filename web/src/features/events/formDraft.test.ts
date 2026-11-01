import { describe, expect, test } from "vitest";

import { toEventView } from "./api";
import { hasMeasure, initialDraft, joinRowOf, toEventDraft, type FormatRow } from "./formDraft";
import { eventRecord, f42 } from "./testFixture";

const row = (extra: Partial<FormatRow> = {}): FormatRow => ({
  key: "k1",
  name: "",
  raceType: "trail0000000000",
  distanceKm: "",
  elevation: "",
  price: "",
  date: "",
  ...extra,
});

describe("hasMeasure", () => {
  test("a distance, a duration or a time limit is a measure", () => {
    expect(hasMeasure(row({ distanceKm: "42.195" }))).toBe(true);
    expect(hasMeasure(row({ duration: 360 }))).toBe(true);
    expect(hasMeasure(row({ timeLimit: 2880 }))).toBe(true);
  });

  test("nothing, a blank, or zero is none", () => {
    expect(hasMeasure(row())).toBe(false);
    expect(hasMeasure(row({ distanceKm: " ", duration: undefined }))).toBe(false);
    expect(hasMeasure(row({ distanceKm: "0", duration: 0, timeLimit: 0 }))).toBe(false);
  });

  test("the elevation and the date are not measures", () => {
    expect(hasMeasure(row({ elevation: "700", date: "2026-06-14", name: "Marathon" }))).toBe(false);
  });
});

describe("initialDraft", () => {
  test("a new event: nothing filled in, one format to fill in, and I take part", () => {
    const draft = initialDraft(undefined);

    expect(draft).toMatchObject({ name: "", startDate: "", join: true, joinStatus: "interested" });
    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]?.id).toBeUndefined();
    expect(draft.joinRow).toBe(draft.rows[0]?.key);
  });

  test("an event being edited: its values, its formats by their id, and no taking part", () => {
    const draft = initialDraft(toEventView(eventRecord));

    expect(draft).toMatchObject({
      name: "Trail des Crêtes",
      location: "Annecy",
      startDate: "2026-06-13",
      endDate: "2026-06-14",
      registrationUrl: "",
      registrationDeadline: "",
      notes: "",
      join: false,
    });
    // What the API sends as 0 or "" is an empty field.
    expect(draft.rows.map(({ id, key }) => [id, key])).toEqual([
      ["f15", "f15"],
      ["f42", "f42"],
    ]);
    expect(draft.rows[0]).toMatchObject({
      distanceKm: "15",
      duration: undefined,
      timeLimit: undefined,
      elevation: "700",
      price: "",
      date: "",
    });
    expect(draft.rows[1]).toMatchObject({ timeLimit: 600, date: "2026-06-14" });
  });

  test("the deadline and the price of an event being edited are in the fields", () => {
    const draft = initialDraft(
      toEventView({
        ...eventRecord,
        registration_deadline: "2026-06-10",
        expand: { formats_via_event: [{ ...f42, price_eur: 42.5 }] },
      }),
    );

    expect(draft.registrationDeadline).toBe("2026-06-10");
    expect(draft.rows[0]?.price).toBe("42.5");
  });
});

describe("initialDraft, an event with no format", () => {
  test("starts with a format to fill in, since an event has at least one", () => {
    const view = toEventView({ ...eventRecord, expand: { formats_via_event: [] } });

    const draft = initialDraft(view);

    expect(draft.rows).toHaveLength(1);
    expect(draft.rows[0]?.id).toBeUndefined();
    expect(draft.joinRow).toBe(draft.rows[0]?.key);
  });
});

describe("toEventDraft", () => {
  test("trims the texts, and leaves out what is empty", () => {
    const draft = {
      ...initialDraft(undefined),
      name: "  Trail du Lac ",
      location: " Annecy ",
      startDate: "2026-06-13",
      notes: "   ",
      rows: [row({ name: "  ", distanceKm: "42.195", elevation: "", date: "" })],
    };

    expect(toEventDraft(draft, undefined, false)).toEqual({
      id: undefined,
      name: "Trail du Lac",
      location: "Annecy",
      start_date: "2026-06-13",
      end_date: undefined,
      registration_url: undefined,
      registration_deadline: undefined,
      notes: undefined,
      formats: [
        {
          id: undefined,
          name: undefined,
          race_type: "trail0000000000",
          distance_km: 42.195,
          duration_min: undefined,
          time_limit_min: undefined,
          elevation_gain_m: undefined,
          price_eur: undefined,
          date: undefined,
        },
      ],
      join: undefined,
    });
  });

  test("the deadline and the price go as a date and a number", () => {
    const draft = {
      ...initialDraft(undefined),
      registrationDeadline: "2026-06-10",
      rows: [row({ distanceKm: "42", price: "42.50" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.registration_deadline).toBe("2026-06-10");
    expect(saved.formats[0]?.price_eur).toBe(42.5);
  });

  test("joins the format that was chosen, by its place in the list", () => {
    const draft = {
      ...initialDraft(undefined),
      rows: [row({ key: "a" }), row({ key: "b" })],
      joinRow: "b",
      joinStatus: "registered" as const,
    };

    expect(toEventDraft(draft, undefined, true).join).toEqual({
      formatIndex: 1,
      status: "registered",
    });
  });

  test("joins the first format when the chosen one is gone", () => {
    const draft = {
      ...initialDraft(undefined),
      rows: [row({ key: "a" })],
      joinRow: "removed",
    };

    expect(joinRowOf(draft)?.key).toBe("a");
    expect(toEventDraft(draft, undefined, true).join?.formatIndex).toBe(0);
  });

  test("does not join when it is not asked", () => {
    expect(toEventDraft(initialDraft(undefined), undefined, false).join).toBeUndefined();
  });

  test("an event being edited keeps its id, and so do its formats", () => {
    const existing = toEventView(eventRecord);

    const draft = toEventDraft(initialDraft(existing), existing, false);

    expect(draft.id).toBe("event");
    expect(draft.formats.map((format) => format.id)).toEqual(["f15", "f42"]);
  });
});
