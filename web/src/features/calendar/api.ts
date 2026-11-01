import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Lang } from "../../i18n/detect";
import { pb } from "../../lib/pb";
import { useUserId } from "../auth/session";

// The calendar link of the signed-in member: an address that a calendar app
// subscribes to. The server keeps its token, so it says the address each time it
// is asked, except for a link made before it kept the token (v3): that one works,
// and its address is empty.

const PATH = "/api/app/calendar";

/**
 * Whether the member has a link, and its address: empty when there is no link,
 * and when the link is a v3 one, whose address cannot be shown.
 */
export type CalendarStatus = { exists: boolean; url: string };

/**
 * Where the status is kept: under the account, since it holds the secret address
 * of the link. The login page can be opened over a session, and the next account
 * must not find (or be shown) the address of the previous one.
 */
function useCalendarKey() {
  return ["calendar", useUserId()] as const;
}

/** Whether the member has a calendar link. */
export function useCalendarStatus(): UseQueryResult<CalendarStatus> {
  const calendarKey = useCalendarKey();
  return useQuery({
    queryKey: calendarKey,
    queryFn: () => pb.send<CalendarStatus>(PATH, { method: "GET" }),
  });
}

/**
 * Makes a link, in the language of the texts of the calendar (`lang`), which
 * replaces the one the member has: that one stops working. The address is in the
 * answer, and the status takes it from there, so that it is never the old one:
 * a read of the status that is on its way (the window was focused again, say)
 * was started before the change and would bring the old address back, so it is
 * cancelled first.
 */
export function useCreateCalendar(): UseMutationResult<{ url: string }, Error, Lang> {
  const queryClient = useQueryClient();
  const calendarKey = useCalendarKey();
  return useMutation({
    mutationFn: (lang) => pb.send<{ url: string }>(PATH, { method: "POST", body: { lang } }),
    onSuccess: async ({ url }) => {
      await queryClient.cancelQueries({ queryKey: calendarKey });
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: true, url });
    },
  });
}

/**
 * Deletes the link of the member: the calendar apps that had it stop being fed.
 * A read of the status that is on its way is cancelled first, as for a new link:
 * it would bring the link that is gone back.
 */
export function useDeleteCalendar(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const calendarKey = useCalendarKey();
  return useMutation({
    mutationFn: async () => {
      await pb.send(PATH, { method: "DELETE" });
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: calendarKey });
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: false, url: "" });
    },
  });
}
