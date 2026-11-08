import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";

import type { Lang } from "../../i18n/detect";
import { pb } from "../../lib/pb";
import { useUserId } from "../auth/session";

// The calendar links of the signed-in member: addresses that a calendar app
// subscribes to. There are two kinds (the scope): "mine", the races of the member,
// and "group", every race where somebody goes, with who. A member has one of each,
// and acting on one does not touch the other. The server keeps the token of a link,
// so it says the address each time it is asked, except for a link made before it
// kept the token (v3): that one works, and its address is empty.
//
// The links of the group give the names of the members: they are as secret as the
// personal ones, and are handled the same way (never in a log or a URL of the page).

const PATH = "/api/app/calendar";

/** The kind of link: the races of the member, or the races of the group. */
export type CalendarScope = "mine" | "group";

/**
 * Whether the member has a link, and its address: empty when there is no link,
 * and when the link is a v3 one, whose address cannot be shown.
 */
export type CalendarStatus = { exists: boolean; url: string };

/**
 * Where the status of a link is kept: under the account and the scope, since it
 * holds the secret address of the link. The login page can be opened over a
 * session, and the next account must not find (or be shown) the address of the
 * previous one.
 */
function useCalendarKey(scope: CalendarScope) {
  return ["calendar", useUserId(), scope] as const;
}

/**
 * The query of a request for a kind of link: the personal one has none (it is
 * what the server answers without a scope), the group one names its scope.
 */
function queryOf(scope: CalendarScope): { scope: "group" } | undefined {
  return scope === "group" ? { scope } : undefined;
}

/**
 * Whether the member has a link of that kind; null when the server has none of
 * that kind to give (it answers 404: the demo has no link of the group).
 */
export function useCalendarStatus(
  scope: CalendarScope = "mine",
): UseQueryResult<CalendarStatus | null> {
  const calendarKey = useCalendarKey(scope);
  return useQuery({
    queryKey: calendarKey,
    queryFn: async () => {
      try {
        return await pb.send<CalendarStatus>(PATH, { method: "GET", query: queryOf(scope) });
      } catch (err) {
        if (scope === "group" && err instanceof ClientResponseError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
  });
}

/**
 * Makes a link of that kind, in the language of the texts of the calendar
 * (`lang`), which replaces the one of that kind the member has: that one stops
 * working. The address is in the answer, and the status takes it from there, so
 * that it is never the old one: a read of the status that is on its way (the
 * window was focused again, say) was started before the change and would bring
 * the old address back, so it is cancelled first.
 */
export function useCreateCalendar(
  scope: CalendarScope = "mine",
): UseMutationResult<{ url: string }, Error, Lang> {
  const queryClient = useQueryClient();
  const calendarKey = useCalendarKey(scope);
  return useMutation({
    mutationFn: (lang) =>
      pb.send<{ url: string }>(PATH, {
        method: "POST",
        body: scope === "group" ? { lang, scope } : { lang },
      }),
    onSuccess: async ({ url }) => {
      await queryClient.cancelQueries({ queryKey: calendarKey });
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: true, url });
    },
  });
}

/**
 * Deletes the link of that kind of the member: the calendar apps that had it stop
 * being fed. A read of the status that is on its way is cancelled first, as for a
 * new link: it would bring the link that is gone back.
 */
export function useDeleteCalendar(
  scope: CalendarScope = "mine",
): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient();
  const calendarKey = useCalendarKey(scope);
  return useMutation({
    mutationFn: async () => {
      await pb.send(PATH, { method: "DELETE", query: queryOf(scope) });
    },
    onSuccess: async () => {
      await queryClient.cancelQueries({ queryKey: calendarKey });
      queryClient.setQueryData<CalendarStatus>(calendarKey, { exists: false, url: "" });
    },
  });
}
