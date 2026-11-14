import { describe, expect, test } from "vitest";

import { fr } from "../../i18n/fr";
import { createFormatters } from "../../lib/format";
import { toEventView, type EventView } from "./api";
import {
  calendarOpenings,
  formatNames,
  formatOpening,
  generalOpening,
  openingOf,
  personOpenings,
  shownOpening,
  type Opening,
} from "./opening";

// The cases of `server/events/openings_test.go`, with those of the site.

const day = (s: string) => Temporal.PlainDate.from(s);
const op = (d: string, time: string, ...formatIds: string[]): Opening => ({
  day: day(d),
  time,
  formatIds,
});
const plain = (s: string) => s.replaceAll(/\s/g, " ");
const f = (fields: { registration_opening?: string; registration_opening_time?: string }) => ({
  id: "f",
  ...fields,
});

describe("formatOpening", () => {
  const event = { registration_opening: "2026-11-16", registration_opening_time: "12:00" };
  const noTime = { registration_opening: "2026-11-16" };

  test.each([
    [
      "day alone takes the event time",
      event,
      f({ registration_opening: "2026-11-17" }),
      op("2026-11-17", "12:00", "f"),
    ],
    [
      "time alone takes the event day",
      event,
      f({ registration_opening_time: "10:00" }),
      op("2026-11-16", "10:00", "f"),
    ],
    [
      "both are its own",
      event,
      f({ registration_opening: "2026-11-17", registration_opening_time: "10:00" }),
      op("2026-11-17", "10:00", "f"),
    ],
    ["none", event, f({}), null],
    [
      "none, empty texts",
      event,
      f({ registration_opening: "", registration_opening_time: "" }),
      null,
    ],
    ["day alone without an event opening", {}, f({ registration_opening: "2026-11-17" }), null],
    ["time alone without an event day", {}, f({ registration_opening_time: "10:00" }), null],
    ["equal to the event", event, f({ registration_opening: "2026-11-16" }), null],
    [
      "day alone, event without a time",
      noTime,
      f({ registration_opening: "2026-11-17" }),
      op("2026-11-17", "", "f"),
    ],
    [
      "day alone on the event day, event without a time",
      noTime,
      f({ registration_opening: "2026-11-16" }),
      null,
    ],
    [
      "9:00 is the time of an opening without a time",
      noTime,
      f({ registration_opening: "2026-11-16", registration_opening_time: "09:00" }),
      null,
    ],
  ])("formatOpening — %s", (_name, ev, format, want) => {
    expect(formatOpening(ev, format)).toEqual(want);
  });
});

// Annecy, as the server sends it (see `testFixture.ts`): no opening of its own,
// the marathon has none, the other formats open one day after the other.
const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const routeType = { ...base, id: "route", label: "Route" };
const trailType = { ...base, id: "trail", label: "Trail" };
const runner = (id: string) => ({ ...base, id, name: id, user: "" });

const rawFormat = (id: string, fields: Record<string, unknown>) => ({
  ...base,
  id,
  event: "e",
  name: "",
  race_type: routeType.id,
  expand: { race_type: routeType },
  ...fields,
});

const ANNECY_FORMATS = [
  rawFormat("marathon", {
    name: "Marathon",
    race_type: trailType.id,
    distance_km: 42.195,
    expand: { race_type: trailType },
  }),
  rawFormat("5km", {
    distance_km: 5,
    registration_opening: "2026-11-19",
    registration_opening_time: "12:00",
  }),
  rawFormat("semi", {
    name: "Semi",
    distance_km: 21.1,
    registration_opening: "2026-11-17",
    registration_opening_time: "12:00",
  }),
  rawFormat("10km", {
    distance_km: 10,
    registration_opening: "2026-11-18",
    registration_opening_time: "12:00",
  }),
];

/** [runner, status, format id ("" for the event alone)]. */
type Who = [string, string, string];

function annecy(
  eventFields: Record<string, unknown> = {},
  people: Who[] = [],
  formats: Record<string, unknown>[] = ANNECY_FORMATS,
): EventView {
  return toEventView({
    ...base,
    id: "e",
    name: "Annecy",
    start_date: "2026-12-06",
    end_date: "",
    registration_opening: "",
    registration_opening_time: "",
    ...eventFields,
    expand: {
      formats_via_event: formats,
      participations_via_event: people.map(([who, status, formatId], i) => ({
        ...base,
        id: `p${i}`,
        runner: who,
        event: "e",
        format: formatId,
        status,
        confirmed: true,
        added_by: who,
        expand: { runner: runner(who), added_by: runner(who) },
      })),
    },
  });
}

