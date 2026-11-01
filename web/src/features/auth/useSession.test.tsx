import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
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

function StateProbe() {
  const { runner, signedIn, runnerMissing } = useSession();
  return (
    <p data-testid="state">
      {signedIn ? "signed in" : "signed out"} / {runnerMissing ? "missing" : "not missing"} /{" "}
      {runner ? "runner" : "no runner"}
    </p>
  );
}

function renderState() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <StateProbe />
    </QueryClientProvider>,
  );
}

const notFound = () => new ClientResponseError({ status: 404, response: {} });

test("useSession — personne n'est connecté : pas de session, et pas de coureur manquant", async () => {
  const screen = await renderState();

  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed out / not missing / no runner");
});

test("useSession — le coureur n'est pas manquant tant que sa requête est en cours, ni une fois trouvé", async () => {
  store.record = alice;
  const answer = Promise.withResolvers<unknown>();
  store.getFirstListItem.mockReturnValue(answer.promise);

  const screen = await renderState();

  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed in / not missing / no runner");
  answer.resolve({ id: "r1", name: "Alice", user: "u1" });
  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed in / not missing / runner");
});

test("useSession — un membre dont le serveur dit qu'il n'a pas de coureur (404) : connecté, coureur manquant", async () => {
  store.record = alice;
  store.getFirstListItem.mockRejectedValue(notFound());

  const screen = await renderState();

  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed in / missing / no runner");
});

test("useSession — une panne en cherchant le coureur n'est pas une absence", async () => {
  store.record = alice;
  store.getFirstListItem.mockRejectedValue(new TypeError("Failed to fetch"));

  const screen = await renderState();

  await vi.waitFor(() => {
    expect(store.getFirstListItem).toHaveBeenCalledOnce();
  });
  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed in / not missing / no runner");
});

test("useSession — un compte qui n'est pas un membre est connecté, sans coureur, et on n'en cherche pas", async () => {
  store.record = { ...alice, collectionName: "_superusers" };

  const screen = await renderState();

  await expect
    .element(screen.getByTestId("state"))
    .toHaveTextContent("signed in / missing / no runner");
  expect(store.getFirstListItem).not.toHaveBeenCalled();
});
