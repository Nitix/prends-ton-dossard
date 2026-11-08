import { describe, expect, test } from "vitest";

import { toEventView, type EventView } from "../events/api";
import {
  aliceRunner,
  bobRunner,
  event2Record,
  eventRecord,
  p2,
  pNinaUndecided,
  samRunner,
  withParticipations,
  withStatus,
} from "../events/testFixture";
import { todosOf } from "./registrationTodo";

const date = (s: string) => Temporal.PlainDate.from(s);
const TODAY = "2026-04-30";

/** An event of the fixture with a registration deadline, and these participations on top of its own. */
function viewOf(event: { expand: object }, deadline: string, extra: unknown[] = []): EventView {
  return toEventView(withParticipations({ ...event, registration_deadline: deadline }, extra));
}

/** Bob, interested on the 15 km of the trail (F42 is already his, in the fixture). */
const bobOn15 = { ...p2, id: "p-bob-15", format: "f15" };

const ids = (views: EventView[], runnerId: string | undefined, today = TODAY) =>
  todosOf(views, runnerId, date(today)).map(({ participation }) => participation.id);

describe("todosOf", () => {
  test("todosOf — seulement mes participations « Intéressé » dont la date limite n'est pas passée", () => {
    // Bob is interested on F42 (P2); Alice has registered (P1), Sam is
    // interested (P3).
    const trail = viewOf(eventRecord, "2026-06-10");
    expect(ids([trail], bobRunner.id)).toEqual(["p2"]);
    expect(ids([trail], samRunner.id)).toEqual(["p3"]);
    expect(ids([trail], aliceRunner.id)).toEqual([]);
    // Nobody is known while the runner of the user loads.
    expect(ids([trail], undefined)).toEqual([]);

    // Bob's other statuses are not to do: registered, finished, did not
    // finish, not starting.
    for (const status of ["registered", "finished", "dnf", "dns"]) {
      const done = viewOf(eventRecord, "2026-06-10", [{ ...bobOn15, status }]);
      expect(ids([done], bobRunner.id)).toEqual(["p2"]);
    }

    // No deadline: nothing to do before a day.
    expect(ids([viewOf(eventRecord, "")], bobRunner.id)).toEqual([]);
    // A deadline that has passed, the event being still to come: closed.
    const lyon = viewOf(event2Record, "2026-04-29", [
      { ...p2, id: "p-lyon", event: "event2", format: "fLyon" },
    ]);
    expect(ids([lyon], bobRunner.id)).toEqual([]);
    // An event that is over, and so is its deadline.
    expect(ids([trail], bobRunner.id, "2026-06-15")).toEqual([]);
    // The day of the deadline one can still register (Review Focus 2).
    expect(todosOf([trail], bobRunner.id, date("2026-06-10"))).toMatchObject([
      {
        day: date("2026-06-10"),
        state: { kind: "open", deadline: date("2026-06-10"), daysLeft: 0 },
      },
    ]);
    expect(ids([trail], bobRunner.id, "2026-06-11")).toEqual([]);
  });

  test("todosOf — triées par date limite puis par nom", () => {
    const bobOnLyon = { ...p2, id: "p-lyon", event: "event2", format: "fLyon" };
    // "Marathon de Paris" has the earliest deadline.
    const paris = {
      ...event2Record,
      id: "event3",
      name: "Marathon de Paris",
      start_date: "2026-06-20",
      expand: {
        formats_via_event: [{ ...event2Record.expand.formats_via_event[0], id: "fParis" }],
      },
    };
    const bobOnParis = { ...p2, id: "p-paris", event: "event3", format: "fParis" };
    const views = [
      viewOf(eventRecord, "2026-06-10", [bobOn15]),
      viewOf(event2Record, "2026-06-10", [bobOnLyon]),
      viewOf(paris, "2026-05-20", [bobOnParis]),
    ];

    const rows = todosOf(views, bobRunner.id, date(TODAY));

    // Paris (20 May), then the two of 10 June by event name ("10 km de
    // Lyon" before "Trail des Crêtes"), and by id of participation within the
    // event (p-bob-15 before p2).
    expect(rows.map((row) => [row.view.event.name, row.participation.id])).toEqual([
      ["Marathon de Paris", "p-paris"],
      ["10 km de Lyon", "p-lyon"],
      ["Trail des Crêtes", "p-bob-15"],
      ["Trail des Crêtes", "p2"],
    ]);
    expect(
      rows.map((row) => [row.day.toString(), row.state.kind === "open" ? row.state.daysLeft : -1]),
    ).toEqual([
      ["2026-05-20", 20],
      ["2026-06-10", 41],
      ["2026-06-10", 41],
      ["2026-06-10", 41],
    ]);
    // The order does not depend on the order the server gave the events in.
    expect(
      todosOf(views.toReversed(), bobRunner.id, date(TODAY)).map(
        ({ participation }) => participation.id,
      ),
    ).toEqual(["p-paris", "p-lyon", "p-bob-15", "p2"]);
  });

  test("todosOf — une participation à l'événement compte, sans épreuve", () => {
    const trail = viewOf(eventRecord, "2026-06-10", [pNinaUndecided]);

    const rows = todosOf([trail], pNinaUndecided.runner, date(TODAY));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.participation.id).toBe("pNinaUndecided");
    expect(rows[0]?.formatView).toBeUndefined();
    expect(rows[0]?.view).toBe(trail);
    expect(rows[0]?.day.toString()).toBe("2026-06-10");
    expect(rows[0]?.state).toMatchObject({ kind: "open", daysLeft: 41 });
    // A participation on a format has its format view.
    const [bobRow] = todosOf([trail], bobRunner.id, date(TODAY));
    expect(bobRow?.formatView?.format.id).toBe("f42");
  });

  test("todosOf — une ouverture à venir est une inscription à faire, rangée par son jour", () => {
    // Bob is interested in the trail (P2): the deadline is 10 June, the opening 12 May.
    const trail = toEventView(
      withParticipations(
        {
          ...eventRecord,
          registration_deadline: "2026-06-10",
          registration_opening: "2026-05-12",
          registration_opening_time: "10:00",
        },
        [],
      ),
    );
    // Lyon is open already, with a deadline on 20 May: before the opening of the trail.
    const lyon = viewOf(event2Record, "2026-05-20", [
      { ...p2, id: "p-lyon", event: "event2", format: "fLyon" },
    ]);
    // Paris opens today.
    const paris = toEventView(
      withParticipations(
        {
          ...event2Record,
          id: "event3",
          name: "Marathon de Paris",
          start_date: "2026-06-20",
          registration_deadline: "2026-06-01",
          registration_opening: TODAY,
          expand: {
            formats_via_event: [{ ...event2Record.expand.formats_via_event[0], id: "fParis" }],
          },
        },
        [{ ...p2, id: "p-paris", event: "event3", format: "fParis" }],
      ),
    );

    const rows = todosOf([trail, lyon, paris], bobRunner.id, date(TODAY));

    expect(rows.map((row) => [row.participation.id, row.state.kind, row.day.toString()])).toEqual([
      ["p-paris", "today", TODAY],
      ["p2", "soon", "2026-05-12"],
      ["p-lyon", "open", "2026-05-20"],
    ]);
    expect(rows[1]?.state).toEqual({
      kind: "soon",
      opening: date("2026-05-12"),
      time: "10:00",
      daysLeft: 12,
      deadline: date("2026-06-10"),
    });
  });

  test("todosOf — un inscrit n'y est pas", () => {
    const soon = {
      ...eventRecord,
      registration_deadline: "2026-06-10",
      registration_opening: "2026-05-12",
    };
    const registered = toEventView(withStatus(soon, "p2", "registered"));
    expect(ids([registered], bobRunner.id)).toEqual([]);
  });
});
