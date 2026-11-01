import { describe, expect, test } from "vitest";

import type { EventRecord, ParticipationRecord, RunnerRecord } from "../../lib/types";
import {
  canConfirm,
  canDeleteComment,
  canDeleteEvent,
  canEditComment,
  canEditParticipation,
  canManageOffer,
  canRemoveMember,
  type Me,
} from "./permissions";

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

// "Modifier un commentaire: le sien" ; "Supprimer un commentaire: le sien, ou admin (tous)".
describe("canEditComment", () => {
  test.each([
    { title: "its author", me: meAlice, expected: true },
    { title: "another member", me: meBob, expected: false },
    { title: "the admin, on a comment of somebody else", me: meAdmin, expected: false },
  ])("$title: $expected", ({ me, expected }) => {
    expect(canEditComment(alice, me)).toBe(expected);
  });

  test("an empty user id is nobody", () => {
    expect(canEditComment(sam, { userId: "", runnerId: "x", isAdmin: false })).toBe(false);
  });
});

describe("canDeleteComment", () => {
  test.each([
    { title: "its author", me: meAlice, expected: true },
    { title: "another member", me: meBob, expected: false },
    { title: "the admin, on a comment of somebody else", me: meAdmin, expected: true },
  ])("$title: $expected", ({ me, expected }) => {
    expect(canDeleteComment(alice, me)).toBe(expected);
  });

  test("an empty user id is nobody, the admin apart", () => {
    expect(canDeleteComment(sam, { userId: "", runnerId: "x", isAdmin: false })).toBe(false);
    expect(canDeleteComment(sam, meAdmin)).toBe(true);
  });
});

// "Modifier ou supprimer une offre : la sienne ; admin : toutes".
describe("canManageOffer", () => {
  test.each([
    { title: "its owner", me: meAlice, expected: true },
    { title: "another member", me: meBob, expected: false },
    { title: "the admin", me: meAdmin, expected: true },
  ])("$title: $expected", ({ me, expected }) => {
    expect(canManageOffer(alice, me)).toBe(expected);
  });

  test("an empty user id is nobody, the admin apart", () => {
    const nobody: Me = { userId: "", runnerId: "x", isAdmin: false };
    expect(canManageOffer(sam, nobody)).toBe(false);
    expect(canManageOffer(sam, meAdmin)).toBe(true);
  });
});

// "Prendre ou libérer une place : pour soi ; placer ou retirer quelqu'un : dans la sienne ; admin : tout".
describe("canRemoveMember", () => {
  const stranger: Me = { userId: "u-stranger", runnerId: "strangerRunner", isAdmin: false };

  test.each([
    { title: "the passenger themselves", member: bob, me: meBob, expected: true },
    { title: "the owner of the offer", member: bob, me: meAlice, expected: true },
    { title: "the admin", member: bob, me: meAdmin, expected: true },
    { title: "another member", member: bob, me: stranger, expected: false },
    // A runner with no account is placed by the owner: nobody else removes them.
    { title: "the owner, for a runner with no account", member: sam, me: meAlice, expected: true },
    {
      title: "another member, for a runner with no account",
      member: sam,
      me: meBob,
      expected: false,
    },
  ])("$title: $expected", ({ member, me, expected }) => {
    expect(canRemoveMember(member, alice, me)).toBe(expected);
  });

  test("an empty user id is nobody", () => {
    expect(canRemoveMember(sam, alice, { userId: "", runnerId: "x", isAdmin: false })).toBe(false);
  });
});
