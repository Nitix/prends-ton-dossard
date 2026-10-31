import { ClientResponseError } from "pocketbase";
import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { adminError, isStale } from "./errors";

/** What the SDK throws for an API answer with this body. */
function apiError(status: number, data: unknown): ClientResponseError {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

describe("adminError", () => {
  test("une limite de débit (429) a un message à elle, dans les deux langues", () => {
    expect(adminError(fr, apiError(429, {}))).toBe(fr.admin.rateLimited);
    expect(adminError(en, apiError(429, {}))).toBe(en.admin.rateLimited);
  });

  test("invitation_kind_mismatch dit que le compte a changé, pas qu'un lien est invalide", () => {
    expect(adminError(fr, apiError(400, { code: "invitation_kind_mismatch" }))).toBe(
      fr.admin.kindMismatch,
    );
  });

  test("les autres codes ont le message de leur code", () => {
    expect(adminError(fr, apiError(400, { code: "last_admin" }))).toBe(fr.errors.last_admin);
    expect(adminError(fr, apiError(400, { code: "runner_has_participations" }))).toBe(
      fr.errors.runner_has_participations,
    );
    expect(adminError(fr, apiError(400, { name: { code: "validation_not_unique" } }))).toBe(
      fr.errors.validation_not_unique,
    );
  });

  test("un échec sans code, réseau compris, a le message générique", () => {
    expect(adminError(fr, apiError(500, {}))).toBe(fr.errors.generic);
    expect(adminError(fr, new ClientResponseError(new TypeError("Failed to fetch")))).toBe(
      fr.errors.generic,
    );
    expect(adminError(fr, new Error("boom"))).toBe(fr.errors.generic);
  });
});

describe("isStale", () => {
  test("un compte qui a changé ou un enregistrement disparu : la liste est à refaire", () => {
    expect(isStale(apiError(400, { code: "invitation_kind_mismatch" }))).toBe(true);
    expect(isStale(apiError(404, { code: "not_found" }))).toBe(true);
  });

  test("les autres refus ne disent rien de l'état de la liste", () => {
    expect(isStale(apiError(400, { code: "last_admin" }))).toBe(false);
    expect(isStale(apiError(429, {}))).toBe(false);
    expect(isStale(new Error("boom"))).toBe(false);
  });
});
