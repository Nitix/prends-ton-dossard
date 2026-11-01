import { useQuery, type QueryClient } from "@tanstack/react-query";
import { redirect as redirectTo } from "@tanstack/react-router";
import { ClientResponseError, type AuthRecord } from "pocketbase";
import { useSyncExternalStore } from "react";

import { pb } from "../../lib/pb";
import { onResume } from "../../lib/resume";
import type { RunnerRecord, UserRecord } from "../../lib/types";

/** The pages anybody can open, signed in or not. */
const PUBLIC_PATHS: readonly string[] = ["/connexion", "/invitation"];

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

/**
 * Where to go after signing in. The `redirect` search parameter comes from
 * the URL, so anybody can craft it: only a path of this site is followed
 * (`//host` and `/\host` would leave it), anything else goes home.
 */
export function safeRedirect(redirect: string | undefined): string {
  if (redirect === undefined) return "/";
  const isSitePath = redirect.startsWith("/") && !redirect.startsWith("//");
  return isSitePath && !redirect.startsWith("/\\") ? redirect : "/";
}

/** What the server answers when it refuses a token for good. */
const REFUSED = new Set([400, 401, 403, 404]);

/**
 * Checks, when the app starts, that the stored session still works, and
 * renews it. The store is emptied when the token is expired or when the
 * server refuses it (it was replaced, or the account is disabled).
 *
 * A failure to reach the server leaves the session alone: opening the app
 * offline must not sign anybody out.
 */
export async function restoreSession(): Promise<void> {
  if (!pb.authStore.isValid) {
    pb.authStore.clear();
    return;
  }
  try {
    await pb.collection("users").authRefresh();
  } catch (err) {
    if (err instanceof ClientResponseError && REFUSED.has(err.status)) {
      pb.authStore.clear();
    }
  }
}

/** How often, at most, the server is asked whether the session still works. */
export const SESSION_CHECK_INTERVAL_MS = 10 * 60_000;

/** How often an app in view looks whether that check is due. */
const SESSION_TICK_MS = 60_000;

/**
 * Returns the check that runs while the app is open: when it comes back to
 * the foreground, and regularly while it stays there (see connectSession).
 *
 * PocketBase serves a request with a token it refuses as an anonymous one:
 * lists come back empty and records "not found", but no 401. Only the routes
 * that need a session answer 401. So a session that ended elsewhere (account
 * disabled, password reset, email changed on another device) would go
 * unnoticed. The check asks for a renewal, which needs a session: a refusal
 * empties the store (restoreSession, and afterSend in lib/pb.ts). The renewal
 * also keeps the token of a tab left open for days from expiring.
 *
 * A token that has expired is dropped at once, without asking. Otherwise the
 * server is asked at most once per `interval`, counted from the creation of the
 * check: restoreSession has just asked, when the app started. `now` is
 * injectable for tests.
 */
export function sessionCheck({
  now = Date.now,
  interval = SESSION_CHECK_INTERVAL_MS,
}: { now?: () => number; interval?: number } = {}): () => Promise<void> {
  let lastAsked = now();
  return async () => {
    if (!pb.authStore.token) return;
    if (!pb.authStore.isValid) {
      pb.authStore.clear();
      return;
    }
    if (now() - lastAsked < interval) return;
    lastAsked = now();
    await restoreSession();
  };
}

/**
 * Ties the app to the session, once it has been restored. When the session
 * ends (sign-out, a token that the server refused or that expired), what the
 * last user saw is forgotten and the router checks the page again: the guard
 * of the root route sends to the login page. While the app is open, the
 * session is checked (sessionCheck). Returns the function that stops it all.
 */
export function connectSession(
  router: { invalidate: () => Promise<unknown> },
  queryClient: QueryClient,
  options?: Parameters<typeof sessionCheck>[0],
): () => void {
  const stopListening = pb.authStore.onChange((token) => {
    if (token) return;
    queryClient.clear();
    void router.invalidate();
  });
  const check = sessionCheck(options);
  const stopChecking = onResume(() => void check(), SESSION_TICK_MS);
  return () => {
    stopListening();
    stopChecking();
  };
}

/**
 * The guard of the root route. Without a session, every page but the public
 * ones sends to the login page, which brings the user back once signed in. A
 * token that expired while the app was open is dropped on the way, which also
 * forgets what its user saw (connectSession).
 */
