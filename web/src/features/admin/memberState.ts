import { PARIS } from "../../lib/dates";
import type { InvitationRecord, RunnerRecord, UserRecord } from "../../lib/types";

// What the admin page knows of a runner: whether it has an account, and if
// not, whether an invitation is waiting for it. `Temporal` is only touched
// inside functions, never at module scope (see lib/temporal.ts).

/**
 * Where a runner stands:
 * - `no_account`: nobody signs in as this runner, and no invitation is waiting;
 * - `invited`: an invitation that has neither been used nor expired is waiting;
 * - `active`: the runner has an account;
 * - `disabled`: the runner has an account that an admin turned off.
 */
export type MemberState = "no_account" | "invited" | "active" | "disabled";

/**
 * The instant of a date-time: PocketBase's (`2026-11-07 12:00:00.000Z`, with a
 * space) or an RFC 3339 one (`2026-11-07T12:00:00Z`, as the route of the
 * invitations answers).
 */
function instantOf(dateTime: string): Temporal.Instant {
  return Temporal.Instant.from(dateTime.replace(" ", "T"));
}

/** The day, in Paris, an invitation expires: the page shows the day, not the hour. */
export function expiryDay(expiresAt: string): Temporal.PlainDate {
  return instantOf(expiresAt).toZonedDateTimeISO(PARIS).toPlainDate();
}

/**
 * Whether an invitation can still be used. PocketBase sends `used_at` empty
 * for an invitation that was not used; the invitation expires at its
 * `expires_at`, which is itself too late.
 */
function isPending(invitation: InvitationRecord, now: Temporal.Instant): boolean {
  return !invitation.used_at && Temporal.Instant.compare(instantOf(invitation.expires_at), now) > 0;
}

/**
 * The state of a runner. `user` is its account, if it has one; `pending` is
 * the invitation to look at, if there is one (its own, which may well be used
 * or expired by now: only one that can still be used counts). An account is
 * what a runner is: an invitation left waiting beside it does not change that.
 */
export function memberState(
  runner: RunnerRecord,
  user: UserRecord | undefined,
  pending: InvitationRecord | undefined,
  now: Temporal.Instant,
): MemberState {
  if (user) return user.disabled ? "disabled" : "active";
  return pending && pending.runner === runner.id && isPending(pending, now)
    ? "invited"
    : "no_account";
}

/** A runner of the list, with what the page needs to show it. */
export type Member = {
  runner: RunnerRecord;
  user: UserRecord | undefined;
  state: MemberState;
  /** The invitation that is waiting, for a runner who is `invited`. */
  invitation: InvitationRecord | undefined;
  /** The link to choose a new password that is waiting, for a runner who has an account. */
  reset: InvitationRecord | undefined;
};

/**
 * A runner with its account expanded (`expand=user`): the key is left out when
 * there is none. An admin may read every account, so a runner that has one
 * always comes with it; one whose account is missing counts as having none.
 */
export type ExpandedRunner = RunnerRecord & { expand?: { user?: UserRecord } };

/** Of the invitations that are waiting, the one that is valid the longest. */
function latestPending(
  invitations: InvitationRecord[],
  runnerId: string,
  kind: InvitationRecord["kind"],
  now: Temporal.Instant,
): InvitationRecord | undefined {
  return invitations
    .filter((i) => i.runner === runnerId && i.kind === kind && isPending(i, now))
    .toSorted((a, b) => Temporal.Instant.compare(instantOf(b.expires_at), instantOf(a.expires_at)))
    .at(0);
}

/** The runners by name, each with its account, its state, and the links that are waiting for it. */
export function toMembers(
  runners: ExpandedRunner[],
  invitations: InvitationRecord[],
  now: Temporal.Instant,
): Member[] {
  return runners
    .map((runner): Member => {
      const user = runner.expand?.user;
      const invite = user ? undefined : latestPending(invitations, runner.id, "invite", now);
      const state = memberState(runner, user, invite, now);
      return {
        runner,
        user,
        state,
        invitation: state === "invited" ? invite : undefined,
        reset: user ? latestPending(invitations, runner.id, "reset", now) : undefined,
      };
    })
    .toSorted((a, b) => a.runner.name.localeCompare(b.runner.name));
}