const EVENT_OPENS = { registration_opening: "2026-11-16", registration_opening_time: "12:00" };

describe("generalOpening", () => {
  const view = annecy();
  test.each([
    ["before all", "2026-11-15", op("2026-11-17", "12:00", "semi")],
    ["today is not past", "2026-11-17", op("2026-11-17", "12:00", "semi")],
    ["semi past", "2026-11-18", op("2026-11-18", "12:00", "10km")],
    ["all past: the last", "2026-11-20", op("2026-11-19", "12:00", "5km")],
  ])("generalOpening — %s", (_name, today, want) => {
    expect(generalOpening(view, day(today))).toEqual(want);
  });

  test("generalOpening — the event's, whatever the day", () => {
    expect(generalOpening(annecy(EVENT_OPENS), day("2026-11-30"))).toEqual(
      op("2026-11-16", "12:00"),
    );
  });

  test("generalOpening — same day: the time decides", () => {
    const v = annecy(
      {},
      [],
      [
        rawFormat("late", {
          registration_opening: "2026-11-17",
          registration_opening_time: "14:00",
        }),
        rawFormat("early", {
          registration_opening: "2026-11-17",
          registration_opening_time: "09:00",
        }),
      ],
    );
    expect(generalOpening(v, day("2026-11-01"))).toEqual(op("2026-11-17", "09:00", "early"));
  });

  test("generalOpening — no time counts 9:00", () => {
    const v = annecy(
      {},
      [],
      [
        rawFormat("noon", {
          registration_opening: "2026-11-17",
          registration_opening_time: "12:00",
        }),
        rawFormat("none", { registration_opening: "2026-11-17", registration_opening_time: "" }),
        rawFormat("eight", {
          registration_opening: "2026-11-17",
          registration_opening_time: "08:59",
        }),
      ],
    );
    expect(generalOpening(v, day("2026-11-01"))).toEqual(op("2026-11-17", "08:59", "eight"));
    // "none" has a day alone and the event has no opening: it has none of its own.
    // With an event opening without a time, it keeps that time: 9:00 is 9:00.
    const withEvent = annecy(
      { registration_opening: "2026-11-16" },
      [
        ["alice", "interested", "none"],
        ["alice", "interested", "nine"],
      ],
      [
        rawFormat("none", { registration_opening: "2026-11-17" }),
        rawFormat("nine", {
          registration_opening: "2026-11-17",
          registration_opening_time: "09:00",
        }),
      ],
    );
    expect(personOpenings(withEvent, "alice", day("2026-11-01"))).toEqual([
      op("2026-11-17", "09:00", "nine", "none"),
    ]);
  });

  test("generalOpening — none", () => {
    expect(
      generalOpening(annecy({}, [], [rawFormat("marathon", {})]), day("2026-11-01")),
    ).toBeNull();
  });
});

describe("openingOf", () => {
  test("openingOf — a format's own, else the general one", () => {
    const view = annecy();
    const today = day("2026-11-15");
    expect(openingOf(view, "semi", today)).toEqual(op("2026-11-17", "12:00", "semi"));
    expect(openingOf(view, "marathon", today)).toEqual(generalOpening(view, today));
    expect(openingOf(view, undefined, today)).toEqual(generalOpening(view, today));
  });
});

