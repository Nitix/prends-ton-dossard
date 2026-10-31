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
// that is what sends the app back to the login page (see main.tsx).
pb.afterSend = (response: Response, data: unknown) => {
  if (response.status === 401 && pb.authStore.token) {
    pb.authStore.clear();
  }
  return data;
};
