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
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { imageFile, pixelURL, sizeOf } from "../../test/images";
import { emulateMedia, resetMedia } from "../../test/media";
import { SettingsPage } from "./SettingsPage";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null, listeners: new Set<() => void>() },
  runner: { name: "Alice" },
  getFirstListItem: vi.fn<(filter: string) => Promise<unknown>>(),
  runnerUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  userUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  authWithPassword: vi.fn<(email: string, password: string) => Promise<unknown>>(),
  getFullList: vi.fn<(options: Rec) => Promise<unknown>>(),
  passkeyUpdate: vi.fn<(id: string, body: Rec) => Promise<unknown>>(),
  passkeyDelete: vi.fn<(id: string) => Promise<unknown>>(),
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
  save: vi.fn<(token: string, record: Rec) => void>(),
  clear: vi.fn<() => void>(),
  registerPasskey: vi.fn<(name: string) => Promise<boolean>>(),
  passkeysSupported: vi.fn<() => boolean>(),
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
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.store.record && { ...mocks.store.record };
      },
      onChange(listener: () => void) {
        mocks.store.listeners.add(listener);
        return () => mocks.store.listeners.delete(listener);
      },
      save(token: string, record: Rec) {
        mocks.save(token, record);
        setRecord(record);
      },
      clear() {
        mocks.clear();
      },
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    send: mocks.send,
    collection: (name: string) =>
      ({
        users: { update: mocks.userUpdate, authWithPassword: mocks.authWithPassword },
        runners: { getFirstListItem: mocks.getFirstListItem, update: mocks.runnerUpdate },
        passkeys: {
          getFullList: mocks.getFullList,
          update: mocks.passkeyUpdate,
          delete: mocks.passkeyDelete,
        },
      })[name],
    files: { getURL: mocks.getURL },
  },
}));

vi.mock("../auth/passkeys", () => ({
  registerPasskey: mocks.registerPasskey,
  passkeysSupported: mocks.passkeysSupported,
}));

const ALICE = {
  id: "u1",
  collectionName: "users",
  email: "alice@example.test",
  role: "member",
  updated: "2026-10-01 08:00:00.000Z",
};

const IPHONE = {
  id: "pk1",
  user: "u1",
  name: "iPhone",
  created: "2026-10-01 08:30:00.000Z",
  last_used_at: "2026-10-20 18:45:00.000Z",
};

// An empty date comes back from the API as an empty string.
const WORK_PC = {
  id: "pk2",
  user: "u1",
  name: "PC du boulot",
  created: "2026-10-05 09:00:00.000Z",
  last_used_at: "",
};

beforeEach(() => {
  for (const fn of Object.values(mocks)) {
    if (vi.isMockFunction(fn)) fn.mockReset();
  }
  mocks.store.listeners.clear();
  mocks.store.record = ALICE;
  mocks.runner.name = "Alice";

  mocks.getFirstListItem.mockImplementation(() =>
    Promise.resolve({ id: "r1", name: mocks.runner.name, user: "u1" }),
  );
  mocks.runnerUpdate.mockImplementation((_id, body) => {
    mocks.runner.name = String(body.name);
    return Promise.resolve({ id: "r1", name: body.name });
  });
  // The SDK saves the updated record in the auth store, with the same token.
  mocks.userUpdate.mockImplementation(() => {
    setRecord({ ...ALICE, updated: "2026-10-31 10:00:00.000Z" });
    return Promise.resolve(ALICE);
  });
  mocks.authWithPassword.mockResolvedValue({ token: "fresh-token", record: ALICE });
  mocks.getFullList.mockResolvedValue([IPHONE, WORK_PC]);
  mocks.passkeyUpdate.mockResolvedValue({});
  mocks.passkeyDelete.mockResolvedValue(true);
  mocks.registerPasskey.mockResolvedValue(true);
  mocks.passkeysSupported.mockReturnValue(true);
  // The calendar section asks the server whether the account has a link; a test
  // of another route gives its own answer.
  sendAs({ exists: false });
});

/** What the server says of the tokens of the assistants of an account that has none. */
const NO_TOKENS = { url: "http://localhost:5173/mcp", max: 5, tokens: [] };

/**
 * Makes the server answer every request with `answer` (a refusal, when it is an
 * error), except the one for the tokens of the assistants, which has its own
 * answer by path: the page asks for it as it opens, whatever a test is about,
 * and what it is given is not the answer of the calendar or of the email.
 */
function sendAs(answer: unknown) {
  mocks.send.mockImplementation((path) => {
    if (path === "/api/app/mcp-tokens") return Promise.resolve(NO_TOKENS);
    return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
  });
}

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

/** How PocketBase reports the fields it refused. */
function fieldRefusal(field: string, code: string) {
  return refusal(400, { [field]: { code, message: "…" } });
}

