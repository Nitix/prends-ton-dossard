import { afterEach, expect, test, vi } from "vitest";

import {
  captureInstallPrompt,
  installPrompt,
  subscribeInstallPrompt,
  takeInstallPrompt,
} from "./installPrompt";

let stop: (() => void) | undefined;
let target: EventTarget;

function listen() {
  target = new EventTarget();
  stop = captureInstallPrompt(target);
}

afterEach(() => {
  stop?.();
  stop = undefined;
});

/** What Chromium sends when the site can be installed. */
function offer() {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), {
    prompt: () => Promise.resolve({ outcome: "accepted" }),
  });
  target.dispatchEvent(event);
  return event;
}

test("installPrompt — garde l'événement et empêche la bannière du navigateur", () => {
  listen();
  const changed = vi.fn<() => void>();
  subscribeInstallPrompt(changed);
  expect(installPrompt()).toBeNull();

  const event = offer();

  expect(installPrompt()).toBe(event);
  expect(event.defaultPrevented).toBe(true);
  expect(changed).toHaveBeenCalledTimes(1);
});

test("installPrompt — un événement sans prompt() n'est pas gardé, ni empêché", () => {
  listen();

  const event = new Event("beforeinstallprompt", { cancelable: true });
  target.dispatchEvent(event);

  expect(installPrompt()).toBeNull();
  expect(event.defaultPrevented).toBe(false);
});

test("installPrompt — takeInstallPrompt rend l'événement une seule fois, et prévient", () => {
  listen();
  const event = offer();
  const changed = vi.fn<() => void>();
  subscribeInstallPrompt(changed);

  expect(takeInstallPrompt()).toBe(event);
  expect(takeInstallPrompt()).toBeNull();

  expect(installPrompt()).toBeNull();
  expect(changed).toHaveBeenCalledTimes(1);
});

test("installPrompt — l'appli installée, l'événement est oublié", () => {
  listen();
  offer();
  const changed = vi.fn<() => void>();
  subscribeInstallPrompt(changed);

  target.dispatchEvent(new Event("appinstalled"));

  expect(installPrompt()).toBeNull();
  expect(changed).toHaveBeenCalledTimes(1);
});

test("installPrompt — qui se désabonne n'est plus prévenu", () => {
  listen();
  const changed = vi.fn<() => void>();
  const unsubscribe = subscribeInstallPrompt(changed);

  unsubscribe();
  offer();

  expect(changed).not.toHaveBeenCalled();
});

test("installPrompt — arrêter l'écoute oublie l'événement et n'en reçoit plus", () => {
  listen();
  offer();

  stop?.();
  stop = undefined;
  offer();

  expect(installPrompt()).toBeNull();
});
