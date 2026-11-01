import { describe, expect, test } from "vitest";

import { toEventView, type EventView, type ParticipationView } from "./api";
import {
  hasStarters,
  isOnEvent,
  isStarter,
  joinOptions,
  nonStarters,
  starters,
  UNDECIDED,
} from "./participants";
import {
  aliceRunner as alice,
  bobRunner as bob,
  event2Record,
  eventRecord,
  f15,
  f42,
  ninaRunner as nina,
  p1,
  p2,
  p3,
  pNinaUndecided,
  samRunner as sam,
  withParticipations,
} from "./testFixture";

/** The event of the fixture (F15 then F42), with these participations instead of its own. */
function eventWith(participations: unknown[]): EventView {
  return toEventView({
    ...eventRecord,
    expand: { ...eventRecord.expand, participations_via_event: participations },
  });
}

const as = (record: typeof p1, status: string) => ({ ...record, status });
const formatIds = (view: EventView, runnerId: string) =>
  joinOptions(view, runnerId).formats.map(({ format }) => format.id);

const event = () => toEventView(eventRecord);
const event2 = () => toEventView(event2Record);
const runnerNames = (list: ParticipationView[]) => list.map(({ runner }) => runner.name);

describe("UNDECIDED", () => {
  test("is not an id of PocketBase (15 characters), so no format can be mistaken for it", () => {
    expect(UNDECIDED).toBe("undecided");
    expect(UNDECIDED).not.toHaveLength(15);
    for (const id of [f15.id, f42.id, "fLyon"]) expect(id).not.toBe(UNDECIDED);
  });
});

describe("joinOptions", () => {
  test("Nina, who is nowhere: both formats, and not deciding yet", () => {
    const options = joinOptions(event(), nina.id);

    expect(formatIds(event(), nina.id)).toEqual(["f15", "f42"]);
    expect(options.undecided).toBe(true);
  });

  test("Alice, on F42: F15 only", () => {
    expect(formatIds(event(), alice.id)).toEqual(["f15"]);
    expect(joinOptions(event(), alice.id).undecided).toBe(false);
  });

  test("Sam, on F15: F42 only", () => {
    expect(formatIds(event(), sam.id)).toEqual(["f42"]);
    expect(joinOptions(event(), sam.id).undecided).toBe(false);
  });

  test("Nina on an event with a single format: that format, and no deciding yet", () => {
    expect(formatIds(event2(), nina.id)).toEqual(["fLyon"]);
    expect(joinOptions(event2(), nina.id).undecided).toBe(false);
  });

  test("Nina interested with no format: both formats, and no deciding yet", () => {
    const view = toEventView(withParticipations(eventRecord, [pNinaUndecided]));

    expect(formatIds(view, nina.id)).toEqual(["f15", "f42"]);
    expect(joinOptions(view, nina.id).undecided).toBe(false);
  });

  test("Bob, who does not start F42: F15 only, since he has a participation on F42 whatever its status", () => {
    const view = eventWith([as(p2, "dns"), p1, p3]);

    expect(formatIds(view, bob.id)).toEqual(["f15"]);
    expect(joinOptions(view, bob.id).undecided).toBe(false);
  });

  test("Alice, on F42 and on F15: nothing left to choose", () => {
    const view = eventWith([p1, { ...p1, id: "p1b", format: "f15" }, p2, p3]);

    expect(joinOptions(view, alice.id)).toEqual({ formats: [], undecided: false });
  });

  test("gives the formats of the view, so the order of their days", () => {
    const { formats } = joinOptions(event(), nina.id);

    expect(formats).toEqual(event().formats);
  });
});

/** Bob is a dns and Alice a dnf, on F42. */
const f42Participations = () =>
  eventWith([as(p2, "dns"), as(p1, "dnf"), p3]).formats[1]?.participations ?? [];

describe("isStarter and starters", () => {
  test("a participation is a start unless it is a dns", () => {
    expect(f42Participations().map(isStarter)).toEqual([true, false]);
  });

  test("starters takes a dns off and keeps a dnf", () => {
    expect(runnerNames(starters(f42Participations()))).toEqual(["Alice"]);
    expect(starters(f42Participations())[0]?.participation.status).toBe("dnf");
  });

  test("starters of a list with no dns is the list", () => {
    const list = event().formats[1]?.participations ?? [];

    expect(starters(list)).toEqual(list);
  });
});

describe("nonStarters", () => {
  test("lists the dns with their format, in the order of the formats then of the names", () => {
    const view = eventWith([as(p2, "dns"), p1, as(p3, "dns")]);

    const list = nonStarters(view);

    expect(
      list.map(({ formatView, participationView }) => [
        formatView.format.id,
        participationView.runner.name,
      ]),
    ).toEqual([
      ["f15", "Sam"],
      ["f42", "Bob"],
    ]);
  });

  test("on the same format, by name", () => {
    const view = eventWith([as(p2, "dns"), as(p1, "dns")]);

    expect(nonStarters(view).map(({ participationView }) => participationView.runner.name)).toEqual(
      ["Alice", "Bob"],
    );
  });

  test("nobody when everybody starts, a dnf included", () => {
    expect(nonStarters(event())).toEqual([]);
    expect(nonStarters(eventWith([as(p1, "dnf"), p2, p3]))).toEqual([]);
  });
});

describe("hasStarters", () => {
  test("true when somebody of a format starts", () => {
    expect(hasStarters(event())).toBe(true);
  });

  test("false when everybody is a dns", () => {
    const view = eventWith([as(p1, "dns"), as(p2, "dns"), as(p3, "dns")]);

    expect(hasStarters(view)).toBe(false);
  });

  test("false when nobody is there", () => {
    expect(hasStarters(event2())).toBe(false);
  });

  test("true with nothing but pNinaUndecided", () => {
    expect(hasStarters(eventWith([pNinaUndecided]))).toBe(true);
  });

  test("true with a dnf, who did start", () => {
    expect(hasStarters(eventWith([as(p1, "dnf")]))).toBe(true);
  });
});

describe("isOnEvent", () => {
  test("true for a runner on a format", () => {
    expect(isOnEvent(event(), alice.id)).toBe(true);
    expect(isOnEvent(event(), sam.id)).toBe(true);
  });

  test("true for Nina, who has no format", () => {
    const view = eventWith([pNinaUndecided]);

    expect(isOnEvent(view, nina.id)).toBe(true);
  });

  test("false for a runner who is only a dns, true again with a dnf", () => {
    expect(isOnEvent(eventWith([as(p2, "dns")]), bob.id)).toBe(false);
    expect(isOnEvent(eventWith([as(p2, "dnf")]), bob.id)).toBe(true);
  });

  test("true when one of the participations of the runner is not a dns", () => {
    const view = eventWith([as(p1, "dns"), { ...p1, id: "p1b", format: "f15" }]);

    expect(isOnEvent(view, alice.id)).toBe(true);
  });

  test("false for a runner who is nowhere", () => {
    expect(isOnEvent(event(), nina.id)).toBe(false);
    expect(isOnEvent(event2(), alice.id)).toBe(false);
  });
});
