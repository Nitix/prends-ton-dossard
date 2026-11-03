import { ClientResponseError } from "pocketbase";
import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  SESSION_CHECK_INTERVAL_MS,
  isAdminSession,
  isPublicPath,
  restoreSession,
  safeRedirect,
  sessionCheck,
} from "./session";

const mocks = vi.hoisted(() => ({
  token: "a-token",
  isValid: true,
  record: null as { id?: string; collectionName: string; role: string } | null,
  authRefresh: vi.fn<() => Promise<unknown>>(),
  clear: vi.fn<() => void>(),
}));

/** The skin of the account, put in agreement with the device's: its own tests are accountSkin.test.ts. */
const skin = vi.hoisted(() => ({
  sync: vi.fn<(user: { id?: string }) => Promise<void>>(),
}));

vi.mock("./accountSkin", () => ({ syncAccountSkin: skin.sync }));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get token() {
        return mocks.token;
      },
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
  mocks.token = "a-token";
  mocks.isValid = true;
  mocks.record = null;
  mocks.authRefresh.mockReset();
  mocks.clear.mockReset();
  skin.sync.mockReset();
  skin.sync.mockResolvedValue();
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

// The skin of the account is the device's when the app starts with a session
// that the server still accepts: the account's skin is on the page before the
// app is first drawn (main.tsx waits for restoreSession), and a device whose
// account has none gives its own.
describe("restoreSession and the skin", () => {
  const alice = { id: "u1", collectionName: "users", role: "member" };

  test("a session that the server accepts: the skin of the account and the device's are put in agreement", async () => {
    mocks.record = alice;
    mocks.authRefresh.mockResolvedValue({});

    await restoreSession();

    expect(skin.sync).toHaveBeenCalledExactlyOnceWith(alice);
  });

  test("the app waits for it: it is first drawn in the skin of the account", async () => {
    mocks.record = alice;
    mocks.authRefresh.mockResolvedValue({});
    const open = Promise.withResolvers<void>();
    skin.sync.mockReturnValue(open.promise);
    let restored = false;

    const restoring = (async () => {
      await restoreSession();
      restored = true;
    })();
    await vi.waitFor(() => {
      expect(skin.sync).toHaveBeenCalledTimes(1);
    });
    await Promise.resolve();
    expect(restored).toBe(false);
    open.resolve();
    await restoring;
    expect(restored).toBe(true);
  });

  test.each([400, 401, 403, 404, 429, 500])(
    "nothing when the server answers %i: no session, or none to trust",
    async (status) => {
      mocks.record = alice;
      mocks.authRefresh.mockRejectedValue(answer(status));

      await restoreSession();

      expect(skin.sync).not.toHaveBeenCalled();
    },
  );

  test("nothing when the server cannot be reached: the device keeps its own", async () => {
    mocks.record = alice;
    mocks.authRefresh.mockRejectedValue(
      new ClientResponseError({ status: 0, originalError: new TypeError("Failed to fetch") }),
    );

    await restoreSession();

    expect(skin.sync).not.toHaveBeenCalled();
  });

  test("nothing when the token is missing or expired", async () => {
    mocks.record = alice;
    mocks.isValid = false;

    await restoreSession();

    expect(skin.sync).not.toHaveBeenCalled();
  });

  test("nothing for an account that is not a member's (the super-admin of PocketBase)", async () => {
    mocks.record = { id: "s1", collectionName: "_superusers", role: "" };
    mocks.authRefresh.mockResolvedValue({});

    await restoreSession();

    expect(skin.sync).not.toHaveBeenCalled();
  });
});

describe("sessionCheck", () => {
  // The clock of the check: the app has just started, and restoreSession
  // has just asked the server.
  let now = 0;
  const check = () => sessionCheck({ now: () => now });

  beforeEach(() => {
    now = 1_000_000;
    mocks.authRefresh.mockResolvedValue({});
  });

  test("does nothing when nobody is signed in", async () => {
    mocks.token = "";
    mocks.isValid = false;
    const run = check();
    now += SESSION_CHECK_INTERVAL_MS;

    await run();

    expect(mocks.authRefresh).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
  });

  test("drops an expired token at once, without asking the server", async () => {
    const run = check();
    mocks.isValid = false;

    await run();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
    expect(mocks.authRefresh).not.toHaveBeenCalled();
  });

  test("asks the server once the interval has passed, and not more often", async () => {
    const run = check();

    now += SESSION_CHECK_INTERVAL_MS - 1;
    await run();
    expect(mocks.authRefresh).not.toHaveBeenCalled();

    now += 1;
    await run();
    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);

    now += SESSION_CHECK_INTERVAL_MS - 1;
    await run();
    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);

    now += 1;
    await run();
    expect(mocks.authRefresh).toHaveBeenCalledTimes(2);
  });

  // PocketBase serves a refused token as a guest on the collection routes:
  // the renewal, which needs a session, is what reveals it.
  test("clears the store when the server refuses the token", async () => {
    mocks.authRefresh.mockRejectedValue(answer(401));
    const run = check();
    now += SESSION_CHECK_INTERVAL_MS;

    await run();

    expect(mocks.clear).toHaveBeenCalledTimes(1);
  });

  // The skin is put in agreement when the app starts and when somebody signs
  // in, not at every renewal: one that left before a choice reached the server
  // comes back with the skin the account had, which must not undo the choice.
  test("renews the session without touching the skin", async () => {
    mocks.record = { id: "u1", collectionName: "users", role: "member" };
    const run = check();
    now += SESSION_CHECK_INTERVAL_MS;

    await run();

    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
    expect(skin.sync).not.toHaveBeenCalled();
  });

  test("keeps the session when the server cannot be reached", async () => {
    mocks.authRefresh.mockRejectedValue(
      new ClientResponseError({ status: 0, originalError: new TypeError("Failed to fetch") }),
    );
    const run = check();
    now += SESSION_CHECK_INTERVAL_MS;

    await run();

    expect(mocks.authRefresh).toHaveBeenCalledTimes(1);
    expect(mocks.clear).not.toHaveBeenCalled();
  });
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
