import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import type { Lang } from "../../i18n/detect";
import { pb } from "../../lib/pb";

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

const calendarKey = ["calendar"] as const;

/** Whether the member has a calendar link. */
export function useCalendarStatus(): UseQueryResult<CalendarStatus> {
  return useQuery({
    queryKey: calendarKey,
    queryFn: () => pb.send<CalendarStatus>(PATH, { method: "GET" }),
  });
}

/**
 * Makes a link, in the language of the texts of the calendar (`lang`), which
 * replaces the one the member has: that one stops working. The address is in the
 * answer, and the status takes it from there, so that it is never the old one.
 */
export function useCreateCalendar(): UseMutationResult<{ url: string }, Error, Lang> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lang) => pb.send<{ url: string }>(PATH, { method: "POST", body: { lang } }),
    onSuccess: ({ url }) => {
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: true, url });
    },
  });
}

/** Deletes the link of the member: the calendar apps that had it stop being fed. */
export function useDeleteCalendar(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await pb.send(PATH, { method: "DELETE" });
    },
    onSuccess: () => {
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: false, url: "" });
    },
  });
}
