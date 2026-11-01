import { describe, expect, test } from "vitest";

import { applyFilters, eventsFilter, sortEvents, toEventViews, type EventView } from "./api";
import {
  bobRunner as bob,
  event2Record as event2,
  eventRecord as event,
  f15,
  fLyon,
  ninaRunner as nina,
  p1,
  p2,
  p3,
  pNinaSupporter,
  pNinaUndecided,
  roadType as road,
  samRunner as sam,
  trailType as trail,
  withParticipations,
} from "./testFixture";

const date = (s: string) => Temporal.PlainDate.from(s);

const ids = (list: EventView[]) => list.map((view) => view.event.id);

function views(): EventView[] {
  return toEventViews([event, event2]);
}

/** A supporter of the event of the fixture: a participation of a runner of this name, added by themselves. */
function supporterNamed(id: string, name: string) {
  const runner = { ...nina, id: `${id}Runner`, name };
  return {
    ...pNinaSupporter,
    id,
    runner: runner.id,
    added_by: runner.id,
    expand: { runner, added_by: runner },
  };
}

/** The two events, where Bob (on F42) and Alice have the status given to Bob. */
function bobAs(status: string): EventView[] {
  const participations = [{ ...p2, status }, p1];
  return toEventViews([
    { ...event, expand: { ...event.expand, participations_via_event: participations } },
    event2,
  ]);
}

describe("eventsFilter", () => {
  // The dates are bound as parameters: the SDK quotes them.
  test("a-venir: the events that are not over, from the first to come", () => {
    const { filter, sort } = eventsFilter({ period: "a-venir", today: date("2026-06-14") });

    expect(filter).toBe('start_date >= "2026-06-14" || end_date >= "2026-06-14"');
    expect(sort).toBe("start_date");
  });

  test("passees: the events that are over, from the latest", () => {
    const { filter, sort } = eventsFilter({ period: "passees", today: date("2026-06-14") });

    expect(filter).toBe('start_date < "2026-06-14" && (end_date = "" || end_date < "2026-06-14")');
    expect(sort).toBe("-start_date");
  });

  test("a range: the events that have a day in it, from the first to come", () => {
    const { filter, sort } = eventsFilter({ from: date("2026-06-01"), to: date("2026-07-12") });

    expect(filter).toBe(
      'start_date <= "2026-07-12" && (end_date >= "2026-06-01" || start_date >= "2026-06-01")',
    );
    expect(sort).toBe("start_date");
  });
});

