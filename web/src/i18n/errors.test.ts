import { readFileSync } from "node:fs";

import { ClientResponseError } from "pocketbase";
import { describe, expect, test } from "vitest";

import { en } from "./en";
import { ERROR_CODES, errorCode, fieldErrors, translateError } from "./errors";
import { fr } from "./fr";

// The server's own list of codes: the front end must know every one of them.
const codesFile = new URL("../../../server/apperr/codes.go", import.meta.url);
const serverCodes = [...readFileSync(codesFile, "utf8").matchAll(/= "([a-z_]+)"/g)].flatMap(
  (match) => match[1] ?? [],
);

const sorted = (codes: readonly string[]) => codes.toSorted((a, b) => a.localeCompare(b));

const POCKETBASE_CODES = [
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

/** What the SDK throws for an API answer with this body. */
function apiError(status: number, data: unknown): ClientResponseError {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

describe("ERROR_CODES", () => {
  test("the server file has codes to read", () => {
    expect(serverCodes.length).toBeGreaterThan(0);
  });

  test("is exactly the server codes plus the PocketBase validation codes", () => {
    expect(sorted(ERROR_CODES)).toEqual(sorted([...serverCodes, ...POCKETBASE_CODES]));
  });

  test.each([
    { lang: "fr", errors: fr.errors },
    { lang: "en", errors: en.errors },
  ])("every code has a message in $lang", ({ errors }) => {
    const messages: Readonly<Record<string, string>> = errors;
    const missing = ERROR_CODES.filter((code) => !messages[code]);
    expect(missing).toEqual([]);
  });

  test.each([
    { lang: "fr", errors: fr.errors },
    { lang: "en", errors: en.errors },
  ])("there is a generic message in $lang", ({ errors }) => {
    expect(errors.generic).toBeTruthy();
  });
});

describe("translateError", () => {
  test("translates a known code", () => {
    expect(translateError(fr, "email_taken")).toBe(fr.errors.email_taken);
    expect(translateError(en, "email_taken")).toBe(en.errors.email_taken);
  });

  test("falls back to the generic message for an unknown code", () => {
    expect(translateError(fr, "nope")).toBe(fr.errors.generic);
    expect(translateError(en, "nope")).toBe(en.errors.generic);
  });

  test("falls back to the generic message when there is no code", () => {
    expect(translateError(fr, undefined)).toBe(fr.errors.generic);
  });

  test("does not mistake an inherited property for a code", () => {
    expect(translateError(fr, "toString")).toBe(fr.errors.generic);
    expect(translateError(fr, "__proto__")).toBe(fr.errors.generic);
  });

  test("explains an expired invitation", () => {
    expect(translateError(fr, "invitation_invalid")).toBe(
      "Ce lien a expiré ou a déjà été utilisé. Demande-en un nouveau à l'admin.",
    );
  });
});

describe("errorCode", () => {
  test("reads the code of a custom route error", () => {
    expect(errorCode(apiError(400, { code: "email_taken" }))).toBe("email_taken");
  });

  test("is undefined when the body has no code", () => {
    expect(errorCode(apiError(500, {}))).toBeUndefined();
    expect(errorCode(apiError(400, { email: { code: "validation_required" } }))).toBeUndefined();
  });

  test("is undefined for a network failure", () => {
    expect(errorCode(new ClientResponseError(new TypeError("Failed to fetch")))).toBeUndefined();
  });

  test("is undefined for anything that is not an API error", () => {
    expect(errorCode(new Error("boom"))).toBeUndefined();
    expect(errorCode("email_taken")).toBeUndefined();
    expect(errorCode(null)).toBeUndefined();
    expect(errorCode(undefined)).toBeUndefined();
  });

  test("ignores a code that is not a string", () => {
    expect(errorCode(apiError(400, { code: 42 }))).toBeUndefined();
  });
});

describe("fieldErrors", () => {
  test("maps each invalid field to its code", () => {
    const err = apiError(400, {
      email: { code: "validation_invalid_email", message: "Must be a valid email address." },
      end_date: { code: "end_before_start", message: "end_before_start" },
    });
    expect(fieldErrors(err)).toEqual({
      email: "validation_invalid_email",
      end_date: "end_before_start",
    });
  });

  test("skips the entries that have no code", () => {
    const err = apiError(400, {
      name: { message: "Something is wrong." },
      date: { code: "date_invalid" },
    });
    expect(fieldErrors(err)).toEqual({ date: "date_invalid" });
  });

  test("is empty for a custom route error, whose code is not a field", () => {
    expect(fieldErrors(apiError(400, { code: "email_taken" }))).toEqual({});
  });

  test("is empty for anything that is not an API error", () => {
    expect(fieldErrors(new Error("boom"))).toEqual({});
    expect(fieldErrors(undefined)).toEqual({});
    expect(fieldErrors(new ClientResponseError(new TypeError("Failed to fetch")))).toEqual({});
  });
});
