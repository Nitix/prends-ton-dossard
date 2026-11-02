import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, expect, test, vi, type MockInstance } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { LoginPage } from "./LoginPage";
import { fakeCredential } from "./testCredential";

type SendOptions = { method?: string; body?: unknown; signal?: AbortSignal };

const authWithPassword = vi.hoisted(() =>
  vi.fn<(email: string, password: string) => Promise<unknown>>(),
);
const send = vi.hoisted(() => vi.fn<(path: string, options: SendOptions) => Promise<unknown>>());
const save = vi.hoisted(() => vi.fn<(token: string, record: unknown) => void>());

vi.mock("../../lib/pb", () => ({
  pb: { collection: () => ({ authWithPassword }), send, authStore: { save } },
}));

const LOGIN_BEGIN = "/api/app/passkeys/login/begin";
const LOGIN_FINISH = "/api/app/passkeys/login/finish";
const DEMO = "/api/app/demo";

const SESSION = { token: "passkey-token", record: { id: "u1", collectionName: "users" } };

/** What the browser gives back once the user has chosen a passkey. */
const credential = fakeCredential();

let isConditionalMediationAvailable: MockInstance<
  typeof PublicKeyCredential.isConditionalMediationAvailable
>;
let getCredential: MockInstance<CredentialsContainer["get"]>;
// The cache of the app, new for each test: the page asks if the site is a demo
// once, and keeps the answer.
let queryClient: QueryClient;

beforeEach(() => {
  authWithPassword.mockReset();
  send.mockReset();
  save.mockReset();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  send.mockImplementation((path) =>
    // The real site has no demo: PocketBase answers a 404 to its route.
    path === DEMO
      ? Promise.reject(refusal(404))
      : Promise.resolve(
          path === LOGIN_BEGIN
            ? {
                sessionId: "session-1",
                publicKey: {
                  challenge: "AAECAw",
                  rpId: "localhost",
                  userVerification: "preferred",
                },
              }
            : path === LOGIN_FINISH
              ? SESSION
              : null,
        ),
  );
  // Chromium may offer the passkeys in the autofill of the email field: the
  // tests that want it say so, the others must not start it.
  isConditionalMediationAvailable = vi
    .spyOn(PublicKeyCredential, "isConditionalMediationAvailable")
    .mockResolvedValue(false);
  getCredential = vi.spyOn(navigator.credentials, "get").mockResolvedValue(credential);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** The login page at /connexion, with / and /agenda to land on. */
function renderLogin(redirect?: string) {
  const root = createRootRoute();
  const login = createRoute({
    getParentRoute: () => root,
    path: "/connexion",
    component: () => <LoginPage redirect={redirect} />,
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Page d'accueil</p>,
  });
  const agenda = createRoute({
    getParentRoute: () => root,
    path: "/agenda",
    component: () => <p>Page agenda</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([login, home, agenda]),
    history: createMemoryHistory({ initialEntries: ["/connexion"] }),
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={["fr"]}>
        <RouterProvider router={router} />
      </I18nProvider>
    </QueryClientProvider>,
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

// --- Passkeys ---

/** What the browser does with the autofill request: it waits, until the page gives up. */
function waitUntilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener("abort", () => {
      reject(new DOMException("Aborted", "AbortError"));
    });
  });
}

/** Makes the autofill available: the browser then waits for the user to pick a passkey. */
function offerAutofill() {
  isConditionalMediationAvailable.mockResolvedValue(true);
  getCredential.mockImplementation((options) =>
    options?.mediation === "conditional"
      ? waitUntilAborted(options.signal)
      : Promise.resolve(credential),
  );
}

function codedRefusal(status: number, code: string) {
  return new ClientResponseError({ status, response: { status, message: "…", data: { code } } });
}

test("LoginPage — bouton passkey absent si PublicKeyCredential n'existe pas", async () => {
  vi.stubGlobal("PublicKeyCredential", undefined);

  const screen = await renderLogin();

  // The rest of the form is there: only the passkey button is hidden.
  await expect.element(screen.getByRole("button", { name: fr.auth.signIn })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.auth.passkeyLogin }))
    .not.toBeInTheDocument();
  expect(getCredential).not.toHaveBeenCalled();
});

test("LoginPage — le bouton passkey est là quand le navigateur gère WebAuthn", async () => {
  const screen = await renderLogin();

  await expect.element(screen.getByRole("button", { name: fr.auth.passkeyLogin })).toBeVisible();
});

