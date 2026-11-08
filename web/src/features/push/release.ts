import { forgetDevice, registration } from "./thisDevice";

/** How long the server is given to remove the device, and the worker to answer: nobody waits for this. */
const LET_GO_MS = 2000;

/**
 * Lets this device go when somebody signs out: the server forgets its
 * subscription (with the token of the session that ended, which the store no
 * longer has), then the browser drops it, so that the next person on a shared
 * device does not get the reminders of the previous one. It is never waited for,
 * and nothing it does can fail the sign-out: whatever goes wrong, the session is
 * over already.
 */
export async function releaseThisDevice(token: string): Promise<void> {
  // One deadline for the whole release: the wait for the worker, then the request.
  const end = Date.now() + LET_GO_MS;
  try {
    const worker = await registration(Math.max(1, end - Date.now()));
    const subscription = await worker?.pushManager.getSubscription();
    if (subscription === undefined || subscription === null) return;
    try {
      await fetch("/api/app/push/subscriptions", {
        method: "DELETE",
        headers: { Authorization: token, "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: subscription.endpoint }),
        keepalive: true,
        signal: AbortSignal.timeout(Math.max(1, end - Date.now())),
      });
    } catch {
      // The server keeps a device that will answer 410 one day: it goes then.
    }
    await subscription.unsubscribe();
  } catch {
    // Nothing to do: the session is over.
  } finally {
    // Whatever happened, this device is no longer the one of the person who left.
    forgetDevice();
  }
}