/** The page, in a router that knows the profile, which it links back to. */
function mountSettings() {
  const root = createRootRoute({ component: Outlet });
  const profile = createRoute({
    getParentRoute: () => root,
    path: "/profil",
    component: () => <p>Page du profil</p>,
  });
  const settings = createRoute({
    getParentRoute: () => root,
    path: "/profil/reglages",
    component: SettingsPage,
  });
  const router = createRouter({
    routeTree: root.addChildren([profile, settings]),
    history: createMemoryHistory({ initialEntries: ["/profil/reglages"] }),
  });
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

async function renderSettings() {
  const screen = await mountSettings();
  // Once the runner is there, the name form is.
  await expect
    .element(screen.getByLabelText(fr.profile.name, { exact: true }))
    .toHaveValue("Alice");
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderSettings>>;

/** A section of the page, by its heading. */
function section(screen: Screen, title: string) {
  return screen.getByRole("region", { name: title, exact: true });
}

/** The requests to the server, as far as the mocks tell them. */
const requests = [
  ["getFirstListItem", mocks.getFirstListItem],
  ["runnerUpdate", mocks.runnerUpdate],
  ["getFullList", mocks.getFullList],
  ["passkeyUpdate", mocks.passkeyUpdate],
  ["passkeyDelete", mocks.passkeyDelete],
  ["send", mocks.send],
] as const;

/** The requests made between the first call of `first` and the first call of `second`. */
function requestsBetween(first: { mock: { invocationCallOrder: number[] } }, second: typeof first) {
  const from = first.mock.invocationCallOrder[0] ?? Infinity;
  const to = second.mock.invocationCallOrder[0] ?? -Infinity;
  return requests.flatMap(([name, fn]) =>
    fn.mock.invocationCallOrder.filter((order) => from < order && order < to).map(() => name),
  );
}

// --- The page ---

test("SettingsPage — montre le nom, l'email actuel et les sections", async () => {
  const screen = await renderSettings();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
    .toBeVisible();
  await expect
    .element(section(screen, fr.profile.emailTitle).getByText(fr.profile.currentEmail(ALICE.email)))
    .toBeVisible();
  await expect.element(section(screen, fr.profile.nameTitle)).toBeVisible();
  await expect.element(section(screen, fr.profile.passwordTitle)).toBeVisible();
  await expect.element(section(screen, fr.passkeys.title)).toBeVisible();
});

/** The second element is after the first in the page. */
function follows(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

test("SettingsPage — « Retour au profil » est en haut, avant le titre et les sections, et ramène au profil", async () => {
  const screen = await renderSettings();

  const back = screen.getByRole("link", { name: fr.profile.backToProfile });
  await expect.element(back).toBeVisible();
  expect(back.element().getAttribute("href")).toBe("/profil");
  expect(back.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(follows(back.element(), screen.getByRole("heading", { level: 1 }).element())).toBe(true);
  expect(follows(back.element(), section(screen, fr.avatar.title).element())).toBe(true);

  await back.click();
  await expect.element(screen.getByText("Page du profil")).toBeVisible();
});

test("SettingsPage — la section Agenda vient après les clés d'accès, et avant « Se déconnecter »", async () => {
  const screen = await renderSettings();

  const calendar = section(screen, fr.calendar.title);
  await expect.element(calendar.getByRole("button", { name: fr.calendar.create })).toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/calendar", { method: "GET" });
  expect(follows(section(screen, fr.passkeys.title).element(), calendar.element())).toBe(true);
  expect(
    follows(calendar.element(), screen.getByRole("button", { name: fr.profile.logout }).element()),
  ).toBe(true);
});

test("SettingsPage — « Assistant IA (MCP) » vient après « Agenda », et avant « Application »", async () => {
  const screen = await renderSettings();

  const mcp = section(screen, fr.mcp.title);
  await expect.element(mcp.getByRole("button", { name: fr.mcp.create })).toBeVisible();
  await expect.element(mcp.getByText(fr.mcp.empty)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/mcp-tokens", { method: "GET" });
  expect(follows(section(screen, fr.calendar.title).element(), mcp.element())).toBe(true);
  expect(follows(mcp.element(), section(screen, fr.install.title).element())).toBe(true);
  expect(
    follows(mcp.element(), screen.getByRole("button", { name: fr.profile.logout }).element()),
  ).toBe(true);
});

test("SettingsPage — sans serveur MCP (la démo), la page n'a pas la section « Assistant IA (MCP) »", async () => {
  mocks.send.mockImplementation((path) =>
    path === "/api/app/mcp-tokens"
      ? Promise.reject(refusal(404, { message: "The requested resource wasn't found." }))
      : Promise.resolve({ exists: false }),
  );
  const screen = await renderSettings();

  // The rest of the page is there: the sections around it, and the calendar that asked too.
  await expect
    .element(section(screen, fr.calendar.title).getByRole("button", { name: fr.calendar.create }))
    .toBeVisible();
  await expect.element(section(screen, fr.install.title)).toBeVisible();
  await expect.element(screen.getByRole("region", { name: fr.mcp.title })).not.toBeInTheDocument();
});

test("SettingsPage — la section Application vient après l'Agenda, et avant « Se déconnecter »", async () => {
  const screen = await renderSettings();

  const install = section(screen, fr.install.title);
  // Nothing to offer in a tab of the test browser: the way to do it from its menu.
  await expect.element(install.getByText(fr.install.other)).toBeVisible();
  expect(follows(section(screen, fr.calendar.title).element(), install.element())).toBe(true);
  expect(
    follows(install.element(), screen.getByRole("button", { name: fr.profile.logout }).element()),
  ).toBe(true);
});

// --- The appearance ---

/** The theme of the page, as <html> carries it, and what the device keeps. */
function pageTheme() {
  const root = document.documentElement;
  return {
    theme: root.dataset.theme,
    colorScheme: getComputedStyle(root).colorScheme,
    kept: localStorage.getItem("ptd-theme"),
  };
}

afterEach(() => {
  // The theme belongs to the page and to the device: a test leaves neither to the next.
  localStorage.removeItem("ptd-theme");
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = "";
});

test("SettingsPage — Apparence : Auto, Clair, Sombre", async () => {
  const screen = await renderSettings();

  const appearance = section(screen, fr.settings.appearance);
  // « Clair ou sombre », beside « Thème »: the mode of a skin that has both.
  const group = appearance.getByRole("group", { name: fr.settings.mode });
  const auto = group.getByRole("radio", { name: fr.settings.themeAuto });
  const light = group.getByRole("radio", { name: fr.settings.themeLight });
  const dark = group.getByRole("radio", { name: fr.settings.themeDark });
  // Nothing chosen yet: the page follows the phone.
  await expect.element(auto).toBeChecked();
  await expect.element(light).not.toBeChecked();
  await expect.element(dark).not.toBeChecked();
  // Each choice is a tap target of 44 px at least.
  for (const radio of [auto, light, dark]) {
    expect(radio.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }

  // A choice applies at once, and is kept on the device.
  await dark.click();
  await expect.element(dark).toBeChecked();
  expect(pageTheme()).toEqual({ theme: "dark", colorScheme: "dark", kept: "dark" });

  await light.click();
  await expect.element(light).toBeChecked();
  expect(pageTheme()).toEqual({ theme: "light", colorScheme: "light", kept: "light" });

  // Auto gives the page back to the phone, and keeps nothing.
  await auto.click();
  await expect.element(auto).toBeChecked();
  expect(pageTheme()).toEqual({ theme: undefined, colorScheme: "light dark", kept: null });
});

test("SettingsPage — Apparence : le choix gardé sur l'appareil est coché en arrivant", async () => {
  localStorage.setItem("ptd-theme", "dark");
  const screen = await renderSettings();

  const group = section(screen, fr.settings.appearance).getByRole("group");
  await expect.element(group.getByRole("radio", { name: fr.settings.themeDark })).toBeChecked();
});

test("SettingsPage — Apparence : au clavier, les flèches passent d'un choix à l'autre", async () => {
  const screen = await renderSettings();

  const group = section(screen, fr.settings.appearance).getByRole("group");
  group.getByRole("radio", { name: fr.settings.themeAuto }).element().focus();
  await userEvent.keyboard("{ArrowDown}");
  await expect.element(group.getByRole("radio", { name: fr.settings.themeLight })).toBeChecked();
  expect(pageTheme().theme).toBe("light");
  // The ring of the focus is drawn around the choice.
  expect(getComputedStyle(document.activeElement ?? document.body).outlineStyle).not.toBe("none");
});

test("SettingsPage — Apparence : en couleurs forcées, le choix coché se voit encore", async () => {
  await emulateMedia({ forcedColors: "active" });
  try {
    const screen = await renderSettings();
    const group = section(screen, fr.settings.appearance).getByRole("group");
    await expect.element(group.getByRole("radio", { name: fr.settings.themeAuto })).toBeChecked();

    // The dot of each choice: drawn for the checked one only, in a colour the system keeps.
    const dots = [...group.element().querySelectorAll("[data-dot]")].map((dot) => {
      const style = getComputedStyle(dot);
      // A dot not drawn is scaled to nothing (`scale: 0`).
      return { shown: !/^0(s|$)/.test(style.scale), colour: style.backgroundColor };
    });
    expect(dots.map((dot) => dot.shown)).toEqual([true, false, false]);
    const probe = document.createElement("span");
    probe.style.color = "CanvasText";
    document.body.append(probe);
    const text = getComputedStyle(probe).color;
    probe.remove();
    expect(dots[0]?.colour).toBe(text);
  } finally {
    await resetMedia();
  }
});

test("SettingsPage — la section Apparence vient après les clés d'accès, et avant l'Agenda", async () => {
  const screen = await renderSettings();

  const appearance = section(screen, fr.settings.appearance);
  await expect.element(appearance).toBeVisible();
  expect(follows(section(screen, fr.passkeys.title).element(), appearance.element())).toBe(true);
  expect(follows(appearance.element(), section(screen, fr.calendar.title).element())).toBe(true);
});

test("SettingsPage — « Se déconnecter » est tout en bas : le dernier bouton de la page", async () => {
  const screen = await renderSettings();

  const logout = screen.getByRole("button", { name: fr.profile.logout });
  await expect.element(logout).toBeVisible();
  const lastButtons = screen
    .getByRole("button")
    .elements()
    .filter(
      (button) =>
        logout.element().compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING,
    );
  expect(lastButtons).toEqual([]);
  // The statistics of the group are a matter of the profile page, not of the settings.
  await expect.element(screen.getByRole("link", { name: fr.stats.link })).not.toBeInTheDocument();
});

test("SettingsPage — se déconnecter vide la session", async () => {
  const screen = await renderSettings();

  await screen.getByRole("button", { name: fr.profile.logout }).click();

  expect(mocks.clear).toHaveBeenCalledOnce();
});

test("SettingsPage — un compte qui n'est pas un membre (le super-admin) n'a aucune section de membre ni requête : l'Apparence, le retour au profil et la déconnexion", async () => {
  setRecord({ id: "su1", collectionName: "_superusers", email: "root@example.test" });

  const screen = await mountSettings();

  await expect
    .element(screen.getByRole("heading", { level: 1, name: fr.profile.settings }))
    .toBeVisible();
  await expect.element(screen.getByRole("link", { name: fr.profile.backToProfile })).toBeVisible();
  // No section of a member (photo, name, email, password, passkeys, calendar, app):
  // only the look of the app, which is a choice of the device, not of the account.
  await expect.element(section(screen, fr.settings.appearance)).toBeVisible();
  expect(
    screen
      .getByRole("heading", { level: 2 })
      .elements()
      .map((heading) => heading.textContent),
  ).toEqual([fr.settings.appearance]);
  expect(requests.filter(([, fn]) => fn.mock.calls.length > 0).map(([name]) => name)).toEqual([]);
  await screen.getByRole("button", { name: fr.profile.logout }).click();
  expect(mocks.clear).toHaveBeenCalledOnce();
});

test("SettingsPage — le super-admin choisit aussi l'apparence de l'appli sur cet appareil", async () => {
  setRecord({ id: "su1", collectionName: "_superusers", email: "root@example.test" });

  const screen = await mountSettings();

  const group = section(screen, fr.settings.appearance).getByRole("group");
  const dark = group.getByRole("radio", { name: fr.settings.themeDark });
  await dark.click();
  await expect.element(dark).toBeChecked();
  expect(pageTheme()).toEqual({ theme: "dark", colorScheme: "dark", kept: "dark" });
});

test("SettingsPage — sans session (entre la déconnexion et la page de connexion), la page est vide", async () => {
  setRecord(null);

  const screen = await mountSettings();

  await vi.waitFor(() => {
    expect(screen.container.textContent).toBe("");
  });
});

test("SettingsPage — les boutons et les champs font au moins 44 px de haut", async () => {
  const screen = await renderSettings();
  await expect.element(screen.getByText(IPHONE.name)).toBeVisible();

  // The file field of the photo is hidden from sight: the label around it is the target.
  const tooSmall = [
    ...screen.container.querySelectorAll<HTMLElement>(
      "button, input:not([type=file]), label:has(input[type=file])",
    ),
  ]
    .filter((element) => element.getBoundingClientRect().height < 44)
    .map((element) => element.outerHTML);

  expect(tooSmall).toEqual([]);
});

// --- The photo ---

test("SettingsPage — la section Photo propose de changer ma photo, et pas de bouton tant que mon coureur charge", async () => {
  // The runner of the session is not there yet.
  mocks.getFirstListItem.mockReturnValue(new Promise(() => {}));
  const screen = await mountSettings();

  const photo = section(screen, fr.avatar.title);
  await expect.element(photo.getByText(fr.common.loading)).toBeVisible();
  await expect.element(photo.getByLabelText(fr.avatar.change)).not.toBeInTheDocument();
  await expect.element(photo.getByRole("button")).not.toBeInTheDocument();
});

test("SettingsPage — la section Photo vient en premier et propose de changer ma photo", async () => {
  const screen = await renderSettings();

  const headings = screen
    .getByRole("heading", { level: 2 })
    .elements()
    .map((element) => element.textContent);
  expect(headings[0]).toBe(fr.avatar.title);
  const photo = section(screen, fr.avatar.title);
  await expect.element(photo.getByLabelText(fr.avatar.change)).toBeInTheDocument();
  // The live region is there before anything is said, so that it gets announced.
  await expect.element(photo.getByRole("status")).toBeEmptyDOMElement();
  // No photo yet: nothing to remove, and the initial stands for it.
  await expect
    .element(photo.getByRole("button", { name: fr.avatar.remove }))
    .not.toBeInTheDocument();
  await expect.element(photo.getByText("A", { exact: true })).toBeVisible();
});

test("SettingsPage — choisir une photo l'envoie pour mon coureur, et la page lit le coureur de nouveau", async () => {
  mocks.runnerUpdate.mockResolvedValue({ id: "r1" });
  const screen = await renderSettings();

  await section(screen, fr.avatar.title)
    .getByLabelText(fr.avatar.change)
    .upload(await imageFile(1600, 1200));

  await expect
    .element(section(screen, fr.avatar.title).getByRole("status"))
    .toHaveTextContent(fr.avatar.saved);
  // Said once, in the live region of the section: no toast says it again.
  const said = screen.getByText(fr.avatar.saved);
  await expect.element(said).toBeVisible();
  expect(said.element().tagName).toBe("OUTPUT");
  expect(mocks.runnerUpdate).toHaveBeenCalledOnce();
  const [id, form] = mocks.runnerUpdate.mock.calls[0] ?? [];
  expect(id).toBe("r1");
  const sent = form instanceof FormData ? form.get("avatar") : null;
  if (!(sent instanceof File)) throw new Error("update was not given a file");
  expect(await sizeOf(sent)).toEqual({ width: 512, height: 384 });
  // The photo is shown all over the app: the runner of the session is read again.
  expect(mocks.getFirstListItem).toHaveBeenCalledTimes(2);
});

test("SettingsPage — avec une photo, elle est montrée en grand, et on peut la retirer", async () => {
  mocks.getURL.mockImplementation(() => pixelURL());
  mocks.getFirstListItem.mockResolvedValue({
    id: "r1",
    name: "Alice",
    user: "u1",
    avatar: "alice_k3j9x2.webp",
  });
  mocks.runnerUpdate.mockResolvedValue({ id: "r1" });
  const screen = await renderSettings();
  const photo = section(screen, fr.avatar.title);

  expect(photo.element().querySelector("img")?.getAttribute("src")).toBe(pixelURL());
  expect(mocks.getURL).toHaveBeenCalledWith(
    expect.objectContaining({ id: "r1" }),
    "alice_k3j9x2.webp",
    { thumb: "256x256" },
  );
  await photo.getByRole("button", { name: fr.avatar.remove }).click();

  await expect.element(photo.getByRole("status")).toHaveTextContent(fr.avatar.removed);
  // Said once, in the live region of the section: no toast says it again.
  await expect.element(screen.getByText(fr.avatar.removed)).toBeVisible();
  expect(mocks.runnerUpdate).toHaveBeenCalledExactlyOnceWith("r1", { avatar: null });
});

// --- The name ---

test("SettingsPage — le nom affiché : PATCH du coureur, message, et la page suit", async () => {
  const screen = await renderSettings();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("Alice B");
  await form.getByRole("button", { name: fr.common.save }).click();

  await expect.element(screen.getByText(fr.profile.nameSaved)).toBeVisible();
  expect(mocks.runnerUpdate).toHaveBeenCalledWith("r1", { name: "Alice B" });
  // The runner of the session is read again: the new name is the one shown.
  await expect
    .element(form.getByLabelText(fr.profile.name, { exact: true }))
    .toHaveValue("Alice B");
  await vi.waitFor(() => {
    expect(mocks.getFirstListItem).toHaveBeenCalledTimes(2);
  });
});

test("SettingsPage — un nom déjà pris est dit sous le champ, la saisie est gardée", async () => {
  mocks.runnerUpdate.mockRejectedValue(fieldRefusal("name", "validation_not_unique"));
  const screen = await renderSettings();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("Bob");
  await form.getByRole("button", { name: fr.common.save }).click();

  const field = form.getByLabelText(fr.profile.name, { exact: true });
  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.validation_not_unique);
  await expect.element(field).toHaveValue("Bob");
  await expect.element(field).toHaveAttribute("aria-invalid", "true");
  await expect
    .element(field)
    .toHaveAccessibleDescription(`${fr.profile.nameHint} ${fr.errors.validation_not_unique}`);
  await expect.element(screen.getByText(fr.profile.nameSaved)).not.toBeInTheDocument();
});

test("SettingsPage — un nom fait d'espaces est refusé sans appeler le serveur", async () => {
  const screen = await renderSettings();
  const form = section(screen, fr.profile.nameTitle);

  await form.getByLabelText(fr.profile.name, { exact: true }).fill("   ");
  await form.getByRole("button", { name: fr.common.save }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  expect(mocks.runnerUpdate).not.toHaveBeenCalled();
});

// --- The email ---

test("SettingsPage — changer d'email : /api/app/me/email, puis le nouveau jeton est gardé", async () => {
  const record = { ...ALICE, email: "new@example.test" };
  sendAs({ token: "new-token", record });
  const screen = await renderSettings();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(screen.getByText(fr.profile.emailSaved)).toBeVisible();
  expect(mocks.send).toHaveBeenCalledWith("/api/app/me/email", {
    method: "POST",
    body: { email: "new@example.test", password: "current-pass" },
  });
  // The old token is dead: the one of the answer is what the session now is.
  expect(mocks.save).toHaveBeenCalledWith("new-token", record);
  await expect.element(form.getByText(fr.profile.currentEmail("new@example.test"))).toBeVisible();
  // The form starts over: no password is left in the page.
  await expect.element(form.getByLabelText(fr.profile.newEmail, { exact: true })).toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveValue("");
});

test("SettingsPage — un mot de passe faux est dit sous le champ, l'email saisi est gardé", async () => {
  sendAs(refusal(400, { code: "wrong_password" }));
  const screen = await renderSettings();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("not-it");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.wrong_password);
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.wrong_password);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveValue("new@example.test");
  expect(mocks.save).not.toHaveBeenCalled();
});

test.each([
  ["email_taken", fr.errors.email_taken],
  ["email_invalid", fr.errors.email_invalid],
])("SettingsPage — %s est dit sous le champ email", async (code, message) => {
  sendAs(refusal(400, { code }));
  const screen = await renderSettings();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("bob@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(message);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveAccessibleDescription(message);
  expect(mocks.save).not.toHaveBeenCalled();
});

test("SettingsPage — une panne pendant le changement d'email affiche le message générique", async () => {
  sendAs(new TypeError("Failed to fetch"));
  const screen = await renderSettings();
  const form = section(screen, fr.profile.emailTitle);

  await form.getByLabelText(fr.profile.newEmail, { exact: true }).fill("new@example.test");
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill("current-pass");
  await form.getByRole("button", { name: fr.profile.changeEmail }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect
    .element(form.getByLabelText(fr.profile.newEmail, { exact: true }))
    .toHaveValue("new@example.test");
});

// --- The password ---

async function fillPasswords(screen: Screen, old: string, next: string, confirm: string) {
  const form = section(screen, fr.profile.passwordTitle);
  await form.getByLabelText(fr.profile.currentPassword, { exact: true }).fill(old);
  await form.getByLabelText(fr.profile.newPassword, { exact: true }).fill(next);
  await form.getByLabelText(fr.auth.passwordConfirm, { exact: true }).fill(confirm);
  return form;
}

test("SettingsPage — changer le mot de passe : met le compte à jour, puis se reconnecte aussitôt avec le nouveau", async () => {
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByText(fr.profile.passwordSaved)).toBeVisible();
  expect(mocks.userUpdate).toHaveBeenCalledWith("u1", {
    oldPassword: "old-password",
    password: "new-password-1",
    passwordConfirm: "new-password-1",
  });
  // The update replaced the key of the token: the session is renewed with the new password...
  expect(mocks.authWithPassword).toHaveBeenCalledWith("alice@example.test", "new-password-1");
  expect(mocks.authWithPassword.mock.invocationCallOrder[0]).toBeGreaterThan(
    mocks.userUpdate.mock.invocationCallOrder[0] ?? Infinity,
  );
  // ...and no request goes out with the dead token in between, which the
  // client would take for the end of the session.
  expect(requestsBetween(mocks.userUpdate, mocks.authWithPassword)).toEqual([]);
  expect(mocks.clear).not.toHaveBeenCalled();
});

test("SettingsPage — après le changement, plus aucun mot de passe dans la page", async () => {
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(screen.getByText(fr.profile.passwordSaved)).toBeVisible();
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveValue("");
  await expect
    .element(form.getByLabelText(fr.auth.passwordConfirm, { exact: true }))
    .toHaveValue("");
});

test("SettingsPage — un mot de passe actuel faux est dit sous son champ, sans reconnexion, la saisie est gardée", async () => {
  mocks.userUpdate.mockRejectedValue(
    fieldRefusal("oldPassword", "validation_invalid_old_password"),
  );
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "not-it", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_invalid_old_password);
  await expect
    .element(form.getByLabelText(fr.profile.currentPassword, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.validation_invalid_old_password);
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveValue("new-password-1");
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
  await expect.element(screen.getByText(fr.profile.passwordSaved)).not.toBeInTheDocument();
});

test("SettingsPage — un mot de passe trop court est dit sous son champ, avec la règle", async () => {
  mocks.userUpdate.mockRejectedValue(fieldRefusal("password", "validation_min_text_constraint"));
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "short", "short");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_min_text_constraint);
  await expect
    .element(form.getByLabelText(fr.profile.newPassword, { exact: true }))
    .toHaveAccessibleDescription(
      `${fr.auth.passwordHint} ${fr.errors.validation_min_text_constraint}`,
    );
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
});

test("SettingsPage — deux mots de passe différents sont dits sous la confirmation", async () => {
  mocks.userUpdate.mockRejectedValue(fieldRefusal("passwordConfirm", "validation_values_mismatch"));
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-2");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect
    .element(form.getByRole("alert"))
    .toHaveTextContent(fr.errors.validation_values_mismatch);
  await expect
    .element(form.getByLabelText(fr.auth.passwordConfirm, { exact: true }))
    .toHaveAccessibleDescription(fr.errors.validation_values_mismatch);
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
});

test("SettingsPage — si la reconnexion échoue, la session est fermée et on le dit", async () => {
  mocks.authWithPassword.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  // The old token is dead: nothing else would work, so the sign-in page is next.
  await expect.element(screen.getByText(fr.profile.passwordSignInAgain)).toBeVisible();
  expect(mocks.clear).toHaveBeenCalledOnce();
});

test("SettingsPage — une panne pendant le changement ne ferme pas la session", async () => {
  mocks.userUpdate.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderSettings();
  const form = await fillPasswords(screen, "old-password", "new-password-1", "new-password-1");

  await form.getByRole("button", { name: fr.auth.changePassword }).click();

  await expect.element(form.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  expect(mocks.authWithPassword).not.toHaveBeenCalled();
  expect(mocks.clear).not.toHaveBeenCalled();
});

// --- The passkeys ---

test("SettingsPage — liste les clés d'accès de l'utilisateur, avec leur dernier usage", async () => {
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
  await expect.element(list.getByText(WORK_PC.name)).toBeVisible();
  await expect.element(list.getByText(/Utilisée le 20 oct\. 2026/)).toBeVisible();
  // A text is matched in full unless it is a regular expression.
  await expect.element(list.getByText(new RegExp(fr.passkeys.neverUsed))).toBeVisible();
  // An admin may read everybody's passkeys: the list asks for its own.
  expect(mocks.getFullList).toHaveBeenCalledWith({
    filter: 'user = {:id} {"id":"u1"}',
    sort: "-created",
  });
});

test("SettingsPage — sans clé, le dit", async () => {
  mocks.getFullList.mockResolvedValue([]);
  const screen = await renderSettings();

  await expect
    .element(section(screen, fr.passkeys.title).getByText(fr.passkeys.empty))
    .toBeVisible();
});

test("SettingsPage — si la liste ne se charge pas, propose de réessayer", async () => {
  mocks.getFullList.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await list.getByRole("button", { name: fr.common.retry }).click();

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
});

test('SettingsPage — liste les clés et supprime après confirmation (pb.collection("passkeys").delete appelé avec l\'id)', async () => {
  mocks.getFullList.mockResolvedValueOnce([IPHONE, WORK_PC]).mockResolvedValue([WORK_PC]);
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);
  await expect.element(list.getByText(IPHONE.name)).toBeVisible();

  await list.getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` }).click();

  // Nothing is deleted before the user confirms.
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });
  await expect.element(dialog).toBeVisible();
  await expect.element(dialog.getByText(fr.passkeys.removeWarning(IPHONE.name))).toBeVisible();
  expect(mocks.passkeyDelete).not.toHaveBeenCalled();

  await dialog.getByRole("button", { name: fr.common.delete, exact: true }).click();

  expect(mocks.passkeyDelete).toHaveBeenCalledWith("pk1");
  await expect.element(screen.getByText(fr.passkeys.removed)).toBeVisible();
  await expect.element(list.getByText(IPHONE.name)).not.toBeInTheDocument();
  await expect.element(list.getByText(WORK_PC.name)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("SettingsPage — annuler la suppression ne supprime rien", async () => {
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);
  await list.getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` }).click();

  await screen
    .getByRole("dialog", { name: fr.passkeys.removeTitle })
    .getByRole("button", { name: fr.common.cancel })
    .click();

  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  expect(mocks.passkeyDelete).not.toHaveBeenCalled();
  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
});

test("SettingsPage — une suppression refusée est dite dans la fenêtre, qui reste ouverte", async () => {
  mocks.passkeyDelete.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: `${fr.common.delete} ${IPHONE.name}` })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.removeTitle });

  await dialog.getByRole("button", { name: fr.common.delete, exact: true }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(screen.getByText(fr.passkeys.removed)).not.toBeInTheDocument();
});