test("LoginPage — le champ email est complété par les passkeys (autocomplete username webauthn)", async () => {
  const screen = await renderLogin();

  await expect
    .element(screen.getByLabelText(fr.auth.email))
    .toHaveAttribute("autocomplete", "username webauthn");
  await expect
    .element(screen.getByLabelText(fr.auth.password))
    .toHaveAttribute("autocomplete", "current-password");
});

test("LoginPage — le bouton passkey ne soumet pas le formulaire", async () => {
  const screen = await renderLogin();

  await expect
    .element(screen.getByRole("button", { name: fr.auth.passkeyLogin }))
    .toHaveAttribute("type", "button");
});

test("LoginPage — connexion par passkey : va vers ?redirect et garde la session", async () => {
  const screen = await renderLogin("/agenda");

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await expect.element(screen.getByText("Page agenda")).toBeVisible();
  expect(save).toHaveBeenCalledWith("passkey-token", SESSION.record);
  expect(authWithPassword).not.toHaveBeenCalled();
  // The button asks the browser for a prompt, not for the autofill.
  expect(getCredential.mock.calls[0]?.[0]?.mediation).toBeUndefined();
});

test("LoginPage — l'autofill est lancé au montage quand le navigateur le propose", async () => {
  offerAutofill();

  await renderLogin();

  await vi.waitFor(() => {
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
  expect(getCredential.mock.calls[0]?.[0]?.mediation).toBe("conditional");
  expect(getCredential.mock.calls[0]?.[0]?.signal?.aborted).toBe(false);
});

test("LoginPage — pas d'autofill quand le navigateur ne le propose pas", async () => {
  const screen = await renderLogin();
  await expect.element(screen.getByRole("button", { name: fr.auth.passkeyLogin })).toBeVisible();

  // Give a request that would be started on mount the time to reach the browser.
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(isConditionalMediationAvailable).toHaveBeenCalled();
  expect(getCredential).not.toHaveBeenCalled();
});

test("LoginPage — l'autofill est interrompu quand la page disparaît", async () => {
  offerAutofill();
  const screen = await renderLogin();
  await vi.waitFor(() => {
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
  const signal = getCredential.mock.calls[0]?.[0]?.signal;
  expect(signal?.aborted).toBe(false);

  await screen.unmount();

  expect(signal?.aborted).toBe(true);
});

test("LoginPage — choisir une passkey dans l'autofill connecte et va vers ?redirect", async () => {
  isConditionalMediationAvailable.mockResolvedValue(true);

  const screen = await renderLogin("/agenda");

  await expect.element(screen.getByText("Page agenda")).toBeVisible();
  expect(getCredential.mock.calls[0]?.[0]?.mediation).toBe("conditional");
  expect(save).toHaveBeenCalledWith("passkey-token", SESSION.record);
});

test("LoginPage — le clic sur le bouton interrompt l'autofill, puis demande la passkey", async () => {
  offerAutofill();
  // The prompt stays open until the test lets the user pick a passkey: the
  // page is still there when the autofill is checked.
  const prompt = Promise.withResolvers<PublicKeyCredential>();
  getCredential.mockImplementation((options) =>
    options?.mediation === "conditional" ? waitUntilAborted(options.signal) : prompt.promise,
  );
  const screen = await renderLogin("/agenda");
  await vi.waitFor(() => {
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
  const autofillSignal = getCredential.mock.calls[0]?.[0]?.signal;
  expect(autofillSignal?.aborted).toBe(false);

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await vi.waitFor(() => {
    expect(getCredential).toHaveBeenCalledTimes(2);
  });
  expect(autofillSignal?.aborted).toBe(true);
  expect(getCredential.mock.calls[1]?.[0]?.mediation).toBeUndefined();
  // An interrupted autofill is not a failure: nothing is said about it.
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();

  prompt.resolve(credential);
  await expect.element(screen.getByText("Page agenda")).toBeVisible();
  expect(save).toHaveBeenCalledTimes(1);
});

test("LoginPage — l'annulation de l'utilisateur (NotAllowedError) ne dit rien et laisse réessayer", async () => {
  getCredential.mockRejectedValue(new DOMException("The user cancelled", "NotAllowedError"));
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await vi.waitFor(() => {
    expect(getCredential).toHaveBeenCalledTimes(1);
  });
  await expect.element(screen.getByRole("button", { name: fr.auth.passkeyLogin })).toBeEnabled();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  expect(save).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalledWith(LOGIN_FINISH, expect.anything());
});

test("LoginPage — le bouton est désactivé pendant la vérification", async () => {
  const prompt = Promise.withResolvers<PublicKeyCredential>();
  getCredential.mockReturnValue(prompt.promise);
  const screen = await renderLogin("/agenda");

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await expect.element(screen.getByRole("button", { name: fr.auth.passkeyWaiting })).toBeDisabled();

  prompt.resolve(credential);
  await expect.element(screen.getByText("Page agenda")).toBeVisible();
});

test("LoginPage — une passkey refusée par le serveur affiche son message", async () => {
  send.mockImplementation((path) =>
    path === LOGIN_FINISH
      ? Promise.reject(codedRefusal(400, "passkey_failed"))
      : Promise.resolve({ sessionId: "s", publicKey: { challenge: "AAECAw" } }),
  );
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.passkey_failed);
  expect(save).not.toHaveBeenCalled();
});

test("LoginPage — un compte désactivé est dit, même avec une passkey", async () => {
  send.mockImplementation((path) =>
    path === LOGIN_FINISH
      ? Promise.reject(codedRefusal(400, "account_disabled"))
      : Promise.resolve({ sessionId: "s", publicKey: { challenge: "AAECAw" } }),
  );
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.account_disabled);
});

test("LoginPage — une panne (réseau, navigateur) affiche le message générique", async () => {
  send.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
});

test("LoginPage — l'erreur d'une passkey part dès qu'on se connecte avec le mot de passe", async () => {
  send.mockRejectedValue(codedRefusal(400, "passkey_failed"));
  authWithPassword.mockRejectedValue(refusal(400));
  const screen = await renderLogin();
  await screen.getByRole("button", { name: fr.auth.passkeyLogin }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.passkey_failed);

  await signIn(screen, "wrong-password");

  // One alert, the one of the last attempt.
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.auth.badCredentials);
});

// --- Demo ---

/** What a route of the demo answers: an Error is a refusal, a promise is returned as it is. */
function answer(value: unknown): Promise<unknown> {
  if (value instanceof Error) return Promise.reject(value);
  return value instanceof Promise ? value : Promise.resolve(value);
}

/**
 * Makes the site a demo: `enabled` is what the page is told when it asks
 * (GET), `session` what the button gets (POST).
 */
function serveDemo({ enabled, session }: { enabled: unknown; session?: unknown }) {
  const others = send.getMockImplementation();
  send.mockImplementation((path, options) => {
    if (path === DEMO) return answer(options.method === "POST" ? session : enabled);
    return others?.(path, options) ?? Promise.resolve(null);
  });
}

/** The requests that the page sent to the demo routes with that method. */
function demoRequests(method: "GET" | "POST") {
  return send.mock.calls.filter(([path, options]) => path === DEMO && options.method === method);
}

const DEMO_SESSION = { token: "demo-token", record: { id: "alice", collectionName: "users" } };

/** The page has asked whether the site is a demo, and has had the answer. */
async function demoAnswered() {
  await vi.waitFor(() => {
    expect(demoRequests("GET")).toHaveLength(1);
  });
  await vi.waitFor(() => {
    expect(queryClient.isFetching()).toBe(0);
  });
}

test("LoginPage — le bouton de démo n'apparaît que si la démo est active", async () => {
  // The answer is held back: the page does not show the button before it comes.
  const enabled = Promise.withResolvers<unknown>();
  serveDemo({ enabled: enabled.promise });
  const screen = await renderLogin();
  await vi.waitFor(() => {
    expect(demoRequests("GET")).toHaveLength(1);
  });
  await expect.element(screen.getByRole("button", { name: fr.auth.signIn })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.auth.demoEnter }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.auth.demoNote)).not.toBeInTheDocument();

  enabled.resolve({ enabled: true });

  const button = screen.getByRole("button", { name: fr.auth.demoEnter });
  await expect.element(button).toBeVisible();
  await expect.element(button).toHaveAttribute("type", "button");
  await expect.element(screen.getByText(fr.auth.demoNote)).toBeVisible();
  // The note is what the button is described by.
  await expect.element(button).toHaveAccessibleDescription(fr.auth.demoNote);
  // The other ways in stay.
  await expect.element(screen.getByLabelText(fr.auth.email)).toBeVisible();
  await expect.element(screen.getByLabelText(fr.auth.password)).toBeVisible();
  await expect.element(screen.getByRole("button", { name: fr.auth.signIn })).toBeVisible();
  await expect.element(screen.getByRole("button", { name: fr.auth.passkeyLogin })).toBeVisible();
});

test("LoginPage — pas de bouton de démo sur le vrai site (404)", async () => {
  // The routes do not exist there: the default answer of these tests.
  const screen = await renderLogin();

  await demoAnswered();

  await expect.element(screen.getByRole("button", { name: fr.auth.signIn })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.auth.demoEnter }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.auth.demoNote)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("LoginPage — pas de bouton de démo quand la demande échoue, et pas d'erreur non plus", async () => {
  serveDemo({ enabled: new TypeError("Failed to fetch") });
  const screen = await renderLogin();

  await demoAnswered();

  await expect.element(screen.getByRole("button", { name: fr.auth.signIn })).toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: fr.auth.demoEnter }))
    .not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
});

