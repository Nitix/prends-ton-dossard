import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";

import { pb } from "../../lib/pb";
import type { ParticipationRecord, Status } from "../../lib/types";
import { invalidateEvents } from "../events/api";

/** Every status, in the order they are offered: from the plan to the result. */
export const STATUSES: readonly Status[] = ["interested", "registered", "finished", "dnf", "dns"];

/**
 * Adds a runner to a format. Anybody may, for any runner: the server tells who
 * added it (`added_by`) and whether it is confirmed (it is when the runner is
 * the one who adds it), so neither is sent.
 */
export function createParticipation(input: {
  runner: string;
  format: string;
  status: Status;
}): Promise<ParticipationRecord> {
  return pb.collection("participations").create<ParticipationRecord>(input);
}

/**
 * Changes a participation: its status, its format (of the same event), or
 * confirms it (`confirmed: true`, which only its runner may do). The runner
 * of a participation is never changed.
 */
export function updateParticipation(
  id: string,
  patch: { status?: Status; format?: string; confirmed?: true },
): Promise<ParticipationRecord> {
  return pb.collection("participations").update<ParticipationRecord>(id, patch);
}

export async function deleteParticipation(id: string): Promise<void> {
  await pb.collection("participations").delete(id);
}

// The hooks below run a request, then make the screens that show an event
// ask for it again (the lists, the page of the event, the "to confirm" block
// of the home page). The mutation lasts until they have the new data, so that
// a dialog closes on a page that is up to date.

/** `eventId` is the event of the participation, whose page has to be refreshed. */
export function useCreateParticipation(
  eventId: string,
): UseMutationResult<ParticipationRecord, Error, Parameters<typeof createParticipation>[0]> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createParticipation,
    onSuccess: () => invalidateEvents(queryClient, eventId),
  });
}

export function useUpdateParticipation(
  eventId: string,
): UseMutationResult<
  ParticipationRecord,
  Error,
  { id: string; patch: Parameters<typeof updateParticipation>[1] }
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }) => updateParticipation(id, patch),
    onSuccess: () => invalidateEvents(queryClient, eventId),
  });
}

export function useDeleteParticipation(eventId: string): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteParticipation,
    onSuccess: () => invalidateEvents(queryClient, eventId),
  });
}
