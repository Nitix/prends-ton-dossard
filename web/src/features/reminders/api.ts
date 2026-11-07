import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";

import { pb } from "../../lib/pb";
import type { Reminder } from "../../lib/types";
import { useUserId } from "../auth/session";

// The reminders that the signed-in member chose: when to be warned before the
// registrations of a race open (see server/reminders). One choice serves the
// alarms of the calendar and the notifications.

const PATH = "/api/app/me/reminders";

type Answer = { reminders: Reminder[] };

/**
 * Where the choice is kept: under the account. The login page can be opened over
 * a session, and the next account must not find the choice of the previous one.
 */
function useRemindersKey() {
  return ["reminders", useUserId()] as const;
}

/**
 * The reminders of the member, "day" before "hour"; null when the server has
 * none to give (it answers 404: the demo has no reminders).
 */
export function useReminders(): UseQueryResult<Reminder[] | null> {
  const key = useRemindersKey();
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      try {
        return (await pb.send<Answer>(PATH, { method: "GET" })).reminders;
      } catch (err) {
        if (err instanceof ClientResponseError && err.status === 404) return null;
        throw err;
      }
    },
  });
}

/**
 * Replaces the choice of the member. What the server keeps (day before hour, no
 * duplicate) is what the reads see: it goes to the cache from the answer, after
 * a read that was on its way is cancelled, as it would bring the old choice back.
 * A refusal leaves the cache as it was.
 */
export function useSaveReminders(): UseMutationResult<Reminder[], Error, Reminder[]> {
  const queryClient = useQueryClient();
  const key = useRemindersKey();
  return useMutation({
    mutationFn: async (reminders) =>
      (await pb.send<Answer>(PATH, { method: "PUT", body: { reminders } })).reminders,
    onSuccess: async (reminders) => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData<Reminder[] | null>(key, reminders);
    },
  });
}