test("LoginPage — la page ne demande qu'une fois si le site est une démo", async () => {
  serveDemo({ enabled: { enabled: true } });
  const screen = await renderLogin();
  await expect.element(screen.getByRole("button", { name: fr.auth.demoEnter })).toBeVisible();

  // A login that fails is no reason to ask again.
  authWithPassword.mockRejectedValue(refusal(400));
  await signIn(screen, "wrong-password");
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.auth.badCredentials);

  expect(demoRequests("GET")).toHaveLength(1);
  expect(demoRequests("POST")).toHaveLength(0);
});

test("LoginPage — « Entrer dans la démo » connecte et mène à l'accueil", async () => {
  serveDemo({ enabled: { enabled: true }, session: DEMO_SESSION });
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.demoEnter }).click();

  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
  // Nothing is typed, nothing is sent: the account is the server's choice.
  expect(demoRequests("POST")).toHaveLength(1);
  expect(demoRequests("POST")[0]?.[1].body).toBeUndefined();
  expect(save).toHaveBeenCalledExactlyOnceWith("demo-token", DEMO_SESSION.record);
  expect(authWithPassword).not.toHaveBeenCalled();
});

test("LoginPage — « Entrer dans la démo » va vers ?redirect", async () => {
  serveDemo({ enabled: { enabled: true }, session: DEMO_SESSION });
  const screen = await renderLogin("/agenda");

  await screen.getByRole("button", { name: fr.auth.demoEnter }).click();

  await expect.element(screen.getByText("Page agenda")).toBeVisible();
  expect(save).toHaveBeenCalledExactlyOnceWith("demo-token", DEMO_SESSION.record);
});

