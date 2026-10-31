import { useQuery } from "@tanstack/react-query";
import { ClientResponseError, type AuthRecord } from "pocketbase";
import { useSyncExternalStore } from "react";

import { pb } from "../../lib/pb";
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

/** How long the runner of the user is kept: it only changes when an admin renames it. */
const RUNNER_STALE_MS = 5 * 60_000;

/**
 * The signed-in user and their runner. `user` is null when nobody is signed
 * in, `runner` while it is loading. Both follow the auth store, so a sign-in,
 * a sign-out or a renewal re-renders the components that read them.
 */
export function useSession(): {
  user: UserRecord | null;
  runner: RunnerRecord | null;
  isAdmin: boolean;
} {
  const record = useSyncExternalStore(subscribe, currentRecord);
  const user = isUser(record) ? record : null;
  const userId = user?.id ?? "";

  const { data: runner } = useQuery({
    queryKey: ["runner", userId],
    queryFn: () =>
      pb
        .collection("runners")
        .getFirstListItem<RunnerRecord>(pb.filter("user = {:id}", { id: userId })),
    enabled: userId !== "",
    staleTime: RUNNER_STALE_MS,
  });

  return { user, runner: runner ?? null, isAdmin: user?.role === "admin" };
}
