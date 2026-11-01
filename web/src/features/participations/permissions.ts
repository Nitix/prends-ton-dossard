import type { EventRecord, ParticipationRecord, RunnerRecord } from "../../lib/types";

// What the matrix of section 6.1 of the design lets a member do. The server
// applies these rules; the front end only uses them to hide the actions that
// would be refused.

/** The signed-in user: their account, their runner, and whether they are an admin. */
export type Me = { userId: string; runnerId: string; isAdmin: boolean };

/** Whether the runner is the one of the user: a runner with no account is nobody's. */
function isMine(runner: RunnerRecord, me: Me): boolean {
  return !!runner.user && runner.user === me.userId;
}

/**
 * Changing or removing a participation: the admin may, so may the runner it
 * is about, and so may anybody while the runner has not confirmed it.
 */
export function canEditParticipation(
  participation: ParticipationRecord,
  runner: RunnerRecord,
  me: Me,
): boolean {
  return me.isAdmin || isMine(runner, me) || !participation.confirmed;
}

/** Confirming a participation: only the runner it is about, the admin included. */
export function canConfirm(runner: RunnerRecord, me: Me): boolean {
  return isMine(runner, me);
}

/** Deleting an event: the member who created it, or an admin. */
export function canDeleteEvent(event: EventRecord, me: Me): boolean {
  return event.created_by === me.runnerId || me.isAdmin;
}

/** Editing a comment: its author, nobody else, the admin included. */
export function canEditComment(author: RunnerRecord, me: Me): boolean {
  return isMine(author, me);
}

/** Deleting a comment: its author, or an admin. */
export function canDeleteComment(author: RunnerRecord, me: Me): boolean {
  return isMine(author, me) || me.isAdmin;
}

/** Changing or deleting an offer, or placing someone in it: its owner, or an admin. */
export function canManageOffer(owner: RunnerRecord, me: Me): boolean {
  return isMine(owner, me) || me.isAdmin;
}

/**
 * Freeing a place in an offer: the runner who has it (for themselves), the
 * owner of the offer (who places whoever they want, and takes them out), or an
 * admin.
 */
export function canRemoveMember(member: RunnerRecord, owner: RunnerRecord, me: Me): boolean {
  return isMine(member, me) || canManageOffer(owner, me);
}