test("LoginPage — le bouton de démo dit qu'il attend sans perdre le focus, et n'envoie qu'une fois", async () => {
  const session = Promise.withResolvers<unknown>();
  serveDemo({ enabled: { enabled: true }, session: session.promise });
  const screen = await renderLogin();
  const button = buttonOf(screen.getByRole("button", { name: fr.auth.demoEnter }));

  clickTwice(button);

  await expectBusy(button);
  expect(button).toHaveTextContent(fr.auth.signingIn);
  expect(demoRequests("POST")).toHaveLength(1);

  session.resolve(DEMO_SESSION);
  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
  expect(demoRequests("POST")).toHaveLength(1);
  expect(save).toHaveBeenCalledTimes(1);
});

test("LoginPage — la démo refusée affiche son message, rend la main au bouton et laisse réessayer", async () => {
  // The account of the demo is gone or disabled: the server answers its 404.
  serveDemo({ enabled: { enabled: true }, session: codedRefusal(404, "not_found") });
  const screen = await renderLogin();
  const button = buttonOf(screen.getByRole("button", { name: fr.auth.demoEnter }));

  clickTwice(button);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
  await expectAvailable(button);
  expect(button).toHaveTextContent(fr.auth.demoEnter);
  expect(demoRequests("POST")).toHaveLength(1);
  expect(save).not.toHaveBeenCalled();

  // Another try goes through.
  serveDemo({ enabled: { enabled: true }, session: DEMO_SESSION });
  button.click();

  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
  expect(demoRequests("POST")).toHaveLength(2);
  expect(save).toHaveBeenCalledExactlyOnceWith("demo-token", DEMO_SESSION.record);
});

test("LoginPage — une panne pendant la démo affiche le message générique", async () => {
  serveDemo({ enabled: { enabled: true }, session: new TypeError("Failed to fetch") });
  const screen = await renderLogin();

  await screen.getByRole("button", { name: fr.auth.demoEnter }).click();

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  expect(save).not.toHaveBeenCalled();
});

test("LoginPage — l'erreur de la démo part dès qu'on se connecte avec le mot de passe", async () => {
  serveDemo({ enabled: { enabled: true }, session: codedRefusal(404, "not_found") });
  authWithPassword.mockRejectedValue(refusal(400));
  const screen = await renderLogin();
  await screen.getByRole("button", { name: fr.auth.demoEnter }).click();
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.not_found);

  await signIn(screen, "wrong-password");

  // One alert, the one of the last attempt.
  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.auth.badCredentials);
});
