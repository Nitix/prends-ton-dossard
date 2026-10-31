import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";

/** A refusal of the server: what went wrong, and the field to show it under, if any. */
export type Failure<Field extends string> = { code: string | undefined; field: Field | null };

/**
 * Tells what the server refused, and where to show it. A route answers with
 * a `{code}`, and a few codes belong to one field (`byCode`). The validation
 * of a record answers with a code per field instead; the first of `fields`
 * it names gets the message. Anything else, a network failure included, has
 * no code, hence the generic message.
 */
export function failureOf<Field extends string>(
  err: unknown,
  fields: readonly Field[],
  byCode: Readonly<Record<string, Field>> = {},
): Failure<Field> {
  const code = errorCode(err);
  if (code !== undefined) {
    return { code, field: Object.hasOwn(byCode, code) ? (byCode[code] ?? null) : null };
  }
  for (const [name, fieldCode] of Object.entries(fieldErrors(err))) {
    const field = fields.find((candidate) => candidate === name);
    if (field !== undefined) return { code: fieldCode, field };
  }
  return { code: undefined, field: null };
}

/** The message for an error that is not shown under a field: its code, or the code of its first field. */
export function describeError(t: Messages, err: unknown): string {
  return translateError(t, errorCode(err) ?? Object.values(fieldErrors(err))[0]);
}

/** The value of a text field of a submitted form: empty when it is missing. */
export function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}
