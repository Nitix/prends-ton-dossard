import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  KEY_A,
  KEY_B,
  bytesToBase64Url,
  fakeSubscription,
  installFakes,
  restoreFakes,
} from "./fakeBrowser";
import { resetPushSync, syncPush } from "./sync";

const mocks = vi.hoisted(() => ({
  record: { id: "u1", collectionName: "users" } as { id: string; collectionName: string } | null,
  send: vi.fn<(path: string, options: { method: string; body?: unknown }) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get record() {
        return mocks.record;
      },
      onChange: () => () => undefined,
    },
    send: mocks.send,
  },
}));
vi.mock("../auth/session", () => ({ useUserId: () => "u1" }));

/** The server: its key, and what a subscription gets as an answer. */
function serve(publicKey: string | null = KEY_A) {
  mocks.send.mockImplementation((path, request) => {
    if (request.method === "GET") {
      return Promise.resolve(
        publicKey === null
          ? { available: false, devices: [] }
          : { available: true, publicKey, devices: [] },
      );
    }
    if (path === "/api/app/push/subscriptions") return Promise.resolve({ id: "dev1" });
    return Promise.reject(new Error(`unexpected ${request.method} ${path}`));
  });
}

const posts = () => mocks.send.mock.calls.filter(([, request]) => request.method === "POST");

beforeEach(() => {
  // The service worker is registered in a production build only: the browser has none otherwise.
  vi.stubEnv("PROD", true);
  mocks.record = { id: "u1", collectionName: "users" };
  mocks.send.mockReset();
  localStorage.clear();
  resetPushSync();
});

afterEach(() => {
  restoreFakes();
  vi.unstubAllEnvs();
});

describe("syncPush", () => {
  test("renvoie l'abonnement une fois", async () => {
    const sub = fakeSubscription("https://push.example.test/mine", KEY_A);
    installFakes({ permission: "granted", current: sub });
    serve();

    await syncPush();
    await syncPush();

    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[1].body).toMatchObject({
      endpoint: "https://push.example.test/mine",
      keys: sub.toJSON().keys,
    });
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(localStorage.getItem("ptd-push-device")).toBe("dev1");
  });

  test("se réabonne quand la clé a changé", async () => {
    const old = fakeSubscription("https://push.example.test/old", KEY_B);
    const fakes = installFakes({ permission: "granted", current: old });
    serve(KEY_A);

    await syncPush();

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakes.subscribe).toHaveBeenCalledTimes(1);
    expect(
      bytesToBase64Url(fakes.subscribe.mock.calls[0]?.[0].applicationServerKey ?? new Uint8Array()),
    ).toBe(KEY_A);
    // What the server gets is the new subscription, not the dead one.
    expect(posts()).toHaveLength(1);
    expect(posts()[0]?.[1].body).toMatchObject({ endpoint: fakes.current?.endpoint });
  });

  test("ne fait rien sans permission", async () => {
    installFakes({
      permission: "default",
      current: fakeSubscription("https://push.example.test/x", KEY_A),
    });
    serve();

    await syncPush();

    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("ne fait rien sans abonnement, sans clés, sans session ni sur la démo", async () => {
    installFakes({ permission: "granted" });
    serve();
    await syncPush();
    expect(posts()).toHaveLength(0);

    resetPushSync();
    restoreFakes();
    installFakes({
      permission: "granted",
      current: fakeSubscription("https://push.example.test/x", KEY_A),
    });
    serve(null);
    await syncPush();
    expect(posts()).toHaveLength(0);

    // The demo: the server has no notifications.
    resetPushSync();
    mocks.send.mockRejectedValue(
      new ClientResponseError({ status: 404, response: { status: 404 } }),
    );
    await syncPush();
    expect(posts()).toHaveLength(0);

    resetPushSync();
    mocks.record = null;
    serve();
    mocks.send.mockClear();
    await syncPush();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("ne fait rien dans un navigateur sans service worker enregistré (le serveur de Vite)", async () => {
    vi.stubEnv("PROD", false);
    installFakes({
      permission: "granted",
      current: fakeSubscription("https://push.example.test/x", KEY_A),
    });
    serve();

    await syncPush();

    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("un échec ne remonte pas", async () => {
    installFakes({
      permission: "granted",
      current: fakeSubscription("https://push.example.test/x", KEY_A),
    });
    mocks.send.mockRejectedValue(new Error("offline"));

    await expect(syncPush()).resolves.toBeUndefined();
  });
});
