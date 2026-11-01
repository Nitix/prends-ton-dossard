import { describe, expect, test } from "vitest";

import { aliceRunner, bobRunner, eventRecord, f42, p2, trailType } from "../events/testFixture";
import { pendingOf, type PendingView } from "./pending";

const date = (s: string) => Temporal.PlainDate.from(s);
const TODAY = date("2026-04-30");

/** A participation of Bob that Alice added and he has not confirmed, on a race of this day. */
function pendingOn(id: string, day: string, status: PendingView["participation"]["status"]) {
  return {
    participation: { ...p2, id, status, confirmed: false },
    runner: bobRunner,
    addedBy: aliceRunner,
    event: eventRecord,
    format: f42,
    raceType: trailType,
    date: date(day),
  } satisfies PendingView;
}

describe("pendingOf", () => {
  test("pendingOf — ce que « Résultats à saisir » montre n'est plus à confirmer", () => {
    const views = [
      // Registered and over for 3 days, or for exactly 60: shown to enter.
      pendingOn("recent", "2026-04-27", "registered"),
      pendingOn("60-days", "2026-03-01", "registered"),
      // Over for 61 days: no longer shown to enter, so it stays here.
      pendingOn("61-days", "2026-02-28", "registered"),
      // Registered, and to come or today: it is not over yet.
      pendingOn("today", "2026-04-30", "registered"),
      pendingOn("to-come", "2026-06-14", "registered"),
      // Not registered: nothing to enter, however old.
      pendingOn("interested", "2026-04-27", "interested"),
      pendingOn("supporter", "2026-04-27", "supporter"),
    ];

    expect(pendingOf(views, TODAY).map(({ participation }) => participation.id)).toEqual([
      "61-days",
      "today",
      "to-come",
      "interested",
      "supporter",
    ]);
    // The list it was given is left as it is.
    expect(views).toHaveLength(7);
  });
});
