import { describe, expect, test } from "vitest";

import { offersKey, toOfferView } from "./api";

const base = { created: "", updated: "", collectionId: "", collectionName: "" };
const alice = { ...base, id: "alice", name: "Alice", user: "u-alice" };
const bob = { ...base, id: "bob", name: "Bob", user: "u-bob" };
const sam = { ...base, id: "sam", name: "Sam", user: "" };

const record = {
  ...base,
  id: "o1",
  event: "event",
  kind: "ride" as const,
  owner: alice.id,
  place: "Lyon",
  seats: 3,
};

const member = (id: string, runner: typeof alice) => ({
  ...base,
  id,
  offer: "o1",
  runner: runner.id,
  added_by: alice.id,
  expand: { runner },
});

describe("offersKey", () => {
  test("the offers of an event are one list, under its own key", () => {
    expect(offersKey("event1")).toEqual(["offers", "event1"]);
  });
});

describe("toOfferView", () => {
  test("toOfferView — le propriétaire, et les personnes triées par nom", () => {
    const view = toOfferView({
      ...record,
      expand: {
        owner: alice,
        offer_members_via_offer: [member("m1", sam), member("m2", bob)],
      },
    });

    expect(view.offer.id).toBe("o1");
    expect(view.owner).toBe(alice);
    expect(view.members.map(({ runner }) => runner.name)).toEqual(["Bob", "Sam"]);
    expect(view.members.map(({ member: place }) => place.id)).toEqual(["m2", "m1"]);
  });

  test("toOfferView — une offre où personne n'est n'a pas d'expand de places", () => {
    // The server leaves an empty expand out of the record.
    expect(toOfferView({ ...record, expand: { owner: alice } }).members).toEqual([]);
  });

  test("toOfferView — un propriétaire ou un coureur absent de la réponse est une erreur", () => {
    expect(() => toOfferView({ ...record })).toThrow("its owner is missing");
    expect(() =>
      toOfferView({
        ...record,
        expand: { owner: alice, offer_members_via_offer: [{ ...member("m1", bob), expand: {} }] },
      }),
    ).toThrow("its runner is missing");
  });
});