describe("toEventViews", () => {
  test("puts the formats in the order of their days: F15, which has no date, comes first", () => {
    const [view] = toEventViews([event]);

    expect(view?.formats.map(({ format }) => format.id)).toEqual(["f15", "f42"]);
    // F15 takes the day the event starts.
    expect(view?.formats[0]?.date.toString()).toBe("2026-06-13");
    expect(view?.formats[1]?.date.toString()).toBe("2026-06-14");
  });

  test("on the same day, the shorter distance comes first and a format with none comes last", () => {
    const sixHours = { ...fLyon, id: "six", distance_km: 0, duration_min: 360 };
    const twenty = { ...fLyon, id: "twenty", distance_km: 20 };
    const ten = { ...fLyon, id: "ten", distance_km: 10 };
    const record = { ...event2, expand: { formats_via_event: [sixHours, twenty, ten] } };

    const [view] = toEventViews([record]);

    expect(view?.formats.map(({ format }) => format.id)).toEqual(["ten", "twenty", "six"]);
  });

  test("gives the dates of the event, one day when there is no end date", () => {
    const [first, second] = views();

    expect(first?.start.toString()).toBe("2026-06-13");
    expect(first?.end.toString()).toBe("2026-06-14");
    expect(second?.start.toString()).toBe("2026-06-22");
    expect(second?.end.toString()).toBe("2026-06-22");
  });

  test("gives each format its race type and each participation its runner and who added it", () => {
    const [view] = views();
    const f42View = view?.formats.find((candidate) => candidate.format.id === "f42");
    const bobView = f42View?.participations.find(
      (candidate) => candidate.participation.id === "p2",
    );

    expect(f42View?.raceType.label).toBe("Trail");
    expect(bobView?.runner.name).toBe("Bob");
    expect(bobView?.addedBy?.name).toBe("Alice");
    expect(bobView?.participation.confirmed).toBe(false);
  });

  test("lists the participants of a format by name", () => {
    const [view] = views();
    const f42View = view?.formats.find((candidate) => candidate.format.id === "f42");

    // The server gave Bob first.
    expect(f42View?.participations.map(({ runner }) => runner.name)).toEqual(["Alice", "Bob"]);
  });

  test("keeps the order the server gave to the events", () => {
    expect(ids(toEventViews([event2, event]))).toEqual(["event2", "event"]);
  });

  test("an event with no format has an empty list of formats", () => {
    const { expand: _expand, ...bare } = event;

    expect(toEventViews([bare])[0]?.formats).toEqual([]);
  });

  test("groups participations_via_event by format: F42 has Alice and Bob, F15 has Sam", () => {
    const [view] = views();
    const names = (formatId: string) =>
      view?.formats
        .find(({ format }) => format.id === formatId)
        ?.participations.map(({ runner }) => runner.name);

    // The server gave Bob, Alice, Sam, in a single list.
    expect(names("f42")).toEqual(["Alice", "Bob"]);
    expect(names("f15")).toEqual(["Sam"]);
    expect(view?.interested).toEqual([]);
  });

  test("a participation without a format goes to interested, sorted by runner name", () => {
    const admin = { ...nina, id: "adminRunner0000", name: "Admin" };
    const pAdmin = {
      ...pNinaUndecided,
      id: "pAdmin",
      runner: admin.id,
      added_by: admin.id,
      expand: { runner: admin, added_by: admin },
    };
    // Nina comes before Admin in the answer.
    const record = withParticipations(event, [pNinaUndecided, pAdmin]);

    const [view] = toEventViews([record]);

    expect(view?.interested.map(({ runner }) => runner.name)).toEqual(["Admin", "Nina"]);
    expect(view?.interested[1]?.participation.id).toBe("pNinaUndecided");
    // The ones on a format are where they were.
    expect(view?.formats.map(({ participations }) => participations.length)).toEqual([1, 2]);
  });

  test("toEventView — les supporteurs sont à part, les intéressés sans épreuve restent dans interested", () => {
    // Sue comes before Admin in the answer, and Nina (interested) between them.
    const record = withParticipations(event, [
      supporterNamed("pSue", "Sue"),
      pNinaUndecided,
      supporterNamed("pAdmin", "Admin"),
    ]);

    const [view] = toEventViews([record]);

    // The supporters by runner name, and only them; Nina stays among the interested.
    expect(view?.supporters.map(({ runner }) => runner.name)).toEqual(["Admin", "Sue"]);
    expect(view?.supporters.map(({ participation }) => participation.status)).toEqual([
      "supporter",
      "supporter",
    ]);
    expect(view?.interested.map(({ runner }) => runner.name)).toEqual(["Nina"]);
    expect(view?.interested[0]?.participation.status).toBe("interested");
    // The ones on a format are where they were.
    expect(view?.formats.map(({ participations }) => participations.length)).toEqual([1, 2]);
  });

  test("an event without participations_via_event has no participants and an empty interested", () => {
    const [view] = toEventViews([event2]);

    expect(view?.interested).toEqual([]);
    expect(view?.supporters).toEqual([]);
    expect(view?.formats.map(({ participations }) => participations)).toEqual([[]]);
  });

  test("a participation whose format is not one of the event's is a malformed answer", () => {
    const record = withParticipations(event, [{ ...p1, id: "pElsewhere", format: fLyon.id }]);

    expect(() => toEventViews([record])).toThrow(/pElsewhere/);
    expect(() => toEventViews([record])).toThrow(/fLyon/);
  });

  test("a participation whose adder is not there still has its runner", () => {
    const orphan = { ...p3, expand: { runner: sam } };
    const record = {
      ...event,
      expand: { formats_via_event: [f15], participations_via_event: [orphan] },
    };

    const participation = toEventViews([record])[0]?.formats[0]?.participations[0];

    expect(participation?.runner.name).toBe("Sam");
    expect(participation?.addedBy).toBeUndefined();
  });

  test("something that is not an event is a malformed answer", () => {
    expect(() => toEventViews([{}])).toThrow(TypeError);
    expect(() => toEventViews([null])).toThrow(TypeError);
  });

  test("a format without its race type is a malformed answer", () => {
    const broken = { ...f15, expand: {} };
    const record = { ...event, expand: { formats_via_event: [broken] } };

    expect(() => toEventViews([record])).toThrow(/race_type/);
  });
});

