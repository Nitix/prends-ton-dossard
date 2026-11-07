import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import {
  KEY_A,
  KEY_B,
  bytesToBase64Url,
  fakeSubscription,
  installFakes,
  restoreFakes,
} from "./fakeBrowser";
import { disableOnThisDevice, enableOnThisDevice, thisDeviceEndpoint } from "./subscribe";
import { rememberedDevice } from "./thisDevice";

const mocks = vi.hoisted(() => ({
  send: vi.fn<(path: string, options: { method: string; body?: unknown }) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({ pb: { send: mocks.send } }));
vi.mock("../auth/session", () => ({ useUserId: () => "u1" }));

beforeEach(() => {
  mocks.send.mockReset();
  mocks.send.mockResolvedValue({ id: "dev1" });
  localStorage.clear();
});

afterEach(() => {
  restoreFakes();
});

describe("enableOnThisDevice", () => {
  test("la permission est demandée avant tout await", () => {
    const fakes = installFakes({ holdReady: true });

    const done = enableOnThisDevice(KEY_A, "fr", "Firefox sur Windows");

    // Synchronously: nothing has been awaited, the worker is not ready yet.
    expect(fakes.requestPermission).toHaveBeenCalledTimes(1);
    expect(fakes.subscribe).not.toHaveBeenCalled();
    fakes.releaseReady();
    return expect(done).resolves.toBe("enabled");
  });

  test("abonne le navigateur avec la clé du serveur et l'enregistre", async () => {
    const fakes = installFakes();

    expect(await enableOnThisDevice(KEY_A, "en", "Chrome sur Android")).toBe("enabled");

    expect(fakes.subscribe).toHaveBeenCalledTimes(1);
    const options = fakes.subscribe.mock.calls[0]?.[0];
    expect(options?.userVisibleOnly).toBe(true);
    expect(bytesToBase64Url(options?.applicationServerKey ?? new Uint8Array())).toBe(KEY_A);
    const post = mocks.send.mock.calls.find(([, request]) => request.method === "POST");
    expect(post?.[0]).toBe("/api/app/push/subscriptions");
    expect(post?.[1].body).toEqual({
      endpoint: fakes.current?.endpoint,
      keys: fakes.current?.toJSON().keys,
      lang: "en",
      label: "Chrome sur Android",
    });
    // The id the server gave marks this device in the list.
    expect(rememberedDevice()).toBe("dev1");
  });

  test("permission refusée : rien n'est abonné ni envoyé", async () => {
    const fakes = installFakes({ answer: "denied" });

    expect(await enableOnThisDevice(KEY_A, "fr", "x")).toBe("denied");

    expect(fakes.subscribe).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  test("un abonnement fait avec une autre clé est refait", async () => {
    const old = fakeSubscription("https://push.example.test/old", KEY_B);
    const fakes = installFakes({ current: old });

    await enableOnThisDevice(KEY_A, "fr", "x");

    expect(old.unsubscribe).toHaveBeenCalledTimes(1);
    expect(fakes.subscribe).toHaveBeenCalledTimes(1);
  });

  test("un abonnement à la bonne clé est gardé", async () => {
    const same = fakeSubscription("https://push.example.test/same", KEY_A);
    const fakes = installFakes({ current: same });

    await enableOnThisDevice(KEY_A, "fr", "x");

    expect(same.unsubscribe).not.toHaveBeenCalled();
    expect(fakes.subscribe).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  test("le serveur refuse : l'abonnement qu'on vient de faire est défait", async () => {
    const fakes = installFakes();
    mocks.send.mockRejectedValue(new Error("refused"));

    await expect(enableOnThisDevice(KEY_A, "fr", "x")).rejects.toThrow("refused");

    // Unsubscribed: the push manager has none left.
    expect(fakes.current).toBeNull();
    expect(rememberedDevice()).toBeNull();
  });
});

describe("disableOnThisDevice", () => {
  test("retire l'abonnement du serveur, puis désabonne le navigateur", async () => {
    const sub = fakeSubscription("https://push.example.test/mine", KEY_A);
    installFakes({ permission: "granted", current: sub });
    localStorage.setItem("ptd-push-device", "dev1");
    mocks.send.mockResolvedValue(undefined);

    await disableOnThisDevice();

    expect(mocks.send).toHaveBeenCalledWith("/api/app/push/subscriptions", {
      method: "DELETE",
      body: { endpoint: "https://push.example.test/mine" },
    });
    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
    expect(rememberedDevice()).toBeNull();
  });

  test("le serveur injoignable : le navigateur se désabonne quand même, et l'échec est dit", async () => {
    const sub = fakeSubscription("https://push.example.test/mine", KEY_A);
    installFakes({ permission: "granted", current: sub });
    mocks.send.mockRejectedValue(new Error("offline"));

    await expect(disableOnThisDevice()).rejects.toThrow("offline");

    expect(sub.unsubscribe).toHaveBeenCalledTimes(1);
  });
});

test("thisDeviceEndpoint — l'adresse de l'abonnement, ou null", async () => {
  installFakes({
    permission: "granted",
    current: fakeSubscription("https://push.example.test/mine", KEY_A),
  });
  expect(await thisDeviceEndpoint()).toBe("https://push.example.test/mine");
  restoreFakes();

  installFakes({ permission: "granted" });
  expect(await thisDeviceEndpoint()).toBeNull();
});