test("SettingsPage — ajouter une clé : le nom est demandé dans une fenêtre, puis la liste suit", async () => {
  const TABLET = { ...IPHONE, id: "pk3", name: "Tablette", last_used_at: "" };
  mocks.getFullList
    .mockResolvedValueOnce([IPHONE, WORK_PC])
    .mockResolvedValue([IPHONE, WORK_PC, TABLET]);
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);

  await list.getByRole("button", { name: fr.passkeys.add, exact: true }).click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");
  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(screen.getByText(fr.passkeys.added)).toBeVisible();
  expect(mocks.registerPasskey).toHaveBeenCalledExactlyOnceWith("Tablette");
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
  await expect.element(list.getByText("Tablette")).toBeVisible();
});

test("SettingsPage — si l'utilisateur annule l'invite du navigateur, rien n'est dit et la fenêtre reste", async () => {
  mocks.registerPasskey.mockResolvedValue(false);
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await vi.waitFor(() => {
    expect(mocks.registerPasskey).toHaveBeenCalledOnce();
  });
  // The name is kept, so that the user can try again.
  await expect
    .element(dialog.getByLabelText(fr.passkeys.name, { exact: true }))
    .toHaveValue("Tablette");
  await expect.element(dialog.getByRole("button", { name: fr.passkeys.addSubmit })).toBeEnabled();
  await expect.element(dialog.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.passkeys.added)).not.toBeInTheDocument();
});

