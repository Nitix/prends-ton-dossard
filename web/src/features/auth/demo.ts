import { ClientResponseError, type RecordAuthResponse } from "pocketbase";

import { pb } from "../../lib/pb";

/**
 * Asks whether this site is a demo, which is when the login page offers to
 * enter it with no account (`DEMO_LOGIN_EMAIL` on the server). The real site
 * has no such route: PocketBase answers its 404, which is the answer "no". The
 * demo gives the same one when its account cannot be entered (missing,
 * disabled, an admin...). Any other failure (no network, a server error) is not
 * an answer: it is thrown, and the page shows no button.
 *
 * It takes no `signal`: the SDK replaces it when it cancels requests on its
 * own, and reading TanStack's cancels the query when the page unmounts, which
 * sends it twice under StrictMode.
 */
export async function fetchDemoEnabled(): Promise<boolean> {
  try {
    const answer = await pb.send<{ enabled?: boolean } | null>("/api/app/demo", {
      method: "GET",
    });
    return answer?.enabled === true;
  } catch (err) {
    if (err instanceof ClientResponseError && err.status === 404) return false;
    throw err;
  }
}

/**
 * Signs in to the account of the demo, and keeps the session in the auth
 * store, as a sign-in with a password does. Nothing is sent: the account is
 * the one that the server was told to offer. An API error (`not_found` when
 * there is no such account any more) is thrown.
 */
export async function enterDemo(): Promise<void> {
  const session = await pb.send<RecordAuthResponse>("/api/app/demo", { method: "POST" });
  pb.authStore.save(session.token, session.record);
}
