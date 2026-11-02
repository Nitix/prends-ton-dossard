import { describe, expect, test } from "vitest";

import { toEventView } from "./api";
import {
  filledMeasures,
  hasMeasure,
  initialDraft,
  joinRowOf,
  joinStarted,
  toEventDraft,
  type FormatRow,
  type FormDraft,
} from "./formDraft";
import { eventRecord, f15, f42 } from "./testFixture";

const row = (extra: Partial<FormatRow> = {}): FormatRow => ({
  key: "k1",
  name: "",
  raceType: "trail0000000000",
  distanceKm: "",
  elevation: "",
  price: "",
  routeUrl: "",
  hasTrack: false,
  gpx: { kind: "keep" },
  date: "",
  ...extra,
});

describe("filledMeasures", () => {
  test("filledMeasures — une mesure a une valeur quand son champ n'est pas vide ; zéro minute n'en est pas une", () => {
    expect([...filledMeasures(row())]).toEqual([]);
    expect([...filledMeasures(row({ distanceKm: "0" }))]).toEqual(["distance"]);
    expect([...filledMeasures(row({ distanceKm: "  ", elevation: " " }))]).toEqual([]);
    expect([
      ...filledMeasures(row({ distanceKm: "42", elevation: "300", duration: 90, timeLimit: 600 })),
    ]).toEqual(["distance", "elevation", "duration", "time_limit"]);
    expect([...filledMeasures(row({ duration: 0, timeLimit: 0 }))]).toEqual([]);
  });
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

  test("the link of the course and whether the format has a track are in the fields; the track itself is kept as it is", () => {
    const draft = initialDraft(
      toEventView({
        ...eventRecord,
        expand: {
          formats_via_event: [
            { ...f42, route_url: "https://example.test/parcours", gpx: "trace_ab12cd.gpx" },
            f15,
          ],
        },
      }),
    );

    // F15 is the first format, F42 the second.
    expect(draft.rows[0]).toMatchObject({ routeUrl: "", hasTrack: false, gpx: { kind: "keep" } });
    expect(draft.rows[1]).toMatchObject({
      routeUrl: "https://example.test/parcours",
      hasTrack: true,
      gpx: { kind: "keep" },
    });
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
          route_url: undefined,
          gpx: { kind: "keep" },
          label: undefined,
          date: undefined,
        },
      ],
      join: undefined,
    });
  });

  test("the link of the course is trimmed, and the track to send or take off goes along", () => {
    const file = new File(["<gpx/>"], "trace.gpx");
    const draft = {
      ...initialDraft(undefined),
      rows: [
        row({
          distanceKm: "42",
          routeUrl: " https://example.test/parcours ",
          gpx: { kind: "new", file },
        }),
        row({ distanceKm: "10", routeUrl: "  ", gpx: { kind: "remove" } }),
      ],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.formats[0]).toMatchObject({
      route_url: "https://example.test/parcours",
      gpx: { kind: "new", file },
    });
    expect(saved.formats[1]).toMatchObject({ route_url: undefined, gpx: { kind: "remove" } });
  });

  test("the name that tells a format apart in a message comes from the caller, by the place of the row", () => {
    const draft = {
      ...initialDraft(undefined),
      rows: [row({ distanceKm: "42" }), row({ distanceKm: "10" })],
    };

    const saved = toEventDraft(draft, undefined, false, (_row, index) => `Épreuve ${index + 1}`);

    expect(saved.formats.map((format) => format.label)).toEqual(["Épreuve 1", "Épreuve 2"]);
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

// A new event that starts on 13 June, with the format typed so far.
const typed = (extra: Partial<FormDraft> = {}): FormDraft => ({
  ...initialDraft(undefined),
  startDate: "2026-06-13",
  ...extra,
});
const day = (s: string) => Temporal.PlainDate.from(s);

describe("joinStarted", () => {
  test("is false before the first day of the event, true on it and after", () => {
    expect(joinStarted(typed(), day("2026-06-12"))).toBe(false);
    expect(joinStarted(typed(), day("2026-06-13"))).toBe(true);
    expect(joinStarted(typed(), day("2026-06-14"))).toBe(true);
  });

  test("the day of the format to join beats the first day of the event", () => {
    const first = row({ key: "a", date: "2026-06-14" });
    const second = row({ key: "b" });
    const draft = typed({ rows: [first, second], joinRow: "a" });

    expect(joinStarted(draft, day("2026-06-13"))).toBe(false);
    expect(joinStarted(draft, day("2026-06-14"))).toBe(true);
    // The other format has no day of its own.
    expect(joinStarted({ ...draft, joinRow: "b" }, day("2026-06-13"))).toBe(true);
  });

  test("is false while the day is not typed (or not a day): nobody finishes a race with no day", () => {
    expect(joinStarted(typed({ startDate: "" }), day("2026-06-13"))).toBe(false);
    expect(joinStarted(typed({ startDate: "2026-06-3" }), day("2026-06-13"))).toBe(false);
  });
});
