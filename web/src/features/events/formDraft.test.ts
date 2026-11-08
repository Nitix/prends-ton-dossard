import { describe, expect, test } from "vitest";

import { toEventView } from "./api";
import {
  eventEndDate,
  filledMeasures,
  formerPeriod,
  hasMeasure,
  initialDraft,
  isLongEvent,
  isSettled,
  joinRowOf,
  joinStarted,
  shortens,
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
  startTime: "",
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

describe("eventEndDate", () => {
  test("eventEndDate — sans épreuve datée, l'événement tient sur un jour", () => {
    expect(eventEndDate("2026-06-13", [])).toBe("");
    expect(eventEndDate("2026-06-13", [""])).toBe("");
    expect(eventEndDate("2026-06-13", ["", ""])).toBe("");
  });

  test("eventEndDate — une épreuve plus tard que le début donne la fin", () => {
    expect(eventEndDate("2026-06-13", ["2026-06-14"])).toBe("2026-06-14");
    // Across a year, days sort as days.
    expect(eventEndDate("2026-12-30", ["2027-01-02"])).toBe("2027-01-02");
  });

  test("eventEndDate — plusieurs épreuves : la plus tardive, quel que soit l'ordre", () => {
    expect(eventEndDate("2026-06-13", ["2026-06-14", "2026-06-16", "2026-06-15"])).toBe(
      "2026-06-16",
    );
    expect(eventEndDate("2026-06-13", ["2026-06-16", "2026-06-14"])).toBe("2026-06-16");
  });

  test("eventEndDate — une épreuve sans date compte pour le premier jour : elle ne change pas la fin", () => {
    expect(eventEndDate("2026-06-13", ["", "2026-06-15"])).toBe("2026-06-15");
    expect(eventEndDate("2026-06-13", ["2026-06-15", ""])).toBe("2026-06-15");
    expect(eventEndDate("2026-06-13", [""])).toBe("");
  });

  test("eventEndDate — une épreuve le premier jour, ou avant, ne fait pas de fin", () => {
    expect(eventEndDate("2026-06-13", ["2026-06-13"])).toBe("");
    expect(eventEndDate("2026-06-13", ["2026-06-13", "2026-06-13"])).toBe("");
    // Before the start: the server refuses that format, the end is not for it to move.
    expect(eventEndDate("2026-06-13", ["2026-06-12"])).toBe("");
    expect(eventEndDate("2026-06-13", ["2026-06-12", "2026-06-14"])).toBe("2026-06-14");
  });

  test("eventEndDate — un texte qui n'est pas un jour est laissé de côté, et sans début il n'y a pas de fin", () => {
    expect(eventEndDate("2026-06-13", ["2026-06-1", "2026-02-31", "demain"])).toBe("");
    expect(eventEndDate("2026-06-13", ["2026-06-1", "2026-06-15"])).toBe("2026-06-15");
    expect(eventEndDate("", ["2026-06-15"])).toBe("");
    expect(eventEndDate("2026-06-1", ["2026-06-15"])).toBe("");
  });

  test("eventEndDate — une course au mois finit le dernier jour du mois", () => {
    expect(eventEndDate("2027-06-01", [], true)).toBe("2027-06-30");
    expect(eventEndDate("2027-12-01", [], true)).toBe("2027-12-31");
    expect(eventEndDate("2028-02-01", [], true)).toBe("2028-02-29");
    expect(eventEndDate("2027-02-01", [], true)).toBe("2027-02-28");
    // The days of its formats do not give it its end.
    expect(eventEndDate("2027-06-01", ["2027-06-12", "2027-07-02"], true)).toBe("2027-06-30");
    // Without a start there is no month.
    expect(eventEndDate("", [], true)).toBe("");
    expect(eventEndDate("2027-06", [], true)).toBe("");
  });
});

describe("isLongEvent", () => {
  test("isLongEvent — plus de quatorze jours entre le début et la fin", () => {
    expect(isLongEvent("2026-06-13", "2026-06-27")).toBe(false);
    expect(isLongEvent("2026-06-13", "2026-06-28")).toBe(true);
    // A year typed wrong.
    expect(isLongEvent("2026-06-13", "2027-06-15")).toBe(true);
    expect(isLongEvent("2026-12-25", "2027-01-08")).toBe(false);
    expect(isLongEvent("2026-12-25", "2027-01-09")).toBe(true);
  });

  test("isLongEvent — un jour, ou pas de jour, n'est pas long", () => {
    expect(isLongEvent("2026-06-13", "")).toBe(false);
    expect(isLongEvent("", "2027-06-15")).toBe(false);
    expect(isLongEvent("2026-06-1", "2027-06-15")).toBe(false);
  });
});

describe("isSettled", () => {
  test("isSettled — un champ vide, ou un jour dont l'année a quatre chiffres et 1900 ou plus", () => {
    expect(isSettled("")).toBe(true);
    expect(isSettled("2026-06-13")).toBe(true);
    expect(isSettled("1900-01-01")).toBe(true);
    expect(isSettled("9999-12-31")).toBe(true);
  });

  test("isSettled — les débuts d'année que Chromium donne pendant la frappe ne le sont pas", () => {
    expect(isSettled("0002-06-13")).toBe(false);
    expect(isSettled("0020-06-13")).toBe(false);
    expect(isSettled("0202-06-13")).toBe(false);
    expect(isSettled("1899-12-31")).toBe(false);
    // More than four digits, or not a day.
    expect(isSettled("20261-06-13")).toBe(false);
    expect(isSettled("2026-06")).toBe(false);
    expect(isSettled("demain")).toBe(false);
  });
});

describe("formerPeriod", () => {
  const stored = { start_date: "2026-06-13", end_date: "2026-06-14" };

  test("formerPeriod — la fin stockée, quand l'enregistrement en donnerait une autre", () => {
    expect(formerPeriod(stored, "")).toEqual({ start: "2026-06-13", end: "2026-06-14" });
    expect(formerPeriod(stored, "2026-06-16")).toEqual({ start: "2026-06-13", end: "2026-06-14" });
    expect(formerPeriod(stored, "2026-06-13")).toEqual({ start: "2026-06-13", end: "2026-06-14" });
  });

  test("formerPeriod — rien à dire sans événement, sans fin stockée, ou avec la même fin", () => {
    expect(formerPeriod(undefined, "2026-06-16")).toBeUndefined();
    expect(formerPeriod({ ...stored, end_date: "" }, "2026-06-16")).toBeUndefined();
    expect(formerPeriod(stored, "2026-06-14")).toBeUndefined();
  });

  test("formerPeriod — une fin stockée égale au début (v4) est un jour : rien n'est perdu", () => {
    expect(formerPeriod({ start_date: "2026-06-13", end_date: "2026-06-13" }, "")).toBeUndefined();
    expect(
      formerPeriod({ start_date: "2026-06-13", end_date: "2026-06-13" }, "2026-06-15"),
    ).toBeUndefined();
  });
});

describe("shortens", () => {
  const former = { start: "2026-06-13", end: "2026-06-14" };

  test("shortens — plus de fin, ou une fin plus tôt, raccourcit", () => {
    expect(shortens(former, "")).toBe(true);
    expect(shortens({ ...former, end: "2026-06-18" }, "2026-06-15")).toBe(true);
  });

  test("shortens — une fin plus tard, ou rien d'ancien, ne raccourcit pas", () => {
    expect(shortens(former, "2026-06-16")).toBe(false);
    expect(shortens(undefined, "")).toBe(false);
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

  test("initialDraft — une course au mois : le mois est repris, la case est cochée", () => {
    const draft = initialDraft(
      toEventView({
        ...eventRecord,
        start_date: "2027-06-01",
        end_date: "2027-06-30",
        date_precision: "month",
        expand: { formats_via_event: [{ ...f15 }] },
      }),
    );

    expect(draft).toMatchObject({
      monthOnly: true,
      startMonth: "2027-06",
      startDate: "2027-06-01",
    });
  });

  test("initialDraft — une course datée : la case n'est pas cochée, son mois est proposé", () => {
    expect(initialDraft(toEventView(eventRecord))).toMatchObject({
      monthOnly: false,
      startMonth: "2026-06",
    });
    expect(initialDraft(undefined)).toMatchObject({ monthOnly: false, startMonth: "" });
  });

  test("an event being edited: its values, its formats by their id, and no taking part", () => {
    const draft = initialDraft(toEventView(eventRecord));

    expect(draft).toMatchObject({
      name: "Trail des Crêtes",
      location: "Annecy",
      startDate: "2026-06-13",
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
    // The end date is not a field: it comes from the dates of the formats.
    expect(draft).not.toHaveProperty("endDate");
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

  test("initialDraft — l'ouverture et son heure d'une course modifiée", () => {
    const draft = initialDraft(
      toEventView({
        ...eventRecord,
        registration_opening: "2026-05-01",
        registration_opening_time: "10:00",
      }),
    );

    expect(draft).toMatchObject({
      registrationOpening: "2026-05-01",
      registrationOpeningTime: "10:00",
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
      end_date: "",
      registration_url: undefined,
      registration_deadline: undefined,
      registration_opening: undefined,
      registration_opening_time: undefined,
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

  test("toEventDraft — l'ouverture et son heure", () => {
    const draft = {
      ...initialDraft(undefined),
      registrationOpening: "2026-05-01",
      registrationOpeningTime: "10:00",
      rows: [row({ distanceKm: "42" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.registration_opening).toBe("2026-05-01");
    expect(saved.registration_opening_time).toBe("10:00");
  });

  test("toEventDraft — une course au mois", () => {
    const draft = {
      ...initialDraft(undefined),
      name: "Trail de juin",
      monthOnly: true,
      startMonth: "2027-06",
      // What was typed before the box was checked is kept in the draft, and not sent.
      startDate: "2027-05-20",
      rows: [row({ distanceKm: "42", date: "2027-06-12" }), row({ key: "k2", distanceKm: "10" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved).toMatchObject({
      start_date: "2027-06-01",
      end_date: "2027-06-30",
      date_precision: "month",
    });
    expect(saved.formats.map(({ date }) => date)).toEqual([undefined, undefined]);
  });

  test("toEventDraft — décocher rend la date et les dates des épreuves", () => {
    const draft = {
      ...initialDraft(undefined),
      monthOnly: false,
      startMonth: "2027-06",
      startDate: "2027-06-12",
      rows: [row({ distanceKm: "42", date: "2027-06-13" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved).toMatchObject({ start_date: "2027-06-12", end_date: "2027-06-13" });
    expect(saved.date_precision).toBeUndefined();
    expect(saved.formats[0]?.date).toBe("2027-06-13");
  });

  test("toEventDraft — un mois qui n'est pas choisi n'a pas de début", () => {
    const draft = { ...initialDraft(undefined), monthOnly: true, startMonth: "" };

    expect(toEventDraft(draft, undefined, false)).toMatchObject({ start_date: "", end_date: "" });
  });

  test("toEventDraft — une heure sans jour n'est pas envoyée", () => {
    const draft = {
      ...initialDraft(undefined),
      registrationOpening: "",
      registrationOpeningTime: "10:00",
      rows: [row({ distanceKm: "42" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.registration_opening).toBeUndefined();
    expect(saved.registration_opening_time).toBeUndefined();
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

  test("la date de fin est la plus tardive des épreuves, et vide quand aucune n'est après le début", () => {
    const base = { ...initialDraft(undefined), startDate: "2026-06-13" };
    const later = {
      ...base,
      rows: [row({ key: "a", date: "2026-06-14" }), row({ key: "b", date: "2026-06-16" })],
    };
    expect(toEventDraft(later, undefined, false).end_date).toBe("2026-06-16");

    const undated = { ...base, rows: [row({ key: "a" }), row({ key: "b", date: "2026-06-13" })] };
    // Sent as an empty text, which is how an event that lasted longer becomes a one-day event.
    expect(toEventDraft(undated, undefined, false).end_date).toBe("");
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

  test("une course au mois commence le 1er du mois, quelles que soient ses épreuves", () => {
    const draft = typed({
      monthOnly: true,
      startMonth: "2027-06",
      startDate: "",
      rows: [row({ key: "a", date: "2027-06-20" })],
      joinRow: "a",
    });

    expect(joinStarted(draft, day("2027-05-31"))).toBe(false);
    expect(joinStarted(draft, day("2027-06-01"))).toBe(true);
    expect(joinStarted({ ...draft, startMonth: "" }, day("2027-06-01"))).toBe(false);
  });

  test("is false while the day is not typed (or not a day): nobody finishes a race with no day", () => {
    expect(joinStarted(typed({ startDate: "" }), day("2026-06-13"))).toBe(false);
    expect(joinStarted(typed({ startDate: "2026-06-3" }), day("2026-06-13"))).toBe(false);
  });
});

describe("l'heure de départ", () => {
  test("initialDraft — l'heure de l'épreuve enregistrée est dans le champ, vide sans heure", () => {
    const draft = initialDraft(
      toEventView({
        ...eventRecord,
        expand: { formats_via_event: [{ ...f42, start_time: "07:30" }, f15] },
      }),
    );

    expect(draft.rows.map((r) => r.startTime)).toEqual(["", "07:30"]);
    expect(initialDraft(undefined).rows[0]?.startTime).toBe("");
  });

  test("toEventDraft — l'heure part avec l'épreuve, vide n'est pas envoyée", () => {
    const draft = {
      ...initialDraft(undefined),
      startDate: "2027-06-12",
      rows: [row({ distanceKm: "42", startTime: "07:30" }), row({ distanceKm: "15" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.formats.map(({ start_time }) => start_time)).toEqual(["07:30", undefined]);
  });

  test("toEventDraft — une course au mois n'a pas d'heure, et le brouillon garde ce qui est saisi", () => {
    const draft = {
      ...initialDraft(undefined),
      monthOnly: true,
      startMonth: "2027-06",
      rows: [row({ distanceKm: "42", startTime: "07:30" })],
    };

    const saved = toEventDraft(draft, undefined, false);

    expect(saved.formats[0]?.start_time).toBeUndefined();
    expect(draft.rows[0]?.startTime).toBe("07:30");
  });
});
