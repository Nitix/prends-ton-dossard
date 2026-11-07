// What the page knows of this device's own subscription, without the server:
// the service worker registration, the key of the server, and the id the server
// gave to this device (to mark it in the list: the list never has an address).

const DEVICE_KEY = "ptd-push-device";

/** The id that the server gave to this device, or null. Storage may be blocked: then the device is not marked. */
export function rememberedDevice(): string | null {
  try {
    return localStorage.getItem(DEVICE_KEY);
  } catch {
    return null;
  }
}

export function rememberDevice(id: string): void {
  try {
    localStorage.setItem(DEVICE_KEY, id);
  } catch {
    // The device is not marked in the list; nothing else depends on it.
  }
}

export function forgetDevice(): void {
  try {
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    // Same.
  }
}

/**
 * The registration of the service worker, once it is active; null when there is
 * no service worker, or when it is not active after `timeoutMs` (`ready` never
 * settles where no worker is registered).
 */
export async function registration(timeoutMs: number): Promise<ServiceWorkerRegistration | null> {
  if (!("serviceWorker" in navigator)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<null>((resolve) => {
    timer = setTimeout(() => {
      resolve(null);
    }, timeoutMs);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The public key of the server, as the bytes `pushManager.subscribe` wants. */
export function applicationKey(publicKey: string): Uint8Array<ArrayBuffer> {
  const text = atob(publicKey.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(text, (char) => char.charCodeAt(0));
}

/** Whether a subscription was made with this key of the server. */
export function sameKey(subscription: PushSubscription, key: Uint8Array): boolean {
  const used = subscription.options.applicationServerKey;
  if (used === null) return false;
  const bytes = new Uint8Array(used);
  return bytes.length === key.length && bytes.every((byte, i) => byte === key[i]);
}
