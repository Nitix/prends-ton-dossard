import { afterEach, expect, test, vi } from "vitest";

import { KEY_A, fakeSubscription, installFakes, restoreFakes } from "./fakeBrowser";
import { releaseThisDevice } from "./release";

afterEach(() => {
  restoreFakes();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("release — sans abonnement, l'identifiant gardé est oublié quand même", async () => {
  installFakes({ permission: "granted" });
  localStorage.setItem("ptd-push-device", "dev1");

  await releaseThisDevice("old-token");

  expect(localStorage.getItem("ptd-push-device")).toBeNull();
});

test("release — un service worker qui ne répond pas ne retient pas plus de 2 s en tout", async () => {
  installFakes({ permission: "granted", holdReady: true });
  localStorage.setItem("ptd-push-device", "dev1");
  const fetched = vi.fn<() => Promise<Response>>();
  vi.stubGlobal("fetch", fetched);

  const start = Date.now();
  await releaseThisDevice("old-token");

  expect(Date.now() - start).toBeLessThan(2600);
  expect(fetched).not.toHaveBeenCalled();
  expect(localStorage.getItem("ptd-push-device")).toBeNull();
});

test("release — le serveur qui ne répond pas : la demande est coupée dans le même délai", async () => {
  installFakes({
    permission: "granted",
    current: fakeSubscription("https://push.example.test/mine", KEY_A),
  });
  const fetched = vi.fn<(url: string, init: RequestInit) => Promise<Response>>(
    (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          reject(new Error("aborted"));
        });
      }),
  );
  vi.stubGlobal("fetch", fetched);

  const start = Date.now();
  await releaseThisDevice("old-token");

  expect(Date.now() - start).toBeLessThan(2600);
  expect(fetched).toHaveBeenCalledTimes(1);
});
