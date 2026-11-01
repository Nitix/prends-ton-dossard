import {
  keepPreviousData,
  skipToken,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from "@tanstack/react-query";

import { pb } from "../../lib/pb";
import type {
  EventRecord,
  InvitationKind,
  InvitationRecord,
  PasskeyRecord,
  Role,
} from "../../lib/types";
import { invalidateEvents } from "../events/api";
import { isStale } from "./errors";
import { toMembers, type ExpandedRunner, type Member } from "./memberState";
import type { MergeResult } from "./mergePreview";

/** The list of the members page. */
export const MEMBERS_KEY = ["admin", "members"] as const;

/**
 * Every runner with its account (`expand=user`: an admin reads the email, the
 * role and whether the account is disabled), and the invitations that were
 * not used. Which of them have expired is for `toMembers` to say, at the
 * instant the answer came.
 */
export function useMembers(): UseQueryResult<Member[]> {
  return useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: async () => {
      const [runners, invitations] = await Promise.all([
        pb.collection("runners").getFullList<ExpandedRunner>({ expand: "user" }),
        pb.collection("invitations").getFullList<InvitationRecord>({ filter: 'used_at = ""' }),
      ]);
      return toMembers(runners, invitations, Temporal.Now.instant());
    },
  });
}

/**
 * The passkeys of an account. The key is the one of the settings page, which
 * lists the passkeys of the signed-in user: the two share what they know when
 * an admin looks at their own.
 */
export function usePasskeys(userId: string): UseQueryResult<PasskeyRecord[]> {
  return useQuery({
    queryKey: ["passkeys", userId],
    queryFn: () =>
      pb.collection("passkeys").getFullList<PasskeyRecord>({
        filter: pb.filter("user = {:id}", { id: userId }),
        sort: "-created",
      }),
  });
}

/**
 * A link to give to somebody: where it leads, and until when. The URL holds
 * the token of the invitation in its fragment: it is only ever kept by the
 * dialog that shows it, never by a cache, a log or the address bar.
 */
export type ShareLink = { url: string; expiresAt: string };

/**
 * What the admin changes. Each action makes the screens that show its result
 * ask for it again, and resolves once they have, so that a dialog closes on a
 * page that is up to date. A refusal is thrown as the SDK gives it (see
 * `adminError`); when it says the page was out of date, the page is refreshed
 * before it goes on.
 */
export function useMemberActions() {
  const queryClient = useQueryClient();

  const refreshMembers = () => queryClient.invalidateQueries({ queryKey: MEMBERS_KEY });

  // The runners are also what the forms of the app choose from, and one of
  // them is the signed-in user's own.
  const refreshRunners = () =>
    Promise.all([
      refreshMembers(),
      queryClient.invalidateQueries({ queryKey: ["runners"] }),
      queryClient.invalidateQueries({ queryKey: ["runner"] }),
    ]);

  async function guarded<T>(request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (err) {
      if (isStale(err)) void refreshMembers();
      throw err;
    }
  }

  return {
    createRunner: async (name: string): Promise<void> => {
      await pb.collection("runners").create({ name });
      await refreshRunners();
    },

    renameRunner: async (id: string, name: string): Promise<void> => {
      await pb.collection("runners").update(id, { name });
      await refreshRunners();
    },

    /** The server refuses while the runner has participations. */
    deleteRunner: (id: string): Promise<void> =>
      guarded(async () => {
        await pb.collection("runners").delete(id);
        await refreshRunners();
      }),

    /**
     * Makes a link for a runner, which replaces the one waiting for it. An
     * invitation has the role the account will get; a reset has none.
     */
    createLink: (input: {
      runnerId: string;
      kind: InvitationKind;
      role?: Role;
    }): Promise<ShareLink> =>
      guarded(async () => {
        const link = await pb.send<ShareLink>("/api/app/invitations", {
          method: "POST",
          body: input,
        });
        // The list catches up while the link is on screen.
        void refreshMembers();
        return link;
      }),

    /** The link of an invitation that is waiting stops working. */
    revokeInvitation: (id: string): Promise<void> =>
      guarded(async () => {
        await pb.send(`/api/app/invitations/${encodeURIComponent(id)}`, { method: "DELETE" });
        await refreshMembers();
      }),

    /** The server refuses to take the role from the last active admin. */
    setRole: async (userId: string, role: Role): Promise<void> => {
      await pb.collection("users").update(userId, { role });
      await refreshMembers();
    },

    /** Disabling closes the sessions of the account; the server refuses for the last active admin. */
    setDisabled: async (userId: string, disabled: boolean): Promise<void> => {
      await pb.collection("users").update(userId, { disabled });
      await refreshMembers();
    },

    deletePasskey: async (userId: string, passkeyId: string): Promise<void> => {
      try {
        await pb.collection("passkeys").delete(passkeyId);
      } catch (err) {
        // Deleted elsewhere in the meantime: the list is out of date.
        if (isStale(err)) void queryClient.invalidateQueries({ queryKey: ["passkeys", userId] });
        throw err;
      }
      await queryClient.invalidateQueries({ queryKey: ["passkeys", userId] });
    },
  };
}