test("SettingsPage — un refus du serveur à l'ajout est dit dans la fenêtre", async () => {
  mocks.registerPasskey.mockRejectedValue(refusal(400, { code: "passkey_failed" }));
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.passkey_failed);
  await expect
    .element(dialog.getByLabelText(fr.passkeys.name, { exact: true }))
    .toHaveValue("Tablette");
});

test("SettingsPage — un appareil qui a déjà une clé pour le compte est dit comme tel", async () => {
  mocks.registerPasskey.mockRejectedValue(
    new DOMException("Already registered", "InvalidStateError"),
  );
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("Tablette");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.passkeys.alreadyRegistered);
});

test("SettingsPage — un nom d'espaces est refusé à l'ajout, sans demander la clé au navigateur", async () => {
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: fr.passkeys.add, exact: true })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.addTitle });
  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("   ");

  await dialog.getByRole("button", { name: fr.passkeys.addSubmit }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  expect(mocks.registerPasskey).not.toHaveBeenCalled();
});

test("SettingsPage — renommer une clé : la fenêtre propose le nom actuel", async () => {
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);

  await list.getByRole("button", { name: `${fr.passkeys.rename} ${IPHONE.name}` }).click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.renameTitle });
  const field = dialog.getByLabelText(fr.passkeys.name, { exact: true });
  await expect.element(field).toHaveValue("iPhone");
  await field.fill("iPhone 15");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  expect(mocks.passkeyUpdate).toHaveBeenCalledExactlyOnceWith("pk1", { name: "iPhone 15" });
  await expect.element(screen.getByText(fr.passkeys.renamed)).toBeVisible();
  await expect.element(screen.getByRole("dialog")).not.toBeInTheDocument();
});

