import { describe, expect, test } from "vitest";

import { toEventView, type EventView, type ParticipationView } from "./api";
import {
  hasStarters,
  isInterested,
  isOnEvent,
  isStarter,
  joinOptions,
  nonStarters,
  starters,
  SUPPORT,
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
  pNinaSupporter,
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

describe("SUPPORT", () => {
  test("is not an id of PocketBase (15 characters), nor UNDECIDED", () => {
    expect(SUPPORT).toBe("support");
    expect(SUPPORT).not.toHaveLength(15);
    expect(SUPPORT).not.toBe(UNDECIDED);
    for (const id of [f15.id, f42.id, "fLyon"]) expect(id).not.toBe(SUPPORT);
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

    expect(joinOptions(view, alice.id)).toEqual({ formats: [], undecided: false, support: false });
  });

  test("joinOptions — sur un événement à une épreuve, support sans undecided", () => {
    const options = joinOptions(event2(), nina.id);

    expect(options.formats.map(({ format }) => format.id)).toEqual(["fLyon"]);
    expect(options.undecided).toBe(false);
    expect(options.support).toBe(true);
  });

  test("Nina, who is nowhere on an event of two formats: both formats, not deciding yet, and support", () => {
    expect(joinOptions(event(), nina.id)).toMatchObject({ undecided: true, support: true });
  });

  test("support is for a runner with nothing at all: not for one on a format, nor a dns", () => {
    expect(joinOptions(event(), alice.id).support).toBe(false);
    expect(joinOptions(eventWith([as(p2, "dns"), p1, p3]), bob.id).support).toBe(false);
  });

  test("Nina interested with no format: no support (she has a participation already)", () => {
    const view = eventWith([pNinaUndecided]);

    expect(joinOptions(view, nina.id).support).toBe(false);
  });

  test("joinOptions — un supporteur garde les épreuves, sans « Pas encore décidé » ni « Je viens encourager »", () => {
    // Alice, Bob (F42) and Sam (F15) as in the fixture, and Nina, supporter of the event.
    const view = toEventView(withParticipations(eventRecord, [pNinaSupporter]));

    const options = joinOptions(view, nina.id);

    // Nina is on the event alone: no « Pas encore décidé », and no second « Je viens encourager ».
    expect(options.undecided).toBe(false);
    expect(options.support).toBe(false);
    // As for any participation on the event alone, the formats are what is left to give: the
    // server turns her participation into one on the format she takes.
    expect(formatIds(view, nina.id)).toEqual(["f15", "f42"]);
    // She does not change what the others are offered.
    expect(joinOptions(view, sam.id).support).toBe(false);
    expect(joinOptions(view, alice.id)).toMatchObject({ undecided: false, support: false });
    expect(joinOptions(view, "nobody0000000")).toMatchObject({ undecided: true, support: true });
  });

  test("a supporter of an event with a single format has no « Je viens encourager » either, and keeps the format", () => {
    const lyon = toEventView(
      withParticipations(event2Record, [{ ...pNinaSupporter, event: "event2" }]),
    );

    expect(joinOptions(lyon, nina.id)).toMatchObject({ undecided: false, support: false });
    expect(formatIds(lyon, nina.id)).toEqual(["fLyon"]);
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

  test("false with nothing but a supporter: a supporter does not start anything", () => {
    expect(hasStarters(eventWith([pNinaSupporter]))).toBe(false);
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

  test("isOnEvent — vrai pour un supporteur", () => {
    const view = eventWith([pNinaSupporter]);

    expect(isOnEvent(view, nina.id)).toBe(true);
    expect(isOnEvent(view, alice.id)).toBe(false);
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

describe("isInterested", () => {
  test("true for a runner interested in a format: Bob on F42 (whether he confirmed or not)", () => {
    expect(isInterested(event(), bob.id)).toBe(true);
    expect(isInterested(eventWith([{ ...p2, confirmed: true }]), bob.id)).toBe(true);
  });

  test("true for Nina, interested with no format", () => {
    expect(isInterested(eventWith([pNinaUndecided]), nina.id)).toBe(true);
  });

  test("false for a runner who is registered, did not start, or is nowhere", () => {
    expect(isInterested(event(), alice.id)).toBe(false);
    expect(isInterested(eventWith([as(p2, "dns")]), bob.id)).toBe(false);
    expect(isInterested(event(), nina.id)).toBe(false);
  });

  test("false for a supporter, who is not interested in a race", () => {
    expect(isInterested(eventWith([pNinaSupporter]), nina.id)).toBe(false);
  });

  test("true when one of several participations of the runner is interested", () => {
    const view = eventWith([p1, { ...p1, id: "p1b", format: "f15", status: "interested" }]);

    expect(isInterested(view, alice.id)).toBe(true);
  });
});
