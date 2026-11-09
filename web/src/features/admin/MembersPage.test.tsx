import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { fontsReady } from "../../test/fontsReady";
import { imageFile, pixelURL } from "../../test/images";
import { MembersPage } from "./MembersPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;
type SendOptions = { method?: string; body?: Rec };

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null, listeners: new Set<() => void>() },
  // What the server holds; the mutations below change it, as the real ones do.
  db: {
    users: [] as Rec[],
    runners: [] as Rec[],
    invitations: [] as Rec[],
    passkeys: [] as Rec[],
  },
  runnersList: vi.fn<(options: Rec) => Promise<unknown>>(),
  invitationsList: vi.fn<(options: Rec) => Promise<unknown>>(),
  passkeysList: vi.fn<(options: Rec) => Promise<unknown>>(),
  runnerCreate: vi.fn<(body: Rec) => Promise<unknown>>(),
  runnerUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  runnerDelete: vi.fn<(id: string) => Promise<unknown>>(),
  userUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  passkeyDelete: vi.fn<(id: string) => Promise<unknown>>(),
  send: vi.fn<(path: string, options: SendOptions) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  getURL: vi.fn<(record: Rec, filename: string, options: Rec) => string>(),
}));

/** Replaces the signed-in record and tells the listeners, as the auth store of the SDK does. */
function setRecord(record: Rec | null) {
  mocks.store.record = record;
  for (const listener of mocks.store.listeners) listener();
}

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      isValid: true,
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange(listener: () => void) {
        mocks.store.listeners.add(listener);
        return () => mocks.store.listeners.delete(listener);
      },
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    send: mocks.send,
    collection: (name: string) =>
      ({
        runners: {
          getFullList: mocks.runnersList,
          getFirstListItem: mocks.myRunner,
          create: mocks.runnerCreate,
          update: mocks.runnerUpdate,
          delete: mocks.runnerDelete,
        },
        invitations: { getFullList: mocks.invitationsList },
        users: { update: mocks.userUpdate },
        passkeys: { getFullList: mocks.passkeysList, delete: mocks.passkeyDelete },
      })[name],
    // Only called for a runner who has a photo: none has, unless a test says so.
    files: { getURL: mocks.getURL },
  },
}));

const base = {
  created: "2026-10-01 08:00:00.000Z",
  updated: "",
  collectionId: "",
  collectionName: "",
};

const user = (id: string, email: string, role: "member" | "admin", disabled = false) => ({
  ...base,
  id,
  email,
  role,
  disabled,
  collectionName: "users",
});

const runner = (id: string, name: string, userId = "") => ({ ...base, id, name, user: userId });

/** PocketBase writes a date-time as `YYYY-MM-DD HH:MM:SS.sssZ`. */
function pbDateTime(instant: Temporal.Instant): string {
  return instant.toString({ fractionalSecondDigits: 3 }).replace("T", " ");
}

/** An instant that many hours from now: the tests must not depend on the day they run. */
const inHours = (hours: number) => Temporal.Now.instant().add({ hours });

const ALICE_USER = "u-alice";
const NEW_LINK = "https://courses.example.test/invitation#fresh-t0ken-0123";

/** Alice (the admin who is signed in), Bob and Max have an account; Sam and Léa have none. */
function seed() {
  mocks.db.users = [
    user(ALICE_USER, "alice@example.test", "admin"),
    user("u-bob", "bob@example.test", "member"),
    user("u-max", "max@example.test", "member", true),
  ];
  mocks.db.runners = [
    runner("r-alice", "Alice", ALICE_USER),
    runner("r-bob", "Bob", "u-bob"),
    runner("r-max", "Max", "u-max"),
    runner("r-sam", "Sam"),
    runner("r-lea", "Léa"),
  ];
  mocks.db.invitations = [
    // Léa has been invited as an admin, and the link expires in a week.
    {
      ...base,
      id: "inv-lea",
      runner: "r-lea",
      kind: "invite",
      role: "admin",
      expires_at: pbDateTime(inHours(7 * 24)),
      used_at: "",
    },
    // Bob has been given a link to choose a new password.
    {
      ...base,
      id: "inv-bob",
      runner: "r-bob",
      kind: "reset",
      role: "member",
      expires_at: pbDateTime(inHours(3 * 24)),
      used_at: "",
    },
  ];
  mocks.db.passkeys = [
    {
      ...base,
      id: "pk1",
      user: "u-bob",
      name: "iPhone",
      created: "2026-10-01 08:30:00.000Z",
      last_used_at: "2026-10-20 18:45:00.000Z",
    },
    {
      ...base,
      id: "pk2",
      user: "u-bob",
      name: "PC du boulot",
      created: "2026-10-05 09:00:00.000Z",
      last_used_at: "",
    },
  ];
}

const findRunner = (id: string) => mocks.db.runners.find((r) => r.id === id);

