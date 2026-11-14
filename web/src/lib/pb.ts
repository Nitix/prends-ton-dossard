import PocketBase from "pocketbase";

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
// The SDK (0.29 and later) empties the store on a 401 by itself as well: it is
// turned off, so that a session ends once (each end forgets the queries and
// checks the page again), and only when there was one.
pb.autoClearAuthStore(false);
pb.afterSend = (response: Response, data: unknown) => {
  if (response.status === 401 && pb.authStore.token) {
    pb.authStore.clear();
  }
  return data;
};