describe("sortEvents", () => {
  // The list sorts the events itself before it groups them by month: it must
  // not depend on the order of the answer.
  test("ascending: the first to start comes first, whatever the order it was given in", () => {
    expect(ids(sortEvents(toEventViews([event2, event]), "asc"))).toEqual(["event", "event2"]);
    expect(ids(sortEvents(toEventViews([event, event2]), "asc"))).toEqual(["event", "event2"]);
  });

  test("descending: the last to start comes first", () => {
    expect(ids(sortEvents(toEventViews([event, event2]), "desc"))).toEqual(["event2", "event"]);
  });

  test("events that start the same day are ordered by name both ways, and the input is left alone", () => {
    const zen = { ...event2, id: "zen", name: "Zen", start_date: "2026-06-13" };
    const input = toEventViews([zen, event]);

    expect(ids(sortEvents(input, "asc"))).toEqual(["event", "zen"]);
    expect(ids(sortEvents(input, "desc"))).toEqual(["event", "zen"]);
    expect(ids(input)).toEqual(["zen", "event"]);
  });
});

describe("applyFilters", () => {
  test("without criteria, everything stays", () => {
    expect(ids(applyFilters(views(), {}))).toEqual(["event", "event2"]);
  });

  test("personne: keeps the events where this runner has a participation", () => {
    expect(ids(applyFilters(views(), { personne: bob.id }))).toEqual(["event"]);
    expect(ids(applyFilters(views(), { personne: sam.id }))).toEqual(["event"]);
  });

  test("personne: an event-level participation counts", () => {
    const withNina = toEventViews([withParticipations(event, [pNinaUndecided]), event2]);

    expect(ids(applyFilters(withNina, { personne: nina.id }))).toEqual(["event"]);
  });

  test("personne: a supporter counts: the event is one of theirs", () => {
    const withNina = toEventViews([withParticipations(event, [pNinaSupporter]), event2]);

    expect(ids(applyFilters(withNina, { personne: nina.id }))).toEqual(["event"]);
  });

  test("personne: a dns participation does not count, a dnf one does", () => {
    expect(applyFilters(bobAs("dns"), { personne: bob.id })).toEqual([]);
    expect(ids(applyFilters(bobAs("dnf"), { personne: bob.id }))).toEqual(["event"]);
  });

  test("personne: a runner with no participation keeps nothing", () => {
    expect(applyFilters(views(), { personne: "nobody0000000" })).toEqual([]);
  });

  test("type: keeps the events that have a format of this type", () => {
    expect(ids(applyFilters(views(), { type: road.id }))).toEqual(["event2"]);
    expect(ids(applyFilters(views(), { type: trail.id }))).toEqual(["event"]);
  });

  test("both criteria must hold", () => {
    expect(applyFilters(views(), { personne: bob.id, type: road.id })).toEqual([]);
    expect(ids(applyFilters(views(), { personne: bob.id, type: trail.id }))).toEqual(["event"]);
  });

  test("an empty criterion is no criterion", () => {
    expect(ids(applyFilters(views(), { personne: "", type: "" }))).toEqual(["event", "event2"]);
  });
});
