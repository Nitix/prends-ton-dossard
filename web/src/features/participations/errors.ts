import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";

/**
 * The message for a refused request on a participation. The server's validation
 * says `validation_not_unique` when the runner is already on the format, which
 * "This value is already used" does not make clear: that case has its own text.
 * Any other refusal, a network failure included, gets the message of its code.
 */
export function participationError(t: Messages, err: unknown): string {
  const code = errorCode(err) ?? Object.values(fieldErrors(err))[0];
  return code === "validation_not_unique" ? t.participation.alreadyThere : translateError(t, code);
}
