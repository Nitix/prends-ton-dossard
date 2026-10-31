import { ClientResponseError } from "pocketbase";

import { errorCode } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";
import { describeError } from "../profile/forms";

/**
 * The codes that tell the admin that the list on screen is not what the server
 * holds any more: a runner that has got an account since (it is no longer
 * invited, nor deleted), a record that is gone.
 */
const STALE_CODES = new Set(["invitation_kind_mismatch", "not_found", "runner_has_account"]);

/** Whether the server refused because the page shows something that has changed: a runner who got an account, a link that was used... */
export function isStale(err: unknown): boolean {
  const code = errorCode(err);
  return code !== undefined && STALE_CODES.has(code);
}

/**
 * The message for a refusal in the admin pages. Two refusals have a text of
 * their own here:
 * - the server limits how often links are made (a 429, with no code of its
 *   own, which PocketBase answers to a client that asks too often);
 * - `invitation_kind_mismatch` says "this link can't be used", which is what
 *   the person who opens a link needs to hear, not an admin: for them it
 *   means the account of the runner changed since the list was drawn.
 *
 * Any other refusal, a network failure included, gets the message of its code.
 */
export function adminError(t: Messages, err: unknown): string {
  if (err instanceof ClientResponseError && err.status === 429) return t.admin.rateLimited;
  if (errorCode(err) === "invitation_kind_mismatch") return t.admin.kindMismatch;
  return describeError(t, err);
}
