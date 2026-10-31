import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { isAdminSession, isPublicPath, restoreSession, safeRedirect } from "./session";

const mocks = vi.hoisted(() => ({
  isValid: true,
  record: null as { collectionName: string; role: string } | null,
  authRefresh: vi.fn<() => Promise<unknown>>(),
  clear: vi.fn<() => void>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get isValid() {
        return mocks.isValid;
      },
      get record() {
        return mocks.record;
      },
      clear: mocks.clear,
    },
    collection: () => ({ authRefresh: mocks.authRefresh }),
  },
}));

beforeEach(() => {
  mocks.isValid = true;
  mocks.record = null;
  mocks.authRefresh.mockReset();
  mocks.clear.mockReset();
});

function answer(status: number) {
  return new ClientResponseError({ status, response: { status, message: "no", data: {} } });
}

describe("restoreSession", () => {
  test("keeps the session when the server accepts the token", async () => {
    mocks.authRefresh.mockResolvedValue({});

    await restoreSession();

    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  test.each([400, 401, 403, 404])("clears the store when the server answers %i", async (status) => {
    mocks.authRefresh.mockRejectedValue(answer(status));

    await restoreSession();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  test("does not ask the server about a token that is missing or expired", async () => {
    mocks.isValid = false;

    await restoreSession();

    expect(mocks.authRefresh).not.toHaveBeenCalled();
    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  // Opening the app offline must not sign anybody out: only an answer of the
  // server decides that the session is over.
  test("keeps the session when the server cannot be reached", async () => {
    mocks.authRefresh.mockRejectedValue(
      new ClientResponseError({ status: 0, originalError: new TypeError("Failed to fetch") }),
    );

    await restoreSession();

    expect(mocks.clear).not.toHaveBeenCalled();
  });

  test.each([429, 500, 502, 503])(
    "keeps the session when the server answers %i",
    async (status) => {
      mocks.authRefresh.mockRejectedValue(answer(status));

      await restoreSession();

      expect(mocks.clear).not.toHaveBeenCalled();
    },
  );
});

describe("isAdminSession", () => {
  test("is true for a signed-in admin", () => {
    mocks.record = { collectionName: "users", role: "admin" };

    expect(isAdminSession()).toBe(true);
  });

  test("is false for a member", () => {
    mocks.record = { collectionName: "users", role: "member" };

    expect(isAdminSession()).toBe(false);
  });

  test("is false when nobody is signed in", () => {
    expect(isAdminSession()).toBe(false);
  });

  test("is false for a record that is not of a user, whatever its role", () => {
    mocks.record = { collectionName: "_superusers", role: "admin" };

    expect(isAdminSession()).toBe(false);
  });
});

describe("isPublicPath", () => {
  test.each(["/connexion", "/invitation"])("%s needs no session", (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  test.each(["/", "/liste", "/admin/membres", "/connexion-x", "/invitations", "/x/connexion"])(
    "%s needs a session",
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe("safeRedirect", () => {
  test.each([
    ["/agenda", "/agenda"],
    ["/liste?personne=moi&periode=passees", "/liste?personne=moi&periode=passees"],
    ["/evenements/abc#notes", "/evenements/abc#notes"],
    ["/", "/"],
  ])("keeps the path %s", (input, expected) => {
    expect(safeRedirect(input)).toBe(expected);
  });

  test.each([
    undefined,
    "",
    "agenda",
    "//evil.example",
    "/\\evil.example",
    "https://evil.example",
    "javascript:alert(1)",
  ])("sends %s to the home page", (input) => {
    expect(safeRedirect(input)).toBe("/");
  });
});