function installServer() {
  mocks.runnersList.mockImplementation(() =>
    Promise.resolve(
      mocks.db.runners.map((r) => {
        const account = mocks.db.users.find((u) => u.id === r.user);
        return { ...r, expand: account ? { user: account } : {} };
      }),
    ),
  );
  mocks.invitationsList.mockImplementation(() =>
    Promise.resolve(mocks.db.invitations.filter((i) => i.used_at === "")),
  );
  mocks.passkeysList.mockImplementation((options) => {
    const filter = String(options.filter);
    return Promise.resolve(mocks.db.passkeys.filter((k) => filter.includes(`"${String(k.user)}"`)));
  });
  mocks.myRunner.mockResolvedValue(runner("r-alice", "Alice", ALICE_USER));
  mocks.runnerCreate.mockImplementation((body) => {
    mocks.db.runners.push(runner("r-new", String(body.name)));
    return Promise.resolve({});
  });
  mocks.runnerUpdate.mockImplementation((id, body) => {
    Object.assign(findRunner(id) ?? {}, body);
    return Promise.resolve({});
  });
  mocks.runnerDelete.mockImplementation((id) => {
    mocks.db.runners = mocks.db.runners.filter((r) => r.id !== id);
    return Promise.resolve(true);
  });
  mocks.userUpdate.mockImplementation((id, body) => {
    const account = mocks.db.users.find((u) => u.id === id);
    Object.assign(account ?? {}, body);
    // The SDK keeps the auth store in line with a change of the signed-in account.
    if (id === ALICE_USER && account) setRecord({ ...account });
    return Promise.resolve(account);
  });
  mocks.passkeyDelete.mockImplementation((id) => {
    mocks.db.passkeys = mocks.db.passkeys.filter((k) => k.id !== id);
    return Promise.resolve(true);
  });
  mocks.send.mockImplementation((path, { method, body = {} }) => {
    if (method === "POST" && path === "/api/app/invitations") {
      // Creating a link replaces the pending one of the same kind.
      mocks.db.invitations = mocks.db.invitations.filter(
        (i) => !(i.runner === body.runnerId && i.kind === body.kind),
      );
      mocks.db.invitations.push({
        ...base,
        id: "inv-new",
        runner: body.runnerId,
        kind: body.kind,
        role: body.role ?? "member",
        expires_at: pbDateTime(inHours(7 * 24)),
        used_at: "",
      });
      return Promise.resolve({
        url: NEW_LINK,
        expiresAt: inHours(7 * 24).toString({ fractionalSecondDigits: 0 }),
      });
    }
    const revoked = /^\/api\/app\/invitations\/(.+)$/.exec(path)?.[1];
    if (method === "DELETE" && revoked !== undefined) {
      mocks.db.invitations = mocks.db.invitations.filter((i) => i.id !== revoked);
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected request ${method} ${path}`));
  });
}

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
  mocks.store.listeners.clear();
  mocks.store.record = { ...user(ALICE_USER, "alice@example.test", "admin") };
  seed();
  installServer();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await page.viewport(414, 896);
});

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

/** How a route of the application refuses: the status, and a code. */
const coded = (status: number, code: string) => refusal(status, { code });

/** How PocketBase reports the fields it refused. */
const fieldRefusal = (field: string, code: string) =>
  refusal(400, { [field]: { code, message: "…" } });

async function renderPage(languages = ["fr-FR"]) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const root = createRootRoute({ component: Outlet });
  const members = createRoute({
    getParentRoute: () => root,
    path: "/admin/membres",
    component: MembersPage,
  });
  const home = createRoute({
    getParentRoute: () => root,
    path: "/",
    component: () => <p>Page d'accueil</p>,
  });
  const router = createRouter({
    routeTree: root.addChildren([members, home]),
    history: createMemoryHistory({ initialEntries: ["/admin/membres"] }),
  });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("heading", { level: 2, name: "Alice" })).toBeVisible();
  return { screen, router, queryClient };
}

type Screen = Awaited<ReturnType<typeof renderPage>>["screen"];

const t = fr.admin;

/** The row of a runner, by its name (not by its text: a date says "sam." too). */
const row = (screen: Screen, name: string) =>
  screen
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { level: 2, name, exact: true }) });

/** A line of the row of a runner (its state, its email...), whole. */
const status = (screen: Screen, name: string, text: string) =>
  row(screen, name).getByText(text, { exact: true });

/** The button of an action of the page, by the action and the runner it is about. */
const action = (screen: Screen, label: string, name: string) =>
  screen.getByRole("button", { name: t.forRunner(label, name), exact: true });

/** The day an instant is in Paris, as the French locale writes it. */
function frenchDay(expiresAt: string): string {
  const day = Temporal.Instant.from(expiresAt.replace(" ", "T"))
    .toZonedDateTimeISO("Europe/Paris")
    .toPlainDate();
  return createFormatters("fr-FR").dateLong(day);
}

const expiryOf = (id: string) => String(mocks.db.invitations.find((i) => i.id === id)?.expires_at);

const heading = (screen: Screen, name: string) =>
  screen.getByRole("heading", { level: 2, name, exact: true });

// --- The list ---

test("MembersPage — liste les coureurs avec leur état, leur rôle et l'email de leur compte", async () => {
  const { screen } = await renderPage();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: t.membersTitle }))
    .toBeVisible();
  await expect
    .element(status(screen, "Alice", `${t.stateActive} · ${t.roles.admin}`))
    .toBeVisible();
  await expect.element(status(screen, "Alice", "alice@example.test")).toBeVisible();
  await expect.element(status(screen, "Bob", `${t.stateActive} · ${t.roles.member}`)).toBeVisible();
  await expect.element(status(screen, "Bob", "bob@example.test")).toBeVisible();
  await expect
    .element(status(screen, "Max", `${t.stateDisabled} · ${t.roles.member}`))
    .toBeVisible();
  await expect.element(status(screen, "Sam", t.stateNoAccount)).toBeVisible();
  await expect
    .element(status(screen, "Léa", t.stateInvited(frenchDay(expiryOf("inv-lea")))))
    .toBeVisible();
});

test("MembersPage — un lien de réinitialisation en attente est annoncé avec sa date d'expiration", async () => {
  const { screen } = await renderPage();

  await expect
    .element(status(screen, "Bob", t.resetPending(frenchDay(expiryOf("inv-bob")))))
    .toBeVisible();
});

test("MembersPage — une invitation expirée ne compte plus : le coureur est sans compte", async () => {
  const lea = mocks.db.invitations.find((i) => i.id === "inv-lea");
  if (lea) lea.expires_at = pbDateTime(inHours(-24));

  const { screen } = await renderPage();

  await expect.element(status(screen, "Léa", t.stateNoAccount)).toBeVisible();
  await expect.element(action(screen, t.invite, "Léa")).toBeVisible();
});

test("MembersPage — les actions offertes dépendent de l'état du coureur", async () => {
  const { screen } = await renderPage();

  const names = (label: string, who: string) => action(screen, label, who);
  // No account: it can be invited, not reset.
  await expect.element(names(t.invite, "Sam")).toBeVisible();
  await expect.element(names(t.resetLink, "Sam")).not.toBeInTheDocument();
  await expect.element(names(t.makeAdmin, "Sam")).not.toBeInTheDocument();
  // Invited: the link is made again or revoked.
  await expect.element(names(t.regenerate, "Léa")).toBeVisible();
  await expect.element(names(t.revokeInvite, "Léa")).toBeVisible();
  await expect.element(names(t.invite, "Léa")).not.toBeInTheDocument();
  // An account: reset, role, deactivation, passkeys.
  await expect.element(names(t.resetLink, "Bob")).toBeVisible();
  await expect.element(names(t.makeAdmin, "Bob")).toBeVisible();
  await expect.element(names(t.disable, "Bob")).toBeVisible();
  await expect.element(names(t.passkeys, "Bob")).toBeVisible();
  await expect.element(names(t.invite, "Bob")).not.toBeInTheDocument();
  await expect.element(names(t.removeAdmin, "Alice")).toBeVisible();
  await expect.element(names(t.enable, "Max")).toBeVisible();
  await expect.element(names(t.disable, "Max")).not.toBeInTheDocument();
  // Everybody can be renamed.
  for (const who of ["Alice", "Bob", "Max", "Sam", "Léa"]) {
    await expect.element(names(t.rename, who)).toBeVisible();
  }
  // A runner with an account is not deleted (its account is disabled instead).
  for (const who of ["Sam", "Léa"]) {
    await expect.element(names(fr.common.delete, who)).toBeVisible();
  }
  for (const who of ["Alice", "Bob", "Max"]) {
    await expect.element(names(fr.common.delete, who)).not.toBeInTheDocument();
  }
});

test("MembersPage — la page est en anglais pour un navigateur anglais", async () => {
  const { screen } = await renderPage(["en-GB"]);

  await expect
    .element(screen.getByRole("heading", { level: 1, name: en.admin.membersTitle }))
    .toBeVisible();
  await expect.element(status(screen, "Sam", en.admin.stateNoAccount)).toBeVisible();
});

test("MembersPage — une liste qui ne vient pas affiche l'erreur, et Réessayer la redemande", async () => {
  mocks.runnersList.mockRejectedValueOnce(refusal(500, {}));
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <RouterProvider
            router={createRouter({
              routeTree: createRootRoute({ component: MembersPage }),
              history: createMemoryHistory({ initialEntries: ["/"] }),
            })}
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await screen.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(heading(screen, "Alice")).toBeVisible();
});

// --- Runners: create, rename, delete ---

test("MembersPage — Ajouter un coureur : le nom est envoyé, la liste est à jour et on le dit", async () => {
  const { screen } = await renderPage();

  await screen.getByRole("button", { name: t.addRunner }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTitle });
  await dialog.getByLabelText(t.runnerName, { exact: true }).fill("  Zoé ");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect.element(heading(screen, "Zoé")).toBeVisible();
  expect(mocks.runnerCreate).toHaveBeenCalledExactlyOnceWith({ name: "Zoé" });
  await expect.element(screen.getByText(t.created)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("MembersPage — un nom déjà pris est refusé sous le champ, la fenêtre reste ouverte", async () => {
  mocks.runnerCreate.mockRejectedValue(fieldRefusal("name", "validation_not_unique"));
  const { screen } = await renderPage();

  await screen.getByRole("button", { name: t.addRunner }).click();
  const dialog = screen.getByRole("dialog", { name: t.createTitle });
  await dialog.getByLabelText(t.runnerName, { exact: true }).fill("alice");
  await dialog.getByRole("button", { name: t.createSubmit }).click();

  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_not_unique);
  await expect.element(dialog.getByLabelText(t.runnerName, { exact: true })).toHaveValue("alice");
});

test("MembersPage — Renommer envoie le nouveau nom et le montre dans la liste", async () => {
  const { screen } = await renderPage();

  await action(screen, t.rename, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.renameTitle });
  const name = dialog.getByLabelText(t.runnerName, { exact: true });
  await expect.element(name).toHaveValue("Sam");
  await name.fill("Samuel");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(heading(screen, "Samuel")).toBeVisible();
  expect(mocks.runnerUpdate).toHaveBeenCalledExactlyOnceWith("r-sam", { name: "Samuel" });
  await expect.element(heading(screen, "Sam")).not.toBeInTheDocument();
  await expect.element(screen.getByText(t.renamed)).toBeVisible();
});

test("MembersPage — Supprimer demande confirmation, supprime, et le focus va au titre de la page", async () => {
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.deleteTitle });
  await expect.element(dialog.getByText(t.deleteWarning("Sam"))).toBeVisible();
  expect(mocks.runnerDelete).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(heading(screen, "Sam")).not.toBeInTheDocument();
  expect(mocks.runnerDelete).toHaveBeenCalledExactlyOnceWith("r-sam");
  await expect.element(screen.getByText(t.deleted)).toBeVisible();
  // The row went away with the button that was pressed: the focus must not fall to the body.
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(
      screen.getByRole("heading", { level: 1, name: t.membersTitle }).element(),
    );
  });
});

test("MembersPage — Annuler ne supprime rien et rend le focus au bouton", async () => {
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Sam").click();
  await screen
    .getByRole("dialog", { name: t.deleteTitle })
    .getByRole("button", { name: fr.common.cancel })
    .click();

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.runnerDelete).not.toHaveBeenCalled();
  await expect.element(action(screen, fr.common.delete, "Sam")).toHaveFocus();
});

test("MembersPage — un coureur qui a des participations ne se supprime pas : le refus est dit", async () => {
  mocks.runnerDelete.mockRejectedValue(coded(400, "runner_has_participations"));
  const { screen } = await renderPage();

  await action(screen, fr.common.delete, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.deleteTitle });
  await dialog.getByRole("button", { name: fr.common.delete }).click();

  await expect
    .element(dialog.getByRole("alert"))
    .toHaveTextContent(fr.errors.runner_has_participations);
  await expect.element(dialog.getByRole("button", { name: fr.common.delete })).toBeEnabled();
  expect(mocks.db.runners.map((r) => r.name)).toContain("Sam");
});

test("MembersPage — le coureur a eu un compte entre-temps : le refus est dit, et la liste est redemandée", async () => {
  mocks.runnerDelete.mockRejectedValue(coded(400, "runner_has_account"));
  const { screen } = await renderPage();
  const before = mocks.runnersList.mock.calls.length;

  await action(screen, fr.common.delete, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.deleteTitle });
  await dialog.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.runner_has_account);
  await vi.waitFor(() => {
    expect(mocks.runnersList.mock.calls.length).toBeGreaterThan(before);
  });
});

// --- Invitations ---

test("MembersPage — Inviter : on choisit le rôle (membre par défaut), le lien s'affiche et la liste est à jour", async () => {
  const { screen, queryClient } = await renderPage();

  await action(screen, t.invite, "Sam").click();
  const invite = screen.getByRole("dialog", { name: t.inviteTitle("Sam") });
  await expect.element(invite.getByRole("radio", { name: t.roles.member })).toBeChecked();
  await invite.getByRole("button", { name: t.createLink }).click();

  const share = screen.getByRole("dialog", { name: t.shareTitle.invite("Sam") });
  await expect.element(share.getByLabelText(t.link, { exact: true })).toHaveValue(NEW_LINK);
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("/api/app/invitations", {
    method: "POST",
    body: { runnerId: "r-sam", kind: "invite", role: "member", lang: "fr" },
  });
  // Nothing of the link is kept by the cache: it is in the dialog, and only there.
  const cached = JSON.stringify([
    ...queryClient
      .getQueryCache()
      .getAll()
      .map((query) => query.state.data),
    ...queryClient
      .getMutationCache()
      .getAll()
      .map((mutation) => mutation.state.data),
  ]);
  expect(cached).not.toContain("fresh-t0ken");

  await share.getByRole("button", { name: fr.common.close }).click();
  await expect
    .element(status(screen, "Sam", t.stateInvited(frenchDay(expiryOf("inv-new")))))
    .toBeVisible();
  // Closed: the link is gone from the page.
  expect(document.body.innerHTML).not.toContain("fresh-t0ken");
});

test("MembersPage — Inviter : une invitation qui arrive avec son message le montre dans le partage", async () => {
  const MESSAGE = "Salut Sam, voici ton invitation. https://example.test/invitation#fresh-t0ken";
  const answer = mocks.send.getMockImplementation();
  mocks.send.mockImplementationOnce(async (...args) => {
    const sent: unknown = await answer?.(...args);
    return { ...(typeof sent === "object" ? sent : {}), message: MESSAGE };
  });
  const { screen } = await renderPage();

  await action(screen, t.invite, "Sam").click();
  const invite = screen.getByRole("dialog", { name: t.inviteTitle("Sam") });
  await invite.getByRole("button", { name: t.createLink }).click();

  const share = screen.getByRole("dialog", { name: t.shareTitle.invite("Sam") });
  await expect.element(share.getByRole("radio", { name: t.shareMessage })).toBeChecked();
  await expect.element(share.getByLabelText(t.messageLabel, { exact: true })).toHaveValue(MESSAGE);
});

test("MembersPage — Inviter en admin envoie le rôle admin", async () => {
  const { screen } = await renderPage();

  await action(screen, t.invite, "Sam").click();
  const invite = screen.getByRole("dialog", { name: t.inviteTitle("Sam") });
  await invite.getByRole("radio", { name: t.roles.admin }).click();
  await invite.getByRole("button", { name: t.createLink }).click();

  await expect
    .element(screen.getByRole("dialog", { name: t.shareTitle.invite("Sam") }))
    .toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/invitations", {
    method: "POST",
    body: { runnerId: "r-sam", kind: "invite", role: "admin", lang: "fr" },
  });
});

test("MembersPage — fermer la fenêtre du lien ne laisse pas le focus tomber sur le body", async () => {
  const { screen } = await renderPage();

  await action(screen, t.invite, "Sam").click();
  await screen
    .getByRole("dialog", { name: t.inviteTitle("Sam") })
    .getByRole("button", { name: t.createLink })
    .click();
  const share = screen.getByRole("dialog", { name: t.shareTitle.invite("Sam") });
  await expect.element(share).toBeVisible();
  await share.getByRole("button", { name: fr.common.close }).click();

  // The button that started it is now the one that makes a new invitation.
  await expect.element(action(screen, t.regenerate, "Sam")).toBeVisible();
  await vi.waitFor(() => {
    expect(row(screen, "Sam").element().contains(document.activeElement)).toBe(true);
  });
  expect(document.activeElement).not.toBe(document.body);
});

test("MembersPage — Régénérer propose le rôle de l'invitation en attente et refait un lien", async () => {
  const { screen } = await renderPage();

  await action(screen, t.regenerate, "Léa").click();
  const dialog = screen.getByRole("dialog", { name: t.regenerateTitle("Léa") });
  await expect.element(dialog.getByRole("radio", { name: t.roles.admin })).toBeChecked();
  await expect.element(dialog.getByText(t.regenerateWarning)).toBeVisible();
  await dialog.getByRole("button", { name: t.createLink }).click();

  await expect
    .element(screen.getByRole("dialog", { name: t.shareTitle.invite("Léa") }))
    .toBeVisible();
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("/api/app/invitations", {
    method: "POST",
    body: { runnerId: "r-lea", kind: "invite", role: "admin", lang: "fr" },
  });
});

test("MembersPage — Révoquer l'invitation demande confirmation, puis le coureur est sans compte", async () => {
  const { screen } = await renderPage();

  await action(screen, t.revokeInvite, "Léa").click();
  const dialog = screen.getByRole("dialog", { name: t.revoke.invite.title });
  await expect.element(dialog.getByText(t.revoke.invite.warning("Léa"))).toBeVisible();
  expect(mocks.send).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: t.revokeConfirm }).click();

  await expect.element(status(screen, "Léa", t.stateNoAccount)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("/api/app/invitations/inv-lea", {
    method: "DELETE",
  });
  await expect.element(screen.getByText(t.revoke.invite.done)).toBeVisible();
  // The button that opened the dialog is gone: the focus goes to the name of the runner.
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(heading(screen, "Léa").element());
  });
});

test("MembersPage — Lien de réinitialisation : un lien sans rôle, partagé", async () => {
  const { screen } = await renderPage();

  await action(screen, t.resetLink, "Max").click();
  const dialog = screen.getByRole("dialog", { name: t.resetTitle("Max") });
  await expect.element(dialog.getByRole("radio")).not.toBeInTheDocument();
  expect(mocks.send).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: t.createLink }).click();

  const share = screen.getByRole("dialog", { name: t.shareTitle.reset("Max") });
  await expect.element(share.getByLabelText(t.link, { exact: true })).toHaveValue(NEW_LINK);
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("/api/app/invitations", {
    method: "POST",
    body: { runnerId: "r-max", kind: "reset", lang: "fr" },
  });
});

test("MembersPage — un nouveau lien de réinitialisation prévient que l'ancien ne marchera plus", async () => {
  const { screen } = await renderPage();

  await action(screen, t.resetLink, "Bob").click();

  await expect
    .element(
      screen.getByRole("dialog", { name: t.resetTitle("Bob") }).getByText(t.regenerateWarning),
    )
    .toBeVisible();
});

test("MembersPage — Révoquer un lien de réinitialisation en attente", async () => {
  const { screen } = await renderPage();
  // The invitation is gone from the server once revoked: say what the line was before.
  const pending = t.resetPending(frenchDay(expiryOf("inv-bob")));
  await expect.element(status(screen, "Bob", pending)).toBeVisible();

  await action(screen, t.revokeReset, "Bob").click();
  const dialog = screen.getByRole("dialog", { name: t.revoke.reset.title });
  await expect.element(dialog.getByText(t.revoke.reset.warning("Bob"))).toBeVisible();
  await dialog.getByRole("button", { name: t.revokeConfirm }).click();

  await expect.element(status(screen, "Bob", pending)).not.toBeInTheDocument();
  await expect.element(row(screen, "Bob")).toBeVisible();
  expect(mocks.send).toHaveBeenCalledExactlyOnceWith("/api/app/invitations/inv-bob", {
    method: "DELETE",
  });
});

test("MembersPage — trop de demandes (429) : un message lisible, rien n'est partagé", async () => {
  mocks.send.mockRejectedValue(refusal(429, {}));
  const { screen } = await renderPage();

  await action(screen, t.invite, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.inviteTitle("Sam") });
  await dialog.getByRole("button", { name: t.createLink }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(t.rateLimited);
  await expect.element(dialog.getByRole("button", { name: t.createLink })).toBeEnabled();
  await expect
    .element(screen.getByRole("dialog", { name: t.shareTitle.invite("Sam") }))
    .not.toBeInTheDocument();
});

test("MembersPage — le coureur a changé de situation entre-temps : le refus est dit, et la liste est redemandée", async () => {
  mocks.send.mockRejectedValue(coded(400, "invitation_kind_mismatch"));
  const { screen } = await renderPage();
  const before = mocks.runnersList.mock.calls.length;

  await action(screen, t.invite, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: t.inviteTitle("Sam") });
  await dialog.getByRole("button", { name: t.createLink }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(t.kindMismatch);
  await vi.waitFor(() => {
    expect(mocks.runnersList.mock.calls.length).toBeGreaterThan(before);
  });
});

// --- Roles and deactivation ---

test("MembersPage — Passer admin change le rôle tout de suite et le dit", async () => {
  const { screen } = await renderPage();

  await action(screen, t.makeAdmin, "Bob").click();

  await expect.element(status(screen, "Bob", `${t.stateActive} · ${t.roles.admin}`)).toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledExactlyOnceWith("u-bob", { role: "admin" });
  await expect.element(screen.getByText(t.roleChanged)).toBeVisible();
  await expect.element(action(screen, t.removeAdmin, "Bob")).toBeVisible();
});

test("MembersPage — un deuxième toucher pendant qu'une action est en cours est ignoré", async () => {
  const update = Promise.withResolvers<unknown>();
  mocks.userUpdate.mockReturnValue(update.promise);
  const { screen } = await renderPage();
  const button = action(screen, t.makeAdmin, "Bob");

  await button.click();
  await expect.element(button).toHaveAttribute("aria-disabled", "true");
  // A disabled button would drop the focus: this one stays focusable, and ignores the tap.
  expect(button.element().hasAttribute("disabled")).toBe(false);
  button.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(mocks.userUpdate).toHaveBeenCalledOnce();
  update.resolve({});

  await expect.element(button).not.toHaveAttribute("aria-disabled");
  expect(mocks.userUpdate).toHaveBeenCalledOnce();
});

test("MembersPage — Retirer admin demande confirmation", async () => {
  mocks.db.users[1] = { ...user("u-bob", "bob@example.test", "admin") };
  const { screen } = await renderPage();

  await action(screen, t.removeAdmin, "Bob").click();
  const dialog = screen.getByRole("dialog", { name: t.demoteTitle });
  await expect.element(dialog.getByText(t.demoteWarning("Bob"))).toBeVisible();
  expect(mocks.userUpdate).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: t.removeAdmin, exact: true }).click();

  await expect.element(status(screen, "Bob", `${t.stateActive} · ${t.roles.member}`)).toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledExactlyOnceWith("u-bob", { role: "member" });
});

test("MembersPage — retirer le dernier admin est refusé : last_admin est dit dans la fenêtre", async () => {
  mocks.userUpdate.mockRejectedValue(coded(400, "last_admin"));
  const { screen } = await renderPage();

  await action(screen, t.removeAdmin, "Alice").click();
  const dialog = screen.getByRole("dialog", { name: t.demoteTitle });
  await dialog.getByRole("button", { name: t.removeAdmin, exact: true }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.last_admin);
  await expect
    .element(dialog.getByRole("button", { name: t.removeAdmin, exact: true }))
    .toBeEnabled();
  await expect
    .element(status(screen, "Alice", `${t.stateActive} · ${t.roles.admin}`))
    .toBeVisible();
});

test("MembersPage — Désactiver demande confirmation, puis le compte est désactivé", async () => {
  const { screen } = await renderPage();

  await action(screen, t.disable, "Bob").click();
  const dialog = screen.getByRole("dialog", { name: t.disableTitle });
  await expect.element(dialog.getByText(t.disableWarning("Bob"))).toBeVisible();
  expect(mocks.userUpdate).not.toHaveBeenCalled();
  await dialog.getByRole("button", { name: t.disable, exact: true }).click();

  await expect
    .element(status(screen, "Bob", `${t.stateDisabled} · ${t.roles.member}`))
    .toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledExactlyOnceWith("u-bob", { disabled: true });
  await expect.element(screen.getByText(t.disabledDone)).toBeVisible();
  await expect.element(action(screen, t.enable, "Bob")).toBeVisible();
});

test("MembersPage — désactiver le dernier admin est refusé : last_admin est dit dans la fenêtre", async () => {
  mocks.userUpdate.mockRejectedValue(coded(400, "last_admin"));
  const { screen } = await renderPage();

  await action(screen, t.disable, "Alice").click();
  const dialog = screen.getByRole("dialog", { name: t.disableTitle });
  await dialog.getByRole("button", { name: t.disable, exact: true }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.last_admin);
});

test("MembersPage — Réactiver rouvre le compte tout de suite", async () => {
  const { screen } = await renderPage();

  await action(screen, t.enable, "Max").click();

  await expect.element(status(screen, "Max", `${t.stateActive} · ${t.roles.member}`)).toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledExactlyOnceWith("u-max", { disabled: false });
  await expect.element(screen.getByText(t.enabledDone)).toBeVisible();
});

test("MembersPage — un refus d'une action directe est dit dans une notification", async () => {
  mocks.userUpdate.mockRejectedValue(coded(403, "forbidden"));
  const { screen } = await renderPage();

  await action(screen, t.makeAdmin, "Bob").click();

  await expect.element(screen.getByText(fr.errors.forbidden)).toBeVisible();
  await expect.element(status(screen, "Bob", `${t.stateActive} · ${t.roles.member}`)).toBeVisible();
});

test("MembersPage — un admin qui se retire le rôle admin quitte la page", async () => {
  const { screen, router } = await renderPage();

  await action(screen, t.removeAdmin, "Alice").click();
  await screen
    .getByRole("dialog", { name: t.demoteTitle })
    .getByRole("button", { name: t.removeAdmin, exact: true })
    .click();

  await vi.waitFor(() => {
    expect(router.state.location.pathname).toBe("/");
  });
  await expect.element(screen.getByText("Page d'accueil")).toBeVisible();
});

// --- The photo ---

test("MembersPage — chaque coureur a l'action « Photo », y compris un coureur sans compte ; elle ouvre la fenêtre « Photo de Sam »", async () => {
  const { screen } = await renderPage();

  for (const who of ["Alice", "Bob", "Max", "Sam", "Léa"]) {
    await expect.element(action(screen, fr.avatar.title, who)).toBeVisible();
  }
  await action(screen, fr.avatar.title, "Sam").click();

  const dialog = screen.getByRole("dialog", { name: fr.avatar.titleFor("Sam") });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByLabelText(fr.avatar.change)).toBeInTheDocument();
  // Sam has no photo: nothing to remove.
  await expect
    .element(dialog.getByRole("button", { name: fr.avatar.remove }))
    .not.toBeInTheDocument();
});

test("MembersPage — chaque ligne montre la photo du coureur, ou ses initiales, avant son nom", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const bob = findRunner("r-bob");
  if (bob) bob.avatar = "bob_x1y2z3.webp";
  const { screen } = await renderPage();

  const bobRow = row(screen, "Bob");
  const image = bobRow.element().querySelector("img");
  expect(image?.getAttribute("alt")).toBe("");
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: "r-bob" }),
    "bob_x1y2z3.webp",
    { thumb: "96x96" },
  );
  const name = heading(screen, "Bob").element();
  expect(
    (image?.compareDocumentPosition(name) ?? 0) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(image?.getBoundingClientRect().right).toBeLessThanOrEqual(
    name.getBoundingClientRect().left,
  );
  // Sam has none: the initial.
  await expect.element(row(screen, "Sam").getByText("S", { exact: true })).toBeVisible();
  expect(row(screen, "Sam").element().querySelector("img")).toBeNull();
});

test("MembersPage — une photo mise dans la fenêtre y apparaît aussitôt, avec « Retirer la photo », et dans la liste", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  mocks.runnerUpdate.mockImplementation((id, body) => {
    // What the server does with a file: it keeps its name.
    if (body instanceof FormData)
      Object.assign(findRunner(id) ?? {}, { avatar: "sam_n3w0000.webp" });
    return Promise.resolve({});
  });
  const { screen } = await renderPage();
  await action(screen, fr.avatar.title, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: fr.avatar.titleFor("Sam") });

  await dialog.getByLabelText(fr.avatar.change).upload(await imageFile(1200, 900));

  await expect.element(dialog.getByRole("status")).toHaveTextContent(fr.avatar.saved);
  expect(mocks.runnerUpdate).toHaveBeenCalledOnce();
  expect(mocks.runnerUpdate.mock.calls[0]?.[0]).toBe("r-sam");
  // The window follows the list, which was read again.
  await expect.element(dialog.getByRole("button", { name: fr.avatar.remove })).toBeVisible();
  expect(dialog.element().querySelector("img")).not.toBeNull();
  await expect.element(row(screen, "Sam").getByText("S", { exact: true })).not.toBeInTheDocument();
});

test("MembersPage — retirer la photo dans la fenêtre envoie {avatar: null} pour ce coureur", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  const sam = findRunner("r-sam");
  if (sam) sam.avatar = "sam_old0000.webp";
  mocks.runnerUpdate.mockImplementation((id, body) => {
    Object.assign(findRunner(id) ?? {}, body);
    return Promise.resolve({});
  });
  const { screen } = await renderPage();
  await action(screen, fr.avatar.title, "Sam").click();
  const dialog = screen.getByRole("dialog", { name: fr.avatar.titleFor("Sam") });

  await dialog.getByRole("button", { name: fr.avatar.remove }).click();

  await expect.element(dialog.getByRole("status")).toHaveTextContent(fr.avatar.removed);
  // Said once, in the window, which covers the toasts: the live region is what says it.
  await expect.element(screen.getByText(fr.avatar.removed)).toBeVisible();
  expect(mocks.runnerUpdate).toHaveBeenCalledExactlyOnceWith("r-sam", { avatar: null });
  await expect
    .element(dialog.getByRole("button", { name: fr.avatar.remove }))
    .not.toBeInTheDocument();
});

// --- The passkeys of an account ---

test("MembersPage — Clés d'accès liste celles du compte, de ce compte seulement", async () => {
  const { screen } = await renderPage();

  await action(screen, t.passkeys, "Bob").click();
  const dialog = screen.getByRole("dialog", { name: t.passkeysTitle("Bob") });

  await expect.element(dialog.getByText("iPhone")).toBeVisible();
  await expect.element(dialog.getByText("PC du boulot")).toBeVisible();
  // A regular expression: a text with an accent only matches whole as a string.
  await expect.element(dialog.getByText(new RegExp(fr.passkeys.neverUsed))).toBeVisible();
  expect(mocks.passkeysList).toHaveBeenCalledOnce();
  expect(String(mocks.passkeysList.mock.calls[0]?.[0].filter)).toContain('"u-bob"');
});

test("MembersPage — des clés qui ne viennent pas : l'erreur est dite, et Réessayer les redemande", async () => {
  mocks.passkeysList.mockRejectedValueOnce(refusal(500, {}));
  const { screen } = await renderPage();

  await action(screen, t.passkeys, "Bob").click();
  const dialog = screen.getByRole("dialog", { name: t.passkeysTitle("Bob") });
  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await dialog.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(dialog.getByText("iPhone")).toBeVisible();
});

test("MembersPage — un compte sans clé le dit", async () => {
  const { screen } = await renderPage();

  await action(screen, t.passkeys, "Max").click();

  await expect
    .element(
      screen.getByRole("dialog", { name: t.passkeysTitle("Max") }).getByText(t.passkeysEmpty),
    )
    .toBeVisible();
});

test("MembersPage — supprimer une clé demande confirmation, la supprime et garde le focus dans la fenêtre", async () => {
  const { screen } = await renderPage();
  await action(screen, t.passkeys, "Bob").click();
  const list = screen.getByRole("dialog", { name: t.passkeysTitle("Bob") });

  await list.getByRole("button", { name: `${fr.common.delete} iPhone`, exact: true }).click();
  const confirm = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });
  await expect.element(confirm.getByText(t.passkeyRemoveWarning("iPhone", "Bob"))).toBeVisible();
  expect(mocks.passkeyDelete).not.toHaveBeenCalled();
  await confirm.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(list.getByText("iPhone")).not.toBeInTheDocument();
  expect(mocks.passkeyDelete).toHaveBeenCalledExactlyOnceWith("pk1");
  await expect.element(list.getByText("PC du boulot")).toBeVisible();
  await expect.element(screen.getByText(fr.passkeys.removed)).toBeVisible();
  await expect
    .element(screen.getByRole("dialog", { name: fr.passkeys.removeTitle }))
    .not.toBeInTheDocument();
  // The key that was deleted took its button with it: the focus stays in the window.
  await vi.waitFor(() => {
    expect(list.element().contains(document.activeElement)).toBe(true);
  });
});

test("MembersPage — un échec de la suppression d'une clé est dit dans la fenêtre de confirmation", async () => {
  mocks.passkeyDelete.mockRejectedValue(coded(404, "not_found"));
  const { screen } = await renderPage();
  await action(screen, t.passkeys, "Bob").click();
  await screen
    .getByRole("dialog", { name: t.passkeysTitle("Bob") })
    .getByRole("button", { name: `${fr.common.delete} iPhone`, exact: true })
    .click();

  const confirm = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });
  await confirm.getByRole("button", { name: fr.common.delete }).click();

  await expect.element(confirm.getByRole("alert")).toHaveTextContent(fr.errors.not_found);
});

// --- Layout ---

test("MembersPage — toutes les actions font au moins 44 px, y compris sur un petit écran", async () => {
  await page.viewport(320, 700);
  const { screen } = await renderPage();
  // Measured in the fonts of the site, not in those that stand in while they load.
  await fontsReady();

  const buttons = screen.getByRole("button").elements();
  expect(buttons.length).toBeGreaterThan(10);
  const tooSmall = buttons.filter((button) => {
    const { height, width } = button.getBoundingClientRect();
    return height < 44 || width < 44;
  });
  expect(tooSmall.map((button) => button.textContent)).toEqual([]);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
    document.documentElement.clientWidth,
  );
});
