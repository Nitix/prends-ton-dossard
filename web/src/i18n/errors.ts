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
  "registration_opening_after_start",
  "registration_opening_after_deadline",
  "format_date_month",
  "month_start_invalid",
  "format_date_out_of_range",
  "format_other_event",
  "format_measure_required",
  "price_invalid",
  "format_required",
  "status_before_race",
  "supporter_with_format",
  "rank_above_total",
  "offer_seats_required",
  "offer_seats_below_members",
  "offer_full",
  "offer_owner_member",
  "offer_already_member",
  "time_invalid",
  "merge_same_record",
  "merge_formats_different_events",
  "not_found",
  "forbidden",
  "passkey_failed",
  "passkey_session_expired",
  "account_disabled",
  "token_invalid",
  "token_limit",
  "upload_invalid",
  "push_endpoint_invalid",
  "push_unavailable",
  "weather_unavailable",
  "validation_required",
  "validation_not_unique",
  "validation_invalid_email",
  "validation_invalid_url",
  "validation_invalid_old_password",
  "validation_min_text_constraint",
  "validation_max_text_constraint",
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

/** The message of a code, or undefined when there is none for it. */
function messageOf(t: Messages, code: string | undefined): string | undefined {
  const messages: Readonly<Record<string, string>> = t.errors;
  return code !== undefined && Object.hasOwn(messages, code) ? messages[code] : undefined;
}

/** The message for a code, in the language of `t`. An unknown code gets the generic message. */
export function translateError(t: Messages, code: string | undefined): string {
  return messageOf(t, code) ?? t.errors.generic;
}

/**
 * The message for the code of a field, or undefined when the front end has no
 * words for it. Most codes say the same whatever the field is; the two refusals
 * of a file say what the file is for: the photo of a runner (`errors`) is not
 * the GPX track of a format (`gpx`).
 */
export function fieldMessage(
  t: Messages,
  field: string,
  code: string | undefined,
): string | undefined {
  if (field === "gpx") {
    if (code === "validation_invalid_mime_type") return t.format.gpxNotGpx;
    if (code === "validation_file_size_limit") return t.format.gpxTooBig;
  }
  return messageOf(t, code);
}

/** Like `fieldMessage`, with the generic message for a code that has none. */
export function translateFieldError(t: Messages, field: string, code: string | undefined): string {
  return fieldMessage(t, field, code) ?? t.errors.generic;
}
