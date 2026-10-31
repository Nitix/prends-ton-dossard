import { describe, expect, test } from "vitest";

import type { InvitationRecord, RunnerRecord, UserRecord } from "../../lib/types";
import { expiryDay, memberState, toMembers } from "./memberState";

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

const sam: RunnerRecord = { ...base, id: "samRunner", name: "Sam", user: "" };
const alice: RunnerRecord = { ...base, id: "aliceRunner", name: "Alice", user: "aliceUser" };

const aliceUser: UserRecord = {
  ...base,
  id: "aliceUser",
  email: "alice@example.test",
  role: "member",
  disabled: false,
};

/** A pending invitation for Sam, which expires on 7 November 2026 at noon (UTC). */
const invitation: InvitationRecord = {
  ...base,
  id: "inv1",
  runner: sam.id,
  kind: "invite",
  role: "member",
  expires_at: "2026-11-07 12:00:00.000Z",
  used_at: "",
  created_by: "aliceUser",
};

const now = () => Temporal.Instant.from("2026-11-01T09:00:00Z");

describe("memberState", () => {
  test("pas de compte et pas d'invitation : no_account", () => {
    expect(memberState(sam, undefined, undefined, now())).toBe("no_account");
  });

  test("invitation en attente non expirée : invited", () => {
    expect(memberState(sam, undefined, invitation, now())).toBe("invited");
  });

  test("invitation expirée : no_account", () => {
    const expired = { ...invitation, expires_at: "2026-10-31 23:59:59.000Z" };
    expect(memberState(sam, undefined, expired, now())).toBe("no_account");
  });

  test("une invitation qui expire à l'instant même est expirée", () => {
    const expiring = { ...invitation, expires_at: "2026-11-01 09:00:00.000Z" };
    expect(memberState(sam, undefined, expiring, now())).toBe("no_account");
  });

  test("une invitation déjà utilisée n'est pas en attente", () => {
    const used = { ...invitation, used_at: "2026-11-02 08:00:00.000Z" };
    expect(memberState(sam, undefined, used, now())).toBe("no_account");
  });

  test("l'invitation d'un autre coureur ne compte pas", () => {
    const other = { ...invitation, runner: "someoneElse" };
    expect(memberState(sam, undefined, other, now())).toBe("no_account");
  });

  test("compte : active", () => {
    expect(memberState(alice, aliceUser, undefined, now())).toBe("active");
  });

  test("compte avec disabled : disabled", () => {
    expect(memberState(alice, { ...aliceUser, disabled: true }, undefined, now())).toBe("disabled");
  });

  test("le compte l'emporte sur une invitation restée en attente", () => {
    const stale = { ...invitation, runner: alice.id };
    expect(memberState(alice, aliceUser, stale, now())).toBe("active");
  });
});

describe("toMembers", () => {
  const reset: InvitationRecord = {
    ...invitation,
    id: "reset1",
    runner: alice.id,
    kind: "reset",
    role: "member",
    expires_at: "2026-11-05 10:00:00.000Z",
  };
  const withUser = { ...alice, expand: { user: aliceUser } };

  test("range les coureurs par nom, avec leur compte et leur état", () => {
    const members = toMembers([sam, withUser], [], now());

    expect(members.map(({ runner, state }) => [runner.name, state])).toEqual([
      ["Alice", "active"],
      ["Sam", "no_account"],
    ]);
    expect(members[0]?.user).toEqual(aliceUser);
    expect(members[1]?.user).toBeUndefined();
  });

  test("donne à un coureur sans compte son invitation en attente", () => {
    const [member] = toMembers([sam], [invitation], now());

    expect(member?.state).toBe("invited");
    expect(member?.invitation).toEqual(invitation);
  });

  test("une invitation expirée n'est plus rattachée au coureur", () => {
    const expired = { ...invitation, expires_at: "2026-10-01 12:00:00.000Z" };

    const [member] = toMembers([sam], [expired], now());

    expect(member?.state).toBe("no_account");
    expect(member?.invitation).toBeUndefined();
  });

  test("garde, d'un coureur qui a deux invitations en attente, celle qui expire le plus tard", () => {
    const newer = { ...invitation, id: "inv2", expires_at: "2026-11-09 12:00:00.000Z" };

    const [member] = toMembers([sam], [invitation, newer], now());

    expect(member?.invitation?.id).toBe("inv2");
  });

  test("un lien de réinitialisation en attente est celui d'un coureur qui a un compte", () => {
    const [member] = toMembers([withUser], [reset], now());

    expect(member?.state).toBe("active");
    expect(member?.invitation).toBeUndefined();
    expect(member?.reset).toEqual(reset);
  });

  test("un lien de réinitialisation expiré est ignoré", () => {
    const expired = { ...reset, expires_at: "2026-10-30 10:00:00.000Z" };

    const [member] = toMembers([withUser], [expired], now());

    expect(member?.reset).toBeUndefined();
  });

  test("ne laisse pas l'invitation d'un coureur à un autre", () => {
    const members = toMembers([sam, withUser], [invitation], now());

    expect(members.find(({ runner }) => runner.id === alice.id)?.invitation).toBeUndefined();
    expect(members.find(({ runner }) => runner.id === sam.id)?.invitation).toEqual(invitation);
  });
});

describe("expiryDay", () => {
  test("lit une date-heure de PocketBase", () => {
    expect(expiryDay("2026-11-07 12:00:00.000Z").toString()).toBe("2026-11-07");
  });

  test("lit une date-heure RFC 3339, celle de la route des invitations", () => {
    expect(expiryDay("2026-11-07T12:00:00Z").toString()).toBe("2026-11-07");
  });

  test("compte le jour à Paris : 23 h 30 UTC, c'est déjà le lendemain", () => {
    expect(expiryDay("2026-11-07 23:30:00.000Z").toString()).toBe("2026-11-08");
  });
});
