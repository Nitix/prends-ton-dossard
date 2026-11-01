import type { OfferKind } from "../../lib/types";
import type { OfferView } from "./api";

// What the places of an event allow, as the page reads it. The server applies
// these rules (hooks of the `offers` package); the front end only uses them to
// hide the actions that would be refused. A runner has one place of each kind
// in an event: they own one offer of the kind, or they are in one, not both and
// not twice.

/**
 * Whether every place is taken. An offer with no limit (`seats` is 0: a lodging
 * that does not say how many people it takes) is never full. More people than
 * seats is full too: the server lets two runners take the last place together.
 */
export function isFull({ offer, members }: OfferView): boolean {
  const seats = offer.seats ?? 0;
  return seats > 0 && members.length >= seats;
}

/** Whether the runner owns an offer of this kind, or is in one: they have their car, or their bed. */
export function hasPlaceOfKind(offers: OfferView[], kind: OfferKind, runnerId: string): boolean {
  return offers.some(
    ({ offer, owner, members }) =>
      offer.kind === kind &&
      (owner.id === runnerId || members.some(({ runner }) => runner.id === runnerId)),
  );
}

/**
 * Whether the runner can take a place in the offer: it is not their own, they
 * have no place of this kind in the event yet (in this offer or another), and
 * it is not full. `offers` are those of the event, of both kinds.
 */
export function canTakePlace(offers: OfferView[], view: OfferView, runnerId: string): boolean {
  return (
    view.owner.id !== runnerId &&
    !hasPlaceOfKind(offers, view.offer.kind, runnerId) &&
    !isFull(view)
  );
}
