import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { pb } from "../../lib/pb";
import type { OfferMemberRecord, OfferRecord, RunnerRecord } from "../../lib/types";

// The places that members offer for an event, with the runner who offers them
// and the ones who have taken one, in a single request: the `expand` of the
// owner and the back-relation of `offer_members.offer`, with its runner.

/** A place taken in an offer, with the runner who has it. */
export type OfferMemberView = { member: OfferMemberRecord; runner: RunnerRecord };

/** An offer with its owner and the people in it, by name. */
export type OfferView = { offer: OfferRecord; owner: RunnerRecord; members: OfferMemberView[] };

/** The offers of an event, of both kinds: one list that every change refreshes. */
export const offersKey = (eventId: string) => ["offers", eventId] as const;

// What the server sends for `expand`. An expand that is empty is left out of
// the record, hence the `?`: an offer where nobody has a place has no list of
// them. But an offer cannot lose its owner (a runner who offers is never
// deleted) nor a place its runner (the place goes with the runner).
type ExpandedMember = OfferMemberRecord & { expand?: { runner?: RunnerRecord } };
type ExpandedOffer = OfferRecord & {
  expand?: { owner?: RunnerRecord; offer_members_via_offer?: ExpandedMember[] };
};

function toMemberView(record: ExpandedMember): OfferMemberView {
  const runner = record.expand?.runner;
  if (!runner) throw new Error(`offer place ${record.id}: its runner is missing from the answer`);
  return { member: record, runner };
}

/** An offer of the answer to a request made with the `expand` above: the owner has to be there. */
export function toOfferView(record: ExpandedOffer): OfferView {
  const owner = record.expand?.owner;
  if (!owner) throw new Error(`offer ${record.id}: its owner is missing from the answer`);
  return {
    offer: record,
    owner,
    members: (record.expand?.offer_members_via_offer ?? [])
      .map(toMemberView)
      .toSorted((a, b) => a.runner.name.localeCompare(b.runner.name)),
  };
}

/** The offers of an event, the oldest first. */
export function useOffers(eventId: string): UseQueryResult<OfferView[]> {
  return useQuery({
    queryKey: offersKey(eventId),
    queryFn: async () => {
      const records = await pb.collection("offers").getFullList<ExpandedOffer>({
        filter: pb.filter("event = {:event}", { event: eventId }),
        sort: "created",
        expand: "owner,offer_members_via_offer.runner",
      });
      return records.map(toOfferView);
    },
  });
}

// The hooks below run a request, then make the list ask for the offers again.
// The mutation lasts until it has the new data, so that what the page does
// next (moving the focus, closing a window) is done on the new list. A request
// that is refused refreshes the list as well, without waiting for it: a place
// can be refused because somebody took it while the page was open.

/** Resolves once the list that is on screen has its new data. */
function refresh(queryClient: QueryClient, eventId: string): Promise<unknown> {
  return queryClient.invalidateQueries({ queryKey: offersKey(eventId) });
}

/** Takes a place in an offer for a runner: for oneself, or, for the owner of the offer and the admins, for anyone. */
export function useTakePlace(
  eventId: string,
): UseMutationResult<OfferMemberRecord, Error, { offer: string; runner: string }> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (place) => pb.collection("offer_members").create<OfferMemberRecord>(place),
    onSuccess: () => refresh(queryClient, eventId),
    onError: () => {
      void refresh(queryClient, eventId);
    },
  });
}

/** Frees a place, given its id: the runner who has it may, and so may the owner of the offer and an admin. */
export function useLeavePlace(eventId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (memberId) => {
      await pb.collection("offer_members").delete(memberId);
    },
    onSuccess: () => refresh(queryClient, eventId),
    onError: () => {
      void refresh(queryClient, eventId);
    },
  });
}

/** Deletes an offer, and the places in it: its owner may, and so may an admin. */
export function useDeleteOffer(eventId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (offerId) => {
      await pb.collection("offers").delete(offerId);
    },
    onSuccess: () => refresh(queryClient, eventId),
    onError: () => {
      void refresh(queryClient, eventId);
    },
  });
}