export function requireSession(location: { pathname: string; href: string }): void {
  if (pb.authStore.isValid || isPublicPath(location.pathname)) return;
  if (pb.authStore.token) pb.authStore.clear();
  throw redirectTo({
    to: "/connexion",
    search: { redirect: location.href === "/" ? undefined : location.href },
  });
}

export function logout(): void {
  pb.authStore.clear();
}

function subscribe(onChange: () => void): () => void {
  return pb.authStore.onChange(onChange);
}

// The SDK's LocalAuthStore parses the JSON of localStorage every time `record`
// is read, so it returns a new object each time. useSyncExternalStore needs
// the same snapshot until something changes (or it loops forever), hence this
// cache, which hands out the same object while the content is the same.
let cachedJson: string | undefined;
let cachedRecord: AuthRecord = null;

function currentRecord(): AuthRecord {
  const record = pb.authStore.record;
  const json = JSON.stringify(record);
  if (json !== cachedJson) {
    cachedJson = json;
    cachedRecord = record;
  }
  return cachedRecord;
}

/** The auth store holds a generic record: this one is of the `users` collection. */
function isUser(record: AuthRecord): record is UserRecord {
  return record?.collectionName === "users";
}

/**
 * Whether the signed-in user is an admin, read from the auth store: for the
 * guards of the routes, which are not components and cannot use `useSession`.
 */
export function isAdminSession(): boolean {
  const record = pb.authStore.record;
  return isUser(record) && record.role === "admin";
}

/**
 * The id of the signed-in user, empty when nobody is (or when the account is not
 * a member's). It follows the auth store, like `useSession`, without reading the
 * runner: for the data that is the user's own, which a query keeps under a key
 * with that id, so that it is not shown to the next account to sign in over
 * this session.
 */
export function useUserId(): string {
  const record = useSyncExternalStore(subscribe, currentRecord);
  return isUser(record) ? record.id : "";
}

/** How long the runner of the user is kept: it only changes when an admin renames it. */
const RUNNER_STALE_MS = 5 * 60_000;

/** How many times the runner of the user is asked for again after a failure. */
const RUNNER_RETRIES = 3;

/** Whether the server says there is no such record: the answer of a runner that is not there. */
function isNotFound(error: unknown): boolean {
  return error instanceof ClientResponseError && error.status === 404;
}

/**
 * The signed-in user and their runner. `user` is null when nobody is signed
 * in, `runner` while it is loading. Both follow the auth store, so a sign-in,
 * a sign-out or a renewal re-renders the components that read them.
 *
 * `runner` is also null when there is none to find: `runnerMissing` tells that
 * from the wait and from a failure to ask. It is true for an account of another
 * kind than the members (the super-admin of PocketBase), and for a member whose
 * runner the server says is not there (404, which is not asked again: it is
 * the answer). A failure for any other reason is asked again a few times, then
 * said by `runnerFailed` (not a runner that is missing, and not a wait either),
 * and `refetchRunner` asks once more. `signedIn` is true for any account, that
 * one included: `user` is null for it, as it is for nobody.
 */
export function useSession(): {
  user: UserRecord | null;
  runner: RunnerRecord | null;
  runnerMissing: boolean;
  runnerFailed: boolean;
  refetchRunner: () => Promise<unknown>;
  signedIn: boolean;
  isAdmin: boolean;
} {
  const record = useSyncExternalStore(subscribe, currentRecord);
  const user = isUser(record) ? record : null;
  const userId = user?.id ?? "";

  const {
    data: runner,
    error: runnerError,
    refetch,
  } = useQuery({
    queryKey: ["runner", userId],
    queryFn: () =>
      pb
        .collection("runners")
        .getFirstListItem<RunnerRecord>(pb.filter("user = {:id}", { id: userId })),
    enabled: userId !== "",
    staleTime: RUNNER_STALE_MS,
    // A 404 is the answer (there is no runner), and waiting for three more of
    // them would keep the page loading for several seconds.
    retry: (failureCount, error) => !isNotFound(error) && failureCount < RUNNER_RETRIES,
  });

  return {
    user,
    runner: runner ?? null,
    runnerMissing: record !== null && (user === null || isNotFound(runnerError)),
    // A refresh that fails keeps the runner that is there: nothing failed to show.
    runnerFailed: runner === undefined && runnerError !== null && !isNotFound(runnerError),
    refetchRunner: refetch,
    signedIn: record !== null,
    isAdmin: user?.role === "admin",
  };
}
