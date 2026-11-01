import { QueryClient } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { pb } from "../../lib/pb";
import { SESSION_CHECK_INTERVAL_MS, connectSession, requireSession } from "./session";

// The real PocketBase client and its afterSend run here: only fetch is
// replaced. That is the whole path of a session that ended elsewhere, from
// the renewal to the login page.

const REFRESH_URL = "/api/collections/users/auth-refresh";

/** A token that expires `seconds` from now: the SDK reads it, unsigned. */
function tokenExpiringIn(seconds: number): string {
  const payload = btoa(JSON.stringify({ id: "u1", exp: Math.floor(Date.now() / 1000) + seconds }));
  return `header.${payload}.signature`;
}

const alice = { id: "u1", collectionId: "c1", collectionName: "users", role: "member" };

let visibility: DocumentVisibilityState = "visible";
let now = 0;
let stop = () => {};

beforeEach(() => {
  visibility = "visible";
  now = 1_000_000;
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
  pb.authStore.save(tokenExpiringIn(3600), alice);
});

afterEach(() => {
  stop();
  pb.authStore.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function answer(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function openApp(path: string) {
  const root = createRootRoute({
    beforeLoad: ({ location }) => requireSession(location),
    component: Outlet,
  });
  const page = (url: string, title: string) =>
    createRoute({ getParentRoute: () => root, path: url, component: () => <h1>{title}</h1> });
  const router = createRouter({
    routeTree: root.addChildren([
      page("/", "Accueil"),
      page("/liste", "Liste"),
      page("/connexion", "Connexion"),
    ]),
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const queryClient = new QueryClient();
  // What the last user saw, which must not outlive the session.
  queryClient.setQueryData(["pending"], ["something"]);
  stop = connectSession(router, queryClient, { now: () => now });

  const screen = await render(<RouterProvider router={router} />);
  return { router, queryClient, screen };
}

/** The app comes back to the foreground after a while. */
function resumeLater() {
  now += SESSION_CHECK_INTERVAL_MS;
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

test("reprise — un jeton refusé par le serveur renvoie vers /connexion, puis vers la page", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    answer(401, {
      status: 401,
      message: "The request requires valid record authorization token.",
      data: {},
    }),
  );
  const { router, queryClient, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { name: "Liste" })).toBeVisible();

  resumeLater();

  await expect.element(screen.getByRole("heading", { name: "Connexion" })).toBeVisible();
  expect(router.state.location.pathname).toBe("/connexion");
  expect(router.state.location.search).toEqual({ redirect: "/liste" });
  expect(fetchSpy).toHaveBeenCalledWith(expect.stringContaining(REFRESH_URL), expect.anything());
  expect(pb.authStore.token).toBe("");
  expect(queryClient.getQueryData(["pending"])).toBeUndefined();
});

test("reprise — sans réseau, la session est gardée", async () => {
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValue(new TypeError("Failed to fetch"));
  const { router, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { name: "Liste" })).toBeVisible();
  const token = pb.authStore.token;

  resumeLater();

  await vi.waitFor(() => {
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
  // Let the failed renewal settle before looking.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(router.state.location.pathname).toBe("/liste");
  expect(pb.authStore.token).toBe(token);
});

test("reprise — un jeton accepté est renouvelé, et la page reste", async () => {
  const renewed = tokenExpiringIn(7200);
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(answer(200, { token: renewed, record: alice }));
  const { router, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { name: "Liste" })).toBeVisible();

  resumeLater();

  await vi.waitFor(() => {
    expect(pb.authStore.token).toBe(renewed);
  });
  expect(fetchSpy).toHaveBeenCalledTimes(1);
  expect(router.state.location.pathname).toBe("/liste");
});

test("reprise — peu après la précédente, le serveur n'est pas sollicité", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(answer(401));
  const { router, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { name: "Liste" })).toBeVisible();

  now += SESSION_CHECK_INTERVAL_MS - 1;
  document.dispatchEvent(new Event("visibilitychange"));
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(fetchSpy).not.toHaveBeenCalled();
  expect(router.state.location.pathname).toBe("/liste");
});

test("reprise — un jeton expiré pendant l'absence renvoie vers /connexion sans appeler le serveur", async () => {
  const fetchSpy = vi.spyOn(globalThis, "fetch");
  const { router, queryClient, screen } = await openApp("/liste");
  await expect.element(screen.getByRole("heading", { name: "Liste" })).toBeVisible();

  // Two hours later, the token of one hour has expired.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.now() + 2 * 3600_000);
  document.dispatchEvent(new Event("visibilitychange"));

  await expect.element(screen.getByRole("heading", { name: "Connexion" })).toBeVisible();
  expect(router.state.location.search).toEqual({ redirect: "/liste" });
  expect(pb.authStore.token).toBe("");
  expect(queryClient.getQueryData(["pending"])).toBeUndefined();
  expect(fetchSpy).not.toHaveBeenCalled();
});

test("navigation — un jeton expiré est oublié en allant vers une page privée", async () => {
  const { router, queryClient, screen } = await openApp("/connexion");
  await expect.element(screen.getByRole("heading", { name: "Connexion" })).toBeVisible();
  pb.authStore.save(tokenExpiringIn(-60), alice);

  await router.navigate({ to: "/liste" });

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/connexion");
  });
  expect(router.state.location.search).toEqual({ redirect: "/liste" });
  expect(pb.authStore.token).toBe("");
  expect(queryClient.getQueryData(["pending"])).toBeUndefined();
});