test("SettingsPage — un renommage refusé est dit dans la fenêtre", async () => {
  mocks.passkeyUpdate.mockRejectedValue(fieldRefusal("name", "validation_required"));
  const screen = await renderSettings();
  await section(screen, fr.passkeys.title)
    .getByRole("button", { name: `${fr.passkeys.rename} ${IPHONE.name}` })
    .click();
  const dialog = screen.getByRole("dialog", { name: fr.passkeys.renameTitle });

  await dialog.getByLabelText(fr.passkeys.name, { exact: true }).fill("x");
  await dialog.getByRole("button", { name: fr.common.save }).click();

  await expect.element(dialog.getByRole("alert")).toHaveTextContent(fr.errors.validation_required);
  await expect.element(screen.getByText(fr.passkeys.renamed)).not.toBeInTheDocument();
});

test("SettingsPage — sans WebAuthn, le bouton d'ajout est masqué mais la liste reste", async () => {
  mocks.passkeysSupported.mockReturnValue(false);
  const screen = await renderSettings();
  const list = section(screen, fr.passkeys.title);

  await expect.element(list.getByText(IPHONE.name)).toBeVisible();
  await expect
    .element(list.getByRole("button", { name: fr.passkeys.add, exact: true }))
    .not.toBeInTheDocument();
});
