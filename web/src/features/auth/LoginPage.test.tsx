import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { LoginPage } from "./LoginPage";

const authWithPassword = vi.hoisted(() =>
  vi.fn<(email: string, password: string) => Promise<unknown>>(),
);

vi.mock("../../lib/pb", () => ({
  pb: { collection: () => ({ authWithPassword }) },
}));

beforeEach(() => {
  authWithPassword.mockReset();
});

/** The login page at /connexion, with /agenda to land on. */
function renderLogin(redirect?: string) {
  const root = createRootRoute();
  const login = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <LoginPage redirect={redirect} />,
  });
  const agenda = createRoute({
    getParentRoute: () => root,
    path: "/agenda",
    component: () => <p>Page agenda</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([login, agenda]),
    history: createMemoryHistory({ initialEntries: ["/connexion"] }),
  });
  return render(
    <I18nProvider languages={["fr"]}>
      <RouterProvider router={router} />
    </I18nProvider>,
  );
}

function refusal(status: number) {
  return new ClientResponseError({
    status,
    response: { status, message: "Failed to authenticate.", data: {} },
  });
}

async function signIn(screen: Awaited<ReturnType<typeof renderLogin>>, password = "secret-pass") {
  await screen.getByLabelText(fr.auth.email).fill("alice@example.test");
  await screen.getByLabelText(fr.auth.password).fill(password);
  await screen.getByRole("button", { name: fr.auth.signIn }).click();
}

test("LoginPage — affiche t.auth.badCredentials quand authWithPassword rejette avec un 400, et garde l'email saisi", async () => {
  authWithPassword.mockRejectedValue(refusal(400));
  const screen = await renderLogin();

  await signIn(screen, "wrong-password");

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.auth.badCredentials);
  await expect.element(screen.getByLabelText(fr.auth.email)).toHaveValue("alice@example.test");
  // The password is not kept: a failed attempt starts the password over.
  await expect.element(screen.getByLabelText(fr.auth.password)).toHaveValue("");
  expect(authWithPassword).toHaveBeenCalledWith("alice@example.test", "wrong-password");
});

test("LoginPage — affiche t.errors.account_disabled quand authWithPassword rejette avec un 403", async () => {
  authWithPassword.mockRejectedValue(refusal(403));
  const screen = await renderLogin();

  await signIn(screen);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.account_disabled);
  await expect.element(screen.getByLabelText(fr.auth.email)).toHaveValue("alice@example.test");
});

test("LoginPage — affiche le message générique pour toute autre erreur (réseau, serveur)", async () => {
  authWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderLogin();

  await signIn(screen);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

test("LoginPage — navigue vers ?redirect après succès", async () => {
  authWithPassword.mockResolvedValue({ token: "t", record: { id: "u1" } });
  const screen = await renderLogin("/agenda");

  await signIn(screen);

  await expect.element(screen.getByText("Page agenda")).toBeVisible();
  expect(authWithPassword).toHaveBeenCalledWith("alice@example.test", "secret-pass");
});
