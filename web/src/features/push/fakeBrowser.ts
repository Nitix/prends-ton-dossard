// The browser objects of the push tests: a notification permission, a service
// worker whose `ready` the test settles, and a push manager that keeps one
// subscription. No test registers a real worker or asks a real permission.
import { vi } from "vitest";

const noop = () => undefined;

export function bytesToBase64Url(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/** Two public keys of the server, as they are sent (base64url of 65 bytes). */
export const KEY_A = bytesToBase64Url(Uint8Array.from({ length: 65 }, (_, i) => i + 1));
export const KEY_B = bytesToBase64Url(Uint8Array.from({ length: 65 }, (_, i) => 200 - i));

function bytesOf(key: string): ArrayBuffer {
  const text = atob(key.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

export type FakeSubscription = {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer };
  toJSON: () => { endpoint: string; keys: { p256dh: string; auth: string } };
  unsubscribe: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
};

export function fakeSubscription(endpoint: string, key: string): FakeSubscription {
  return {
    endpoint,
    options: { applicationServerKey: bytesOf(key) },
    toJSON: () => ({
      endpoint,
      keys: { p256dh: "p256dh-of-" + endpoint, auth: "auth-of-" + endpoint },
    }),
    unsubscribe: vi.fn<() => Promise<boolean>>(() => Promise.resolve(true)),
  };
}

type SubscribeOptions = { userVisibleOnly: boolean; applicationServerKey: Uint8Array };

export type Fakes = {
  /** What `Notification.requestPermission()` resolves with, and what `Notification.permission` becomes. */
  answer: NotificationPermission;
  requestPermission: ReturnType<typeof vi.fn<() => Promise<NotificationPermission>>>;
  /** The subscription of the push manager, null when there is none. */
  current: FakeSubscription | null;
  getSubscription: ReturnType<typeof vi.fn<() => Promise<FakeSubscription | null>>>;
  subscribe: ReturnType<typeof vi.fn<(options: SubscribeOptions) => Promise<FakeSubscription>>>;
  /** Lets `navigator.serviceWorker.ready` resolve (it is resolved already unless `holdReady` was given). */
  releaseReady: () => void;
};

/** Puts the fakes on `window` and `navigator`. `restoreFakes` takes them away. */
export function installFakes({
  permission = "default",
  answer = "granted",
  current = null,
  holdReady = false,
}: {
  permission?: NotificationPermission;
  answer?: NotificationPermission;
  current?: FakeSubscription | null;
  holdReady?: boolean;
} = {}): Fakes {
  let release: () => void = noop;
  // A subscription that is unsubscribed is no longer the push manager's.
  const track = (subscription: FakeSubscription): FakeSubscription => {
    subscription.unsubscribe = vi.fn<() => Promise<boolean>>(() => {
      if (fakes.current === subscription) fakes.current = null;
      return Promise.resolve(true);
    });
    return subscription;
  };
  const fakes: Fakes = {
    answer,
    current: current === null ? null : track(current),
    requestPermission: vi.fn<() => Promise<NotificationPermission>>(() => {
      Reflect.set(Notification, "permission", fakes.answer);
      return Promise.resolve(fakes.answer);
    }),
    getSubscription: vi.fn<() => Promise<FakeSubscription | null>>(() =>
      Promise.resolve(fakes.current),
    ),
    subscribe: vi.fn<(options: SubscribeOptions) => Promise<FakeSubscription>>((options) => {
      fakes.current = track(
        fakeSubscription(
          "https://push.example.test/new-" + String(fakes.subscribe.mock.calls.length),
          bytesToBase64Url(options.applicationServerKey),
        ),
      );
      return Promise.resolve(fakes.current);
    }),
    releaseReady: () => {
      release();
    },
  };
  vi.stubGlobal("Notification", { permission, requestPermission: fakes.requestPermission });
  const ready = holdReady
    ? new Promise<void>((resolve) => {
        release = resolve;
      })
    : Promise.resolve();
  const registration = {
    pushManager: { getSubscription: fakes.getSubscription, subscribe: fakes.subscribe },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { ready: ready.then(() => registration) },
  });
  return fakes;
}

export function restoreFakes(): void {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "serviceWorker");
}
