import PocketBase, { type SendOptions } from "pocketbase";

/**
 * The PocketBase client. The API is served from the same origin as the app
 * (in development, Vite proxies `/api` to the Go server).
 */
export const pb = new PocketBase("/");

// TanStack Query already shares identical requests, and PocketBase's own
// auto-cancellation would abort one of two simultaneous requests that happen
// to share a key (two components asking for the same list, for instance).
pb.autoCancellation(false);

// A 401 means the server refused our token: it expired, it was replaced, or
// the account was disabled. The session is over, so the store is emptied;
// that is what sends the app back to the login page (connectSession, in
// features/auth/session.ts). Since PocketBase 0.42, every route answers 401 to
// a token it refuses, so the first request after a session ended elsewhere
// ends it here too.
//
//
// Only a 401 to the token that is stored ends the session. A new password or a
// new email kills the token, and a request still under way with the old one is
// refused after the new one is stored (in this tab, or in another one, which
// shares the store): that is not the end of the new session.
//
// The SDK (0.29 and later) empties the store on any 401 by itself: it is turned
// off, so that a session ends once (each end forgets the queries and checks the
// page again), and only for its own token.
pb.autoClearAuthStore(false);
pb.afterSend = (response: Response, data: unknown, options?: SendOptions) => {
  const token = pb.authStore.token;
  if (response.status === 401 && token !== "" && sentToken(options) === token) {
    pb.authStore.clear();
  }
  return data;
};

/** The token a request went out with: the client puts it in the Authorization header. */
function sentToken(options: SendOptions | undefined): string | undefined {
  for (const [name, value] of Object.entries(options?.headers ?? {})) {
    if (name.toLowerCase() === "authorization") return value;
  }
  return undefined;
}
