import { ClientResponseError } from "pocketbase";

import type { Messages } from "./fr";

/**
 * Every error code the front end has a message for: the server's own codes,
 * listed in server/apperr/codes.go (errors.test.ts checks that this list
 * matches that file), plus the codes PocketBase gives to the validation of a
 * field.
 */
export const ERROR_CODES: readonly string[] = [
  "invitation_invalid",
  "invitation_kind_mismatch",
  "email_taken",
  "email_invalid",
  "wrong_password",
  "password_too_short",
  "password_mismatch",
  "last_admin",
  "runner_has_participations",
  "runner_has_account",
  "race_type_in_use",
  "date_invalid",
  "end_before_start",
  "registration_deadline_after_start",
  "format_date_out_of_range",
  "format_other_event",
  "format_measure_required",
  "price_invalid",
  "format_required",
  "supporter_with_format",
  "merge_same_record",
  "merge_formats_different_events",
  "not_found",
  "forbidden",
  "passkey_failed",
  "passkey_session_expired",
  "account_disabled",
  "validation_required",
  "validation_not_unique",
  "validation_invalid_email",
  "validation_invalid_old_password",
  "validation_min_text_constraint",
  "validation_values_mismatch",
  "validation_file_size_limit",
  "validation_invalid_mime_type",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * The `data` of the body of an API error, or undefined for any other error
 * (and for a network failure, whose body is empty). Its shape depends on who
 * answered:
 * - a custom route gives `{code}`;
 * - the validation of a record gives `{<field>: {code, message}}`.
 */
function bodyData(err: unknown): Record<string, unknown> | undefined {
  if (!(err instanceof ClientResponseError)) return undefined;
  const data: unknown = err.response.data;
  return isRecord(data) ? data : undefined;
}

/** The code a custom route answered with, if the error has one. */
export function errorCode(err: unknown): string | undefined {
  const code = bodyData(err)?.code;
  return typeof code === "string" ? code : undefined;
}

/** The code of each field the server found invalid, by field name. */
export function fieldErrors(err: unknown): Record<string, string> {
  const codes: [string, string][] = [];
  for (const [field, detail] of Object.entries(bodyData(err) ?? {})) {
    if (isRecord(detail) && typeof detail.code === "string") {
      codes.push([field, detail.code]);
    }
  }
  return Object.fromEntries(codes);
}

/** The message for a code, in the language of `t`. An unknown code gets the generic message. */
export function translateError(t: Messages, code: string | undefined): string {
  const messages: Readonly<Record<string, string>> = t.errors;
  const message = code !== undefined && Object.hasOwn(messages, code) ? messages[code] : undefined;
  return message ?? t.errors.generic;
}
