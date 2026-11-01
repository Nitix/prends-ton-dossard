import { describe, expect, test } from "vitest";

import type { OfferKind, OfferMemberRecord, OfferRecord, RunnerRecord } from "../../lib/types";
import type { OfferView } from "./api";
import { canTakePlace, hasPlaceOfKind, isFull } from "./offerRules";

const base = { created: "", updated: "", collectionId: "", collectionName: "" };

const runner = (id: string): RunnerRecord => ({ ...base, id, name: id, user: `u-${id}` });
const alice = runner("alice");
const bob = runner("bob");
const sam = runner("sam");
const nina = runner("nina");
const carol = runner("carol");

/** An offer of `kind` owned by `owner`, with `seats` places (0: no limit) and these runners in it. */
function offer(
  id: string,
  kind: OfferKind,
  owner: RunnerRecord,
  seats: number,
  members: RunnerRecord[] = [],
): OfferView {
  const record: OfferRecord = {
    ...base,
    id,
    event: "event",
    kind,
    owner: owner.id,
    place: "Lyon",
    seats,
  };
  return {
    offer: record,
    owner,
    members: members.map((member) => {
      const place: OfferMemberRecord = {
        ...base,
        id: `${id}-${member.id}`,
        offer: id,
        runner: member.id,
        added_by: member.id,
      };
      return { member: place, runner: member };
    }),
  };
}

describe("isFull", () => {
  test("isFull — sans limite, jamais plein", () => {
    expect(isFull(offer("l1", "lodging", alice, 0))).toBe(false);
    // A lodging without a limit stays open however many people are in it.
    expect(isFull(offer("l2", "lodging", alice, 0, [bob, sam, nina]))).toBe(false);
  });

  test("isFull — plein quand les places prises atteignent les places proposées", () => {
    expect(isFull(offer("r1", "ride", alice, 2))).toBe(false);
    expect(isFull(offer("r2", "ride", alice, 2, [bob]))).toBe(false);
    expect(isFull(offer("r3", "ride", alice, 2, [bob, sam]))).toBe(true);
    // The server lets two members take the last place together: more people than seats is still full.
    expect(isFull(offer("r4", "ride", alice, 2, [bob, sam, nina]))).toBe(true);
  });
});

describe("hasPlaceOfKind", () => {
  test("hasPlaceOfKind — propriétaire ou passager", () => {
    const offers = [offer("r1", "ride", alice, 3, [bob]), offer("l1", "lodging", sam, 0, [alice])];

    // Owner of a ride, and passenger of it.
    expect(hasPlaceOfKind(offers, "ride", alice.id)).toBe(true);
    expect(hasPlaceOfKind(offers, "ride", bob.id)).toBe(true);
    // The kinds are apart: Bob has a seat in a car, not a bed.
    expect(hasPlaceOfKind(offers, "lodging", bob.id)).toBe(false);
    // Owner of a lodging, and guest of it.
    expect(hasPlaceOfKind(offers, "lodging", sam.id)).toBe(true);
    expect(hasPlaceOfKind(offers, "lodging", alice.id)).toBe(true);
    // Nina is nowhere, and nobody is anywhere when there are no offers.
    expect(hasPlaceOfKind(offers, "ride", nina.id)).toBe(false);
    expect(hasPlaceOfKind([], "ride", alice.id)).toBe(false);
  });
});

describe("canTakePlace", () => {
  test("canTakePlace — ni le propriétaire, ni quelqu'un qui a déjà une place de cette sorte, ni une offre pleine", () => {
    const open = offer("r1", "ride", alice, 3, [bob]);
    const full = offer("r2", "ride", sam, 1, [nina]);
    const lodging = offer("l1", "lodging", bob, 0);
    const offers = [open, full, lodging];

    // A runner who has nothing takes a place in an open offer.
    expect(canTakePlace(offers, open, carol.id)).toBe(true);
    // Not in their own offer.
    expect(canTakePlace(offers, open, alice.id)).toBe(false);
    // Not twice in the same offer, nor in a second one of the same kind.
    expect(canTakePlace(offers, open, bob.id)).toBe(false);
    expect(canTakePlace(offers, full, bob.id)).toBe(false);
    // The owner of a car goes in no other car.
    expect(canTakePlace(offers, full, alice.id)).toBe(false);
    // Not in a full offer, however free the runner is.
    expect(canTakePlace(offers, full, carol.id)).toBe(false);
    // The kinds are apart: Alice, who only has a car, may stay in Bob's lodging...
    expect(canTakePlace(offers, lodging, alice.id)).toBe(true);
    // ...and Bob, who owns that lodging, may not stay in another one.
    const second = offer("l2", "lodging", sam, 0);
    expect(canTakePlace([...offers, second], second, bob.id)).toBe(false);
  });
});
