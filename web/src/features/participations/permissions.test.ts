import { describe, expect, test } from "vitest";

import type { EventRecord, ParticipationRecord, RunnerRecord } from "../../lib/types";
import { canConfirm, canDeleteEvent, canEditParticipation, type Me } from "./permissions";

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

const alice: RunnerRecord = { ...base, id: "aliceRunner", name: "Alice", user: "u-alice" };
const bob: RunnerRecord = { ...base, id: "bobRunner", name: "Bob", user: "u-bob" };
// A runner who has no account: nobody is "them".
const sam: RunnerRecord = { ...base, id: "samRunner", name: "Sam", user: "" };

const meAlice: Me = { userId: "u-alice", runnerId: alice.id, isAdmin: false };
const meBob: Me = { userId: "u-bob", runnerId: bob.id, isAdmin: false };
const meAdmin: Me = { userId: "u-admin", runnerId: "adminRunner", isAdmin: true };

function participation(runner: RunnerRecord, confirmed: boolean): ParticipationRecord {
  return {
    ...base,
    id: `p-${runner.id}`,
    runner: runner.id,
    event: "event",
    format: "f42",
    status: "interested",
    added_by: alice.id,
    confirmed,
  };
}

const event: EventRecord = {
  ...base,
  id: "event",
  name: "Trail des Crêtes",
  location: "Annecy",
  start_date: "2026-06-13",
  created_by: alice.id,
};

// The matrix of section 6.1 of the design: "Modifier ou retirer une
// participation non confirmée: tout le monde; confirmée: la sienne seulement;
// admin: tout".
describe("canEditParticipation", () => {
  test.each([
    {
      title: "Bob's unconfirmed participation, by Alice",
      runner: bob,
      confirmed: false,
      me: meAlice,
      expected: true,
    },
    {
      title: "Bob's unconfirmed participation, by Bob himself",
      runner: bob,
      confirmed: false,
      me: meBob,
      expected: true,
    },
    {
      title: "Bob's unconfirmed participation, by the admin",
      runner: bob,
      confirmed: false,
      me: meAdmin,
      expected: true,
    },
    {
      title: "Sam's unconfirmed participation (no account), by anybody",
      runner: sam,
      confirmed: false,
      me: meBob,
      expected: true,
    },
    {
      title: "Alice's confirmed participation, by Alice",
      runner: alice,
      confirmed: true,
      me: meAlice,
      expected: true,
    },
    {
      title: "Alice's confirmed participation, by Bob",
      runner: alice,
      confirmed: true,
      me: meBob,
      expected: false,
    },
    {
      title: "Alice's confirmed participation, by the admin",
      runner: alice,
      confirmed: true,
      me: meAdmin,
      expected: true,
    },
    {
      title: "Sam's confirmed participation (no account), by Bob",
      runner: sam,
      confirmed: true,
      me: meBob,
      expected: false,
    },
    {
      title: "Sam's confirmed participation (no account), by the admin",
      runner: sam,
      confirmed: true,
      me: meAdmin,
      expected: true,
    },
  ])("$title: $expected", ({ runner, confirmed, me, expected }) => {
    expect(canEditParticipation(participation(runner, confirmed), runner, me)).toBe(expected);
  });

  test("an empty user id is nobody: it does not own a runner who has no account", () => {
    const nobody: Me = { userId: "", runnerId: "x", isAdmin: false };
    expect(canEditParticipation(participation(sam, true), sam, nobody)).toBe(false);
  });
});

// "Confirmer une participation: la sienne seulement", the admin included.
describe("canConfirm", () => {
  test.each([
    { title: "Alice on her own runner", runner: alice, me: meAlice, expected: true },
    { title: "Bob on Alice's runner", runner: alice, me: meBob, expected: false },
    { title: "the admin on Alice's runner", runner: alice, me: meAdmin, expected: false },
    { title: "Bob on a runner with no account", runner: sam, me: meBob, expected: false },
    { title: "the admin on a runner with no account", runner: sam, me: meAdmin, expected: false },
  ])("$title: $expected", ({ runner, me, expected }) => {
    expect(canConfirm(runner, me)).toBe(expected);
  });

  test("an empty user id is nobody", () => {
    expect(canConfirm(sam, { userId: "", runnerId: "x", isAdmin: false })).toBe(false);
  });
});

// "Supprimer un événement: si auteur de l'événement; admin: oui".
describe("canDeleteEvent", () => {
  test.each([
    { title: "its author", me: meAlice, expected: true },
    { title: "another member", me: meBob, expected: false },
    { title: "the admin", me: meAdmin, expected: true },
  ])("$title: $expected", ({ me, expected }) => {
    expect(canDeleteEvent(event, me)).toBe(expected);
  });
});
