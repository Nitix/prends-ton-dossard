import { afterEach, expect, test, vi } from "vitest";

import { registerServiceWorker } from "./register";

// These tests run in Node, with a `navigator` that is only a spy: no service
// worker is ever registered in a browser.

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** A browser that supports service workers: `register` tells what the site asked for. */
function browserWithWorkers(register: () => Promise<unknown> = () => Promise.resolve({})) {
  const spy = vi.fn<(script: string) => Promise<unknown>>(register);
  vi.stubGlobal("navigator", { serviceWorker: { register: spy } });
  return spy;
}

test("registerServiceWorker — rien en développement", () => {
  // The dev server has no sw.js to serve, and a worker would keep old modules.
  vi.stubEnv("PROD", false);
  const register = browserWithWorkers();

  registerServiceWorker();

  expect(register).not.toHaveBeenCalled();
});

test("registerServiceWorker — en production, enregistre /sw.js", () => {
  vi.stubEnv("PROD", true);
  const register = browserWithWorkers();

  registerServiceWorker();

  expect(register).toHaveBeenCalledExactlyOnceWith("/sw.js");
});

test("registerServiceWorker — un navigateur sans service worker n'est pas dérangé", () => {
  vi.stubEnv("PROD", true);
  vi.stubGlobal("navigator", {});

  expect(() => {
    registerServiceWorker();
  }).not.toThrow();
});

test("registerServiceWorker — un enregistrement refusé ne casse pas le site", async () => {
  vi.stubEnv("PROD", true);
  const register = browserWithWorkers(() => Promise.reject(new Error("refused")));

  registerServiceWorker();
  // A rejection that nobody handles would fail the run.
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(register).toHaveBeenCalledTimes(1);
});
