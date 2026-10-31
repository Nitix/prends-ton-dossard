import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";

import { pb } from "../../lib/pb";
import type { InvitationKind, InvitationRecord, PasskeyRecord, Role } from "../../lib/types";
import { isStale } from "./errors";
import { toMembers, type ExpandedRunner, type Member } from "./memberState";

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
 * The passkeys of an account. The key is the one of the profile page, which
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
