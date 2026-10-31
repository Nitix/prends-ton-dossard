import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { useSession } from "./session";

type StoredRecord = { id: string; collectionName: string; email: string; role: string };

const store = vi.hoisted(() => ({
  record: null as StoredRecord | null,
  listeners: new Set<() => void>(),
  getFirstListItem: vi.fn<(filter: string) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return store.record && { ...store.record };
      },
      onChange(listener: () => void) {
        store.listeners.add(listener);
        return () => store.listeners.delete(listener);
      },
    },
    filter: (raw: string, params: Record<string, string>) => `${raw} ${JSON.stringify(params)}`,
    collection: () => ({ getFirstListItem: store.getFirstListItem }),
  },
}));

const alice: StoredRecord = {
  id: "u1",
  collectionName: "users",
  email: "alice@example.test",
  role: "member",
};

beforeEach(() => {
  store.record = null;
  store.listeners.clear();
  store.getFirstListItem.mockReset();
  store.getFirstListItem.mockResolvedValue({ id: "r1", name: "Alice", user: "u1" });
});

function Probe() {
  const { user, runner, isAdmin } = useSession();
  return (
    <p data-testid="session">
      {user?.email ?? "nobody"} / {runner?.name ?? "no runner"} / {isAdmin ? "admin" : "member"}
    </p>
  );
}

function renderProbe() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <Probe />
    </QueryClientProvider>,
  );
}

test("useSession — personne n'est connecté : pas d'utilisateur, pas de coureur, et aucune requête", async () => {
  const screen = await renderProbe();

  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("nobody / no runner / member");
  expect(store.getFirstListItem).not.toHaveBeenCalled();
});

test("useSession — rend l'utilisateur connecté et son coureur", async () => {
  store.record = alice;

  const screen = await renderProbe();

  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("alice@example.test / Alice / member");
  expect(store.getFirstListItem).toHaveBeenCalledWith('user = {:id} {"id":"u1"}');
});

test("useSession — un admin est reconnu comme tel", async () => {
  store.record = { ...alice, role: "admin" };

  const screen = await renderProbe();

  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("alice@example.test / Alice / admin");
});

test("useSession — suit le magasin d'authentification, d'une connexion à une déconnexion", async () => {
  const screen = await renderProbe();
  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("nobody / no runner / member");

  store.record = alice;
  for (const listener of store.listeners) listener();
  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("alice@example.test / Alice / member");

  store.record = null;
  for (const listener of store.listeners) listener();
  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("nobody / no runner / member");
});

test("useSession — ignore un enregistrement qui n'est pas d'un utilisateur", async () => {
  store.record = { ...alice, collectionName: "_superusers" };

  const screen = await renderProbe();

  await expect
    .element(screen.getByTestId("session"))
    .toHaveTextContent("nobody / no runner / member");
});
