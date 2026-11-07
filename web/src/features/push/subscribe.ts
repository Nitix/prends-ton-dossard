import type { Lang } from "../../i18n/detect";
import { deleteSubscription, postSubscription } from "./api";
import { applicationKey, forgetDevice, registration, rememberDevice, sameKey } from "./thisDevice";

/** The service worker is not active yet: the page cannot subscribe for now. */
export class NoWorkerError extends Error {
  constructor() {
    super("no active service worker");
  }
}

/** How long a click waits for the service worker to be active. */
const READY_MS = 10_000;

/**
 * Turns the notifications on for this device: asks the permission, subscribes the
 * browser with the key of the server, and registers the subscription.
 *
 * Called from the click handler. The permission is asked first, before any
 * `await`: iOS (and Safari) only show the prompt to a call that is still in the
 * gesture. The public key is given for that reason, read with the section and not
 * after the click.
 *
 * "denied" is any answer but a grant: a refusal, or a prompt that was closed.
 */
export async function enableOnThisDevice(
  publicKey: string,
  lang: Lang,
  label: string,
): Promise<"enabled" | "denied"> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

  const worker = await registration(READY_MS);
  if (worker === null) throw new NoWorkerError();
  const key = applicationKey(publicKey);
  let subscription = await worker.pushManager.getSubscription();
  // A subscription made with another key of the server is of no use.
  if (subscription !== null && !sameKey(subscription, key)) {
    await subscription.unsubscribe();
    subscription = null;
  }
  const made = subscription === null;
  subscription ??= await worker.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  try {
    rememberDevice(await postSubscription(subscription, lang, label));
  } catch (err) {
    // A subscription the server does not know would be on for the page and dead for the server.
    if (made) await subscription.unsubscribe().catch(() => false);
    throw err;
  }
  return "enabled";
}

/**
 * Turns them off: the server forgets the subscription, and the browser drops it.
 * The browser drops it even when the server could not be reached (the device is
 * off for this person at least); that failure is then thrown.
 */
export async function disableOnThisDevice(): Promise<void> {
  const worker = await registration(READY_MS);
  const subscription = await worker?.pushManager.getSubscription();
  forgetDevice();
  if (subscription === undefined || subscription === null) return;
  try {
    await deleteSubscription(subscription.endpoint);
  } finally {
    await subscription.unsubscribe();
  }
}

/**
 * Lets the browser go of its subscription, without the server (the row of the
 * device is deleted by its id): used when the person removes this device from the list.
 */
export async function unsubscribeThisDevice(): Promise<void> {
  forgetDevice();
  const worker = await registration(2000);
  await (await worker?.pushManager.getSubscription())?.unsubscribe();
}

/** The address of this device's subscription, null when the browser has none. */
export async function thisDeviceEndpoint(): Promise<string | null> {
  const worker = await registration(READY_MS);
  return (await worker?.pushManager.getSubscription())?.endpoint ?? null;
}
