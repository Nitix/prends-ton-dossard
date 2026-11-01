import { ClientResponseError } from "pocketbase";

import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";

/**
 * The record is not there any more: somebody else deleted it, or changed it so
 * that it is another record (a participation on the event alone that someone
 * puts on a format is not the same one any more), or its event or its format
 * is gone with it.
 */
export function isNotFound(err: unknown): boolean {
  return err instanceof ClientResponseError && err.status === 404;
}

/**
 * The message for a refused request on a participation. The server's validation
 * says `validation_not_unique` when the runner is already on the format, which
 * "This value is already used" does not make clear: that case has its own text.
 * A participation that is not there any more (`isNotFound`) says so, which the
 * 404 of PocketBase has no code for. Any other refusal, a network failure
 * included, gets the message of its code.
 */
export function participationError(t: Messages, err: unknown): string {
  if (isNotFound(err)) return t.errors.not_found;
  const code = errorCode(err) ?? Object.values(fieldErrors(err))[0];
  return code === "validation_not_unique" ? t.participation.alreadyThere : translateError(t, code);
}