describe("personOpenings and shownOpening", () => {
  const today = day("2026-11-15");

  test("interested on the semi: the semi", () => {
    const view = annecy({}, [["alice", "interested", "semi"]]);
    expect(personOpenings(view, "alice", today)).toEqual([op("2026-11-17", "12:00", "semi")]);
  });

  test("registered on the 10 km, interested on the 5 km: both, by instant", () => {
    const view = annecy({}, [
      ["alice", "registered", "10km"],
      ["alice", "interested", "5km"],
    ]);
    expect(personOpenings(view, "alice", today)).toEqual([
      op("2026-11-18", "12:00", "10km"),
      op("2026-11-19", "12:00", "5km"),
    ]);
  });

  test("another runner's participations do not count", () => {
    const view = annecy({}, [["bob", "interested", "semi"]]);
    expect(personOpenings(view, "alice", today)).toEqual([]);
  });

  test("a supporter and a person who does not start have none", () => {
    expect(personOpenings(annecy({}, [["alice", "supporter", ""]]), "alice", today)).toEqual([]);
    expect(personOpenings(annecy({}, [["alice", "dns", "semi"]]), "alice", today)).toEqual([]);
  });

  test("interested on the event alone: the general opening", () => {
    const view = annecy({}, [["alice", "interested", ""]]);
    expect(personOpenings(view, "alice", today)).toEqual([op("2026-11-17", "12:00", "semi")]);
  });

  test("two formats at the same instant are one opening", () => {
    const view = annecy({}, [
      ["alice", "interested", "semi"],
      ["alice", "interested", "10km"],
    ]);
    const same = annecy(
      {},
      [
        ["alice", "interested", "semi"],
        ["alice", "interested", "10km"],
      ],
      [
        rawFormat("semi", {
          distance_km: 21.1,
          registration_opening: "2026-11-17",
          registration_opening_time: "12:00",
        }),
        rawFormat("10km", {
          distance_km: 10,
          registration_opening: "2026-11-17",
          registration_opening_time: "12:00",
        }),
      ],
    );
    expect(personOpenings(view, "alice", today)).toHaveLength(2);
    expect(personOpenings(same, "alice", today)).toEqual([
      op("2026-11-17", "12:00", "10km", "semi"),
    ]);
  });

  test("the event's opening wins over a format at the same instant", () => {
    const view = annecy(EVENT_OPENS, [
      ["alice", "interested", "marathon"],
      ["alice", "interested", ""],
    ]);
    expect(personOpenings(view, "alice", today)).toEqual([op("2026-11-16", "12:00")]);
  });

  test("shownOpening — a supporter sees the general opening", () => {
    const view = annecy({}, [["alice", "supporter", ""]]);
    expect(shownOpening(view, "alice", today)).toEqual(generalOpening(view, today));
    expect(shownOpening(view, undefined, today)).toEqual(generalOpening(view, today));
  });

  test("shownOpening — on the 10 km and the 5 km, on 2026-11-15: the 10 km", () => {
    const view = annecy({}, [
      ["alice", "registered", "10km"],
      ["alice", "interested", "5km"],
    ]);
    expect(shownOpening(view, "alice", today)).toEqual(op("2026-11-18", "12:00", "10km"));
    // Once the 10 km has opened, the 5 km is the next one.
    expect(shownOpening(view, "alice", day("2026-11-19"))).toEqual(
      op("2026-11-19", "12:00", "5km"),
    );
  });

  test("shownOpening — all past gives the last", () => {
    const view = annecy({}, [
      ["alice", "registered", "10km"],
      ["alice", "interested", "5km"],
    ]);
    expect(shownOpening(view, "alice", day("2026-11-25"))).toEqual(
      op("2026-11-19", "12:00", "5km"),
    );
  });
});

describe("calendarOpenings", () => {
  test("undecided, no opening of the event: the three, by instant", () => {
    const got = calendarOpenings(annecy(), "alice");
    expect(got.map((o) => o.formatIds)).toEqual([["semi"], ["10km"], ["5km"]]);
    expect(calendarOpenings(annecy(), undefined)).toEqual(got);
  });

  test("a participation on a format: its own opening", () => {
    const view = annecy({}, [["alice", "registered", "10km"]]);
    expect(calendarOpenings(view, "alice")).toEqual([op("2026-11-18", "12:00", "10km")]);
  });

  test("on a format with none, the event without one: all the formats' openings", () => {
    const view = annecy({}, [["alice", "interested", "marathon"]]);
    expect(calendarOpenings(view, "alice")).toHaveLength(3);
  });

  test("with an opening of the event, a format without one: the event's", () => {
    const view = annecy(EVENT_OPENS, [["alice", "interested", "marathon"]]);
    expect(calendarOpenings(view, "alice")).toEqual([op("2026-11-16", "12:00")]);
  });
});

describe("formatNames", () => {
  const fmt = createFormatters("fr");

  test("one format: its name", () => {
    expect(formatNames(annecy(), op("2026-11-17", "12:00", "semi"), fr, fmt)).toBe("Semi");
  });

  test("two formats: as the page names them, in order, joined", () => {
    const got = formatNames(annecy(), op("2026-11-18", "12:00", "10km", "5km"), fr, fmt);
    expect(plain(got)).toBe("Route 10 km, Route 5 km");
  });

  test("the event's: empty", () => {
    expect(formatNames(annecy(), op("2026-11-16", ""), fr, fmt)).toBe("");
  });
});