/**
 * What the admin changes in the race types. The forms of the events choose
 * from this list, so it is asked for again after each change; a rename also
 * changes what the events show of their formats, and resolves once the
 * screens on display have what the server holds. A refusal is thrown as the
 * SDK gives it (see `adminError`): a name that is taken (`validation_not_unique`
 * on `label`), a type that a format uses (`race_type_in_use`).
 */
export function useRaceTypeActions() {
  const queryClient = useQueryClient();

  const refreshTypes = () => queryClient.invalidateQueries({ queryKey: ["race_types"] });

  return {
    createType: async (label: string): Promise<void> => {
      await pb.collection("race_types").create({ label });
      await refreshTypes();
    },

    renameType: async (id: string, label: string): Promise<void> => {
      await pb.collection("race_types").update(id, { label });
      await Promise.all([
        refreshTypes(),
        queryClient.invalidateQueries({ queryKey: ["events"] }),
        queryClient.invalidateQueries({ queryKey: ["event"] }),
      ]);
    },

    /** The server refuses while a format uses the type. Whatever the refusal, the list may be out of date: it is read again. */
    deleteType: async (id: string): Promise<void> => {
      try {
        await pb.collection("race_types").delete(id);
      } catch (err) {
        void refreshTypes();
        throw err;
      }
      await refreshTypes();
    },
  };
}

/** What is merged: two events, or two formats of one event. */
export type MergeKind = "events" | "formats";

/** The record that stays, and the one that is merged into it, and deleted. */
export type MergeIds = { keepId: string; mergeId: string };

function mergeRequest(kind: MergeKind, ids: MergeIds, dryRun: boolean): Promise<MergeResult> {
  return pb.send<MergeResult>(`/api/app/admin/merge-${kind}`, {
    method: "POST",
    body: { keepId: ids.keepId, mergeId: ids.mergeId, dryRun },
  });
}

/**
 * The merges of the duplicates (admin only). `preview` asks the server what
 * a merge would do and writes nothing; `merge` does it. A refusal is thrown
 * as the SDK gives it (see `adminError`), and when it says that one of the two
 * is gone the screens that show events are asked to read them again.
 */
export function useMergeActions() {
  const queryClient = useQueryClient();

  async function guarded<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (err) {
      if (isStale(err)) {
        void queryClient.invalidateQueries({ queryKey: ["events"] });
        void queryClient.invalidateQueries({ queryKey: ["event"] });
      }
      throw err;
    }
  }

  return {
    preview: (kind: MergeKind, ids: MergeIds): Promise<MergeResult> =>
      guarded(() => mergeRequest(kind, ids, true)),

    /**
     * Merges for good. `eventId` is the event that holds the result: the kept
     * one for a merge of events, the one of the two formats for a merge of
     * formats. The merged event is gone, so its page is forgotten rather than
     * asked for again (the server would answer "not found").
     */
    merge: (kind: MergeKind, ids: MergeIds, eventId: string): Promise<MergeResult> =>
      guarded(async () => {
        const result = await mergeRequest(kind, ids, false);
        if (kind === "events") queryClient.removeQueries({ queryKey: ["event", ids.mergeId] });
        await Promise.all([
          invalidateEvents(queryClient, eventId),
          // The comments and the offers of the merged event moved to the one that stays: the
          // lists, and the latest comments of the home page, still name the one that is gone.
          ...(kind === "events"
            ? [
                queryClient.invalidateQueries({ queryKey: ["comments"] }),
                queryClient.invalidateQueries({ queryKey: ["offers"] }),
              ]
            : []),
        ]);
        return result;
      }),
  };
}

/** What the search asks of an event: enough to tell it from another (see `eventLabel`). */
export type FoundEvent = Pick<EventRecord, "id" | "name" | "location" | "start_date" | "end_date">;

/** The events a search for a name may offer: a few are enough, the admin types more of the name to narrow them. */
const MAX_FOUND = 8;

/**
 * The events whose name has `term`, the latest first, past or to come. The
 * term is bound as a parameter, never written into the filter. There is no
 * search while the term is empty. The key is under `["events"]`, so the
 * results are read again with the lists of events.
 */
export function useEventSearch(term: string): UseQueryResult<FoundEvent[]> {
  return useQuery({
    queryKey: ["events", "search", term],
    // The list stays while the next one loads, instead of blinking at each pause.
    placeholderData: keepPreviousData,
    queryFn:
      term === ""
        ? skipToken
        : async () => {
            const found = await pb.collection("events").getList<FoundEvent>(1, MAX_FOUND, {
              filter: pb.filter("name ~ {:q}", { q: term }),
              sort: "-start_date",
              fields: "id,name,location,start_date,end_date",
            });
            return found.items;
          },
  });
}
