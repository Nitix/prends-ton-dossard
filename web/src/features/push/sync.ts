import { detectLocale } from "../../i18n/detect";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { pb } from "../../lib/pb";
import { fetchPush, postSubscription } from "./api";
import { deviceLabel } from "./deviceLabel";
import { pushSupport } from "./support";
import { applicationKey, registration, rememberDevice, sameKey } from "./thisDevice";

/** How long the page waits for the service worker: a page without one has nothing to sync. */
const READY_MS = 5000;

/** The account that was synced in this session (the page load), so that it is done once. */
let syncedFor = "";

/** Forgets what was synced: for tests. */
export function resetPushSync(): void {
  syncedFor = "";
}

/**
 * Once per session, signed in, with the permission granted and a subscription in
 * the browser: sends the subscription again (the server keeps one per address, so
 * it is idempotent: it brings back a device that the server lost, or one that came
 * from another account). A subscription made with another key than the server's
 * (the keys were changed) is dropped and made again with the new one. A failure is
 * left alone: it is tried again at the next session, and nobody is bothered.
 */
export async function syncPush(): Promise<void> {
  const record = pb.authStore.record;
  const userId = record?.collectionName === "users" ? record.id : "";
  if (userId === "" || syncedFor === userId) return;
  if (pushSupport() !== "ready" || Notification.permission !== "granted") return;
  syncedFor = userId;
  try {
    const info = await fetchPush();
    if (info === null || !info.available || info.publicKey === undefined) return;
    const worker = await registration(READY_MS);
    let subscription = await worker?.pushManager.getSubscription();
    if (worker === null || subscription === undefined || subscription === null) return;
    const key = applicationKey(info.publicKey);
    if (!sameKey(subscription, key)) {
      await subscription.unsubscribe();
      subscription = await worker.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: key,
      });
    }
    const { lang } = detectLocale(navigator.languages);
    const t = lang === "en" ? en : fr;
    rememberDevice(
      await postSubscription(
        subscription,
        lang,
        deviceLabel(navigator.userAgent, navigator.maxTouchPoints, t),
      ),
    );
  } catch {
    // Tried again at the next session.
  }
}

/**
 * Starts the synchronisation: now if somebody is signed in, and whenever
 * somebody signs in later. Returns the function that stops it.
 */
export function startPushSync(): () => void {
  void syncPush();
  return pb.authStore.onChange((token) => {
    if (token) void syncPush();
  });
}
