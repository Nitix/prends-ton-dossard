import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, expect, onTestFinished, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent, type Locator } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { claudeCommand } from "./command";
import { McpSection } from "./McpSection";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  store: { record: null as Rec | null, listeners: new Set<() => void>() },
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
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
    },
    send: mocks.send,
  },
}));

const PATH = "/api/app/mcp-tokens";
const SERVER = "http://localhost:5173/mcp";

/** Made-up tokens of the shape of the real ones: ptd_, an id of 15 characters, a secret of 43. */
const tokenOf = (n: number) => `ptd_testtesttest00${n}_${"x".repeat(42)}${n}`;

const ALICE = { id: "u1", collectionName: "users", role: "member" };
const BOB = { id: "u2", collectionName: "users", role: "member" };

beforeEach(() => {
  mocks.send.mockReset();
  vi.restoreAllMocks();
  mocks.store.listeners.clear();
  mocks.store.record = ALICE;
});

afterEach(() => {
  // Gives the browser its own clipboard back, if a test took it away.
  Reflect.deleteProperty(navigator, "clipboard");
});

type Row = { id: string; name: string; created: string; lastUsedAt: string };

/** Used on the 3rd of November at 13:05 UTC, which is 14:05 in Paris. */
const USED: Row = {
  id: "tk1",
  name: "Claude sur mon PC",
  // 00:30 on the 3rd in Paris: the day is the one of Paris, not of UTC.
  created: "2026-11-02 23:30:00.000Z",
  lastUsedAt: "2026-11-03 13:05:00.000Z",
};
const NEVER: Row = {
  id: "tk2",
  name: "Claude Desktop",
  created: "2026-10-20 08:00:00.000Z",
  lastUsedAt: "",
};

/** Five tokens: the most that an account has. */
const FIVE: Row[] = [1, 2, 3, 4, 5].map((n) => ({
  id: `five${n}`,
  name: `Assistant ${n}`,
  created: `2026-10-0${n} 08:00:00.000Z`,
  lastUsedAt: "",
}));

type Served = { tokens: Row[]; made: number };

/** The name in the body of the request that makes a token. */
function nameOf(body: unknown): string {
  if (
    typeof body === "object" &&
    body !== null &&
    "name" in body &&
    typeof body.name === "string"
  ) {
    return body.name;
  }
  throw new Error("a token is made of a name");
}

/**
 * The server of the tokens of the account, as far as the section can tell: it
 * lists them (newest first), makes a token (each is different, numbered from
 * 1: its secret is in the answer and nowhere else) and revokes one.
 */
function serve(initial: Row[] = []): Served {
  const served: Served = { tokens: [...initial], made: 0 };
  mocks.send.mockImplementation((path, request) => {
    const { method } = request;
    if (path === PATH && method === "GET") {
      return Promise.resolve({ url: SERVER, max: 5, tokens: [...served.tokens] });
    }
    if (path === PATH && method === "POST") {
      served.made += 1;
      const name = nameOf(request.body);
      const row = {
        id: `new${served.made}`,
        name: name.trim(),
        created: "2026-11-03 09:00:00.000Z",
        lastUsedAt: "",
      };
      served.tokens = [row, ...served.tokens];
      return Promise.resolve({
        id: row.id,
        name: row.name,
        created: row.created,
        token: tokenOf(served.made),
        url: SERVER,
      });
    }
    if (path.startsWith(`${PATH}/`) && method === "DELETE") {
      const id = path.slice(PATH.length + 1);
      served.tokens = served.tokens.filter((row) => row.id !== id);
      return Promise.resolve({});
    }
    return Promise.reject(new Error(`unexpected request: ${String(method)} ${path}`));
  });
  return served;
}

function refusal(status: number, data: unknown) {
  return new ClientResponseError({ status, response: { status, message: "…", data } });
}

/** How PocketBase reports a field it refused. */
function fieldRefusal(field: string, code: string) {
  return refusal(400, { [field]: { code, message: "…" } });
}

/** What the section asked the server to change: `[method, path, body]`, without the reads. */
function changes(): [unknown, string, unknown][] {
  return mocks.send.mock.calls
    .filter(([, request]) => request.method !== "GET")
    .map(([path, request]) => [request.method, path, request.body]);
}

const reads = () => mocks.send.mock.calls.filter(([, request]) => request.method === "GET").length;

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function mount(languages: string[] = ["fr"], client = newClient()) {
  return render(
    <QueryClientProvider client={client}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <McpSection />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

/** The only region of the page: the section, named by its title. */
const section = (screen: Screen) => screen.getByRole("region");
const heading = (screen: Screen, title = fr.mcp.title) =>
  section(screen).getByRole("heading", { name: title });
const button = (screen: Screen, name: string) =>
  section(screen).getByRole("button", { name, exact: true });
const dialog = (screen: Screen) => screen.getByRole("dialog");
const inDialog = (screen: Screen, name: string) =>
  dialog(screen).getByRole("button", { name, exact: true });
const rows = (screen: Screen) => section(screen).getByRole("listitem");
const nameField = (screen: Screen, label = fr.mcp.name) =>
  dialog(screen).getByLabelText(label, { exact: true });
const tokenField = (screen: Screen, label = fr.mcp.tokenLabel) =>
  dialog(screen).getByRole("textbox", { name: label, exact: true });
const commandField = (screen: Screen, label = fr.mcp.commandLabel) =>
  dialog(screen).getByRole("textbox", { name: label, exact: true });

function fieldOf(locator: { element(): Element }): HTMLInputElement | HTMLTextAreaElement {
  const element = locator.element();
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
    throw new Error("not a field");
  }
  return element;
}

/** The field has the focus and all its text selected, ready to be copied. */
async function expectSelected(locator: Locator, text: string) {
  await expect.element(locator).toHaveFocus();
  const field = fieldOf(locator);
  expect(field.value).toBe(text);
  expect([field.selectionStart, field.selectionEnd]).toEqual([0, text.length]);
}

/** What a cache holds, as text. */
const statesOf = (all: { state: unknown }[]) => JSON.stringify(all.map((entry) => entry.state));

/** What the page, its fields and the caches of the queries hold of a secret. */
function whereIs(secret: string, client: QueryClient): string[] {
  const found: string[] = [];
  if (document.documentElement.outerHTML.includes(secret)) found.push("the page");
  for (const field of document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(
    "input, textarea",
  )) {
    if (field.value.includes(secret)) found.push("a field");
  }
  if (statesOf(client.getQueryCache().getAll()).includes(secret)) found.push("the query cache");
  if (statesOf(client.getMutationCache().getAll()).includes(secret)) {
    found.push("the mutation cache");
  }
  return found;
}

/** The text of the messages that rise from the corner. */
const toasts = () => document.querySelector(".toasts")?.textContent ?? "";

/** The message rose from the corner. */
async function expectToast(message: string) {
  await vi.waitFor(() => {
    expect(toasts()).toContain(message);
  });
}

/** The list has that many rows. */
async function expectRows(screen: Screen, count: number) {
  await vi.waitFor(() => {
    expect(rows(screen).elements()).toHaveLength(count);
  });
}

/** Opens the window of a new token, names it, and makes it: the window then shows the token. */
async function makeToken(screen: Screen, name = "Claude sur mon PC") {
  await button(screen, fr.mcp.create).click();
  await nameField(screen).fill(name);
  await inDialog(screen, fr.mcp.createSubmit).click();
  await expect.element(tokenField(screen)).toBeVisible();
}

// --- The list ---

test("McpSection — sans jeton, « Aucun jeton pour l'instant. » et « Nouveau jeton »", async () => {
  serve([]);
  const screen = await mount();

  await expect.element(section(screen)).toHaveAccessibleName(fr.mcp.title);
  await expect.element(section(screen).getByText(fr.mcp.intro)).toBeVisible();
  await expect.element(section(screen).getByText(fr.mcp.empty)).toBeVisible();
  const create = button(screen, fr.mcp.create);
  await expect.element(create).toBeVisible();
  expect(create.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await expect.element(section(screen).getByText(fr.mcp.limit(5))).not.toBeInTheDocument();
  await expect.element(rows(screen)).not.toBeInTheDocument();
  expect(mocks.send).toHaveBeenCalledWith(PATH, { method: "GET" });
  expect(changes()).toEqual([]);
});

test("McpSection — la liste montre le nom, la création et la dernière utilisation", async () => {
  serve([USED, NEVER]);
  const screen = await mount();

  await expect.element(rows(screen).nth(0)).toBeVisible();
  await expectRows(screen, 2);
  // As the server sent them, the newest first.
  await expect.element(rows(screen).nth(0)).toMatchTextContent(USED.name);
  await expect.element(rows(screen).nth(1)).toMatchTextContent(NEVER.name);
  // The days are the ones of Paris, and the time of a use is told.
  await expect.element(rows(screen).nth(0)).toMatchTextContent(/Créé le 3 nov\. 2026/);
  await expect.element(rows(screen).nth(0)).toMatchTextContent(/Utilisé le 3 nov\. 2026.*14:05/);
  await expect.element(rows(screen).nth(1)).toMatchTextContent(/Créé le 20 oct\. 2026/);
  await expect.element(rows(screen).nth(1)).toMatchTextContent(fr.mcp.neverUsed);
  await expect.element(rows(screen).nth(0)).not.toMatchTextContent(fr.mcp.neverUsed);
  await expect.element(section(screen).getByText(fr.mcp.empty)).not.toBeInTheDocument();

  // « Révoquer », named after the token for a screen reader: the buttons of a
  // list would otherwise sound the same.
  for (const row of [USED, NEVER]) {
    const revoke = button(screen, fr.mcp.revokeLabel(row.name));
    await expect.element(revoke).toBeVisible();
    await expect.element(revoke).toHaveTextContent(fr.mcp.revoke);
    expect(revoke.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // Nothing is a secret there: the list holds a name and two dates.
  expect(section(screen).element().textContent).not.toContain("ptd_");
});

// --- Making a token ---

test("McpSection — créer un jeton le montre une fois, avec la commande de Claude Code", async () => {
  serve([NEVER]);
  const client = newClient();
  const screen = await mount(["fr"], client);

  await button(screen, fr.mcp.create).click();
  // First, its name, with what it is for.
  await expect
    .element(dialog(screen).getByRole("heading", { name: fr.mcp.createTitle }))
    .toBeVisible();
  await expect.element(nameField(screen)).toHaveAccessibleDescription(fr.mcp.nameHint);
  await expect.element(tokenField(screen)).not.toBeInTheDocument();
  await nameField(screen).fill("Claude sur mon PC");
  await inDialog(screen, fr.mcp.createSubmit).click();

  // The same window now shows the token, once, in a field that cannot be typed
  // in, with the focus and its text selected: the next thing to do is to copy it.
  await expect.element(dialog(screen).getByText(fr.mcp.showOnce)).toBeVisible();
  await expectSelected(tokenField(screen), tokenOf(1));
  await expect.element(tokenField(screen)).toHaveAttribute("readonly");
  await expect.element(tokenField(screen)).toHaveAccessibleDescription(fr.mcp.showOnce);
  // The command for Claude Code: the user's configuration, never a project's .mcp.json.
  const command = claudeCommand(SERVER, tokenOf(1));
  expect(fieldOf(commandField(screen)).value).toBe(command);
  await expect.element(commandField(screen)).toHaveAttribute("readonly");
  await expect.element(dialog(screen).getByText(fr.mcp.claudeCode)).toBeVisible();
  expect(command).toContain("--scope user");
  // It is in monospace and wraps: no side scrolling to read it.
  const shown = fieldOf(commandField(screen));
  expect(getComputedStyle(shown).fontFamily).toMatch(/mono/i);
  expect(shown.scrollWidth).toBeLessThanOrEqual(shown.clientWidth);
  // For any other assistant: the address and the header.
  await expect.element(dialog(screen).getByText(fr.mcp.otherClients(SERVER))).toBeVisible();
  // The name form is gone, and the window closes on « J'ai copié le jeton ».
  await expect.element(nameField(screen)).not.toBeInTheDocument();
  await expect.element(inDialog(screen, fr.mcp.createSubmit)).not.toBeInTheDocument();
  const done = inDialog(screen, fr.mcp.done);
  await expect.element(done).toBeVisible();
  expect(done.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  expect(changes()).toEqual([["POST", PATH, { name: "Claude sur mon PC" }]]);

  // The token is in the window and in no cache of the queries, which the list
  // only gets the new token's name and dates from; and it was in no address.
  // The mutation let go of its answer as soon as the token was in the window,
  // which holds it alone.
  await vi.waitFor(() => {
    expect(whereIs(tokenOf(1), client)).not.toContain("the mutation cache");
  });
  const where = whereIs(tokenOf(1), client);
  expect(where).toContain("a field");
  expect(where).not.toContain("the query cache");
  expect(JSON.stringify(mocks.send.mock.calls.map(([path]) => path))).not.toContain("ptd_");
  await done.click();
  await expectRows(screen, 2);
  await expect.element(rows(screen).nth(0)).toMatchTextContent("Claude sur mon PC");
  await expect.element(rows(screen).nth(0)).toMatchTextContent(fr.mcp.neverUsed);
});

test("McpSection — « Copier le jeton » et « Copier la commande » copient", async () => {
  serve([]);
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const screen = await mount();
  await makeToken(screen);
  const status = dialog(screen).getByRole("status");
  // The line is there before it says anything, so that a screen reader reads what comes.
  await expect.element(status).toBeInTheDocument();
  await expect.element(status).toBeEmptyDOMElement();

  const copyToken = inDialog(screen, fr.mcp.copyToken);
  expect(copyToken.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await copyToken.click();

  expect(writeText).toHaveBeenCalledExactlyOnceWith(tokenOf(1));
  // In the window (a modal window makes the page behind it inert, the messages
  // that rise from the corner with it), and as a message.
  await expect.element(status).toHaveTextContent(fr.mcp.tokenCopied);
  await expectToast(fr.mcp.tokenCopied);

  const copyCommand = inDialog(screen, fr.mcp.copyCommand);
  expect(copyCommand.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await copyCommand.click();

  expect(writeText).toHaveBeenLastCalledWith(claudeCommand(SERVER, tokenOf(1)));
  expect(writeText).toHaveBeenCalledTimes(2);
  await expect.element(status).toHaveTextContent(fr.mcp.commandCopied);
  await expectToast(fr.mcp.commandCopied);
});

test.each([
  [
    "le presse-papiers refuse",
    () =>
      vi
        .spyOn(navigator.clipboard, "writeText")
        .mockRejectedValue(new DOMException("no", "NotAllowedError")),
  ],
  [
    "il n'y a pas de presse-papiers",
    () => {
      Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    },
  ],
])(
  "McpSection — quand %s, le texte est sélectionné et rien ne dit qu'il a été copié",
  async (_case, breakClipboard) => {
    serve([]);
    const screen = await mount();
    await makeToken(screen);
    breakClipboard();

    // The command: its text is selected, for a copy by hand.
    await inDialog(screen, fr.mcp.copyCommand).click();
    await expectSelected(commandField(screen), claudeCommand(SERVER, tokenOf(1)));
    // The token too, once the focus has gone elsewhere.
    await inDialog(screen, fr.mcp.copyToken).click();
    await expectSelected(tokenField(screen), tokenOf(1));

    await expect.element(dialog(screen).getByRole("status")).toBeEmptyDOMElement();
    expect(toasts()).not.toContain(fr.mcp.tokenCopied);
    expect(toasts()).not.toContain(fr.mcp.commandCopied);
  },
);

// --- Closing the window ---

test("McpSection — fermer la fenêtre efface le jeton de la page", async () => {
  serve([NEVER]);
  const client = newClient();
  const screen = await mount(["fr"], client);

  // With « J'ai copié le jeton ».
  await makeToken(screen, "Premier");
  expect(whereIs(tokenOf(1), client)).toContain("a field");
  await inDialog(screen, fr.mcp.done).click();

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  // The mutation is let go of with its answer (it is kept for no time), once the window is.
  await vi.waitFor(() => {
    expect(whereIs(tokenOf(1), client)).toEqual([]);
  });
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  // The list has the new row, without a secret.
  await expectRows(screen, 2);
  await expect.element(rows(screen).nth(0)).toMatchTextContent("Premier");
  // The focus is back on the button that opened the window.
  await expect.element(button(screen, fr.mcp.create)).toHaveFocus();

  // With the Escape key, which is as good.
  await makeToken(screen, "Second");
  expect(whereIs(tokenOf(2), client)).toContain("a field");
  await userEvent.keyboard("{Escape}");

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(whereIs(tokenOf(2), client)).toEqual([]);
  });
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  await expectRows(screen, 3);
  await expect.element(rows(screen).nth(0)).toMatchTextContent("Second");
  await expect.element(button(screen, fr.mcp.create)).toHaveFocus();

  // And with the cross.
  await makeToken(screen, "Troisième");
  await dialog(screen).getByRole("button", { name: fr.common.close }).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(whereIs(tokenOf(3), client)).toEqual([]);
  });

  // A window opened again is the one of a new token: nothing of the last one is in it.
  await button(screen, fr.mcp.create).click();
  await expect.element(nameField(screen)).toHaveValue("");
  await expect.element(tokenField(screen)).not.toBeInTheDocument();
  expect(whereIs(tokenOf(3), client)).toEqual([]);
});

test("McpSection — un nom vide ou refusé garde la fenêtre ouverte avec l'erreur", async () => {
  serve([]);
  const screen = await mount();
  await button(screen, fr.mcp.create).click();
  const submit = buttonOf(inDialog(screen, fr.mcp.createSubmit));
  const asks: {
    typed: string;
    /** What the server answers: nothing when nothing is to be sent. */
    answer: Error | null;
    message: string;
    underField: boolean;
  }[] = [
    // Nothing but spaces: nothing is sent.
    { typed: "   ", answer: null, message: fr.errors.validation_required, underField: true },
    // What the server says of a field is said under it.
    {
      typed: "Claude",
      answer: fieldRefusal("name", "validation_required"),
      message: fr.errors.validation_required,
      underField: true,
    },
    // The limit is not about the field.
    {
      typed: "Claude",
      answer: refusal(400, { code: "token_limit" }),
      message: fr.errors.token_limit,
      underField: false,
    },
    {
      typed: "Claude",
      answer: new TypeError("network"),
      message: fr.errors.generic,
      underField: false,
    },
  ];

  for (const { typed, answer, message, underField } of asks) {
    mocks.send.mockReset();
    if (answer !== null) mocks.send.mockRejectedValue(answer);
    await nameField(screen).fill(typed);
    submit.focus();
    submit.click();

    await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(message);
    // The window stays, with what was typed, and a button that can try again.
    await expect.element(dialog(screen)).toBeVisible();
    await expect.element(nameField(screen)).toHaveValue(typed);
    await expect.element(tokenField(screen)).not.toBeInTheDocument();
    await expectAvailable(submit);
    expect(changes()).toHaveLength(answer === null ? 0 : 1);
    // Under the field when it is about the field, and the field says so: its
    // description is its hint, and then the error.
    await expect
      .element(nameField(screen))
      .toHaveAttribute("aria-invalid", underField ? "true" : "false");
    await expect
      .element(nameField(screen))
      .toHaveAccessibleDescription(underField ? `${fr.mcp.nameHint} ${message}` : fr.mcp.nameHint);
  }

  // Then it is accepted, from the same window: the error goes with the form.
  serve([]);
  await nameField(screen).fill("Claude");
  submit.click();
  await expectSelected(tokenField(screen), tokenOf(1));
  await expect.element(dialog(screen).getByRole("alert")).not.toBeInTheDocument();
});

test("McpSection — à 5 jetons, le message de la limite remplace « Nouveau jeton »", async () => {
  serve(FIVE);
  const screen = await mount();

  await expect.element(section(screen).getByText(fr.mcp.limit(5))).toBeVisible();
  await expect.element(button(screen, fr.mcp.create)).not.toBeInTheDocument();
  await expectRows(screen, 5);
});

test("McpSection — le cinquième jeton prend la place de « Nouveau jeton » : le focus va au titre", async () => {
  serve(FIVE.slice(0, 4));
  const screen = await mount();
  await expect.element(section(screen).getByText(fr.mcp.limit(5))).not.toBeInTheDocument();

  await makeToken(screen, "Le cinquième");
  await inDialog(screen, fr.mcp.done).click();

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(section(screen).getByText(fr.mcp.limit(5))).toBeVisible();
  await expect.element(button(screen, fr.mcp.create)).not.toBeInTheDocument();
  // The button that opened the window is gone: the title has the focus, not the page.
  await expect.element(heading(screen)).toHaveFocus();

  // Revoking one gives the button back.
  await button(screen, fr.mcp.revokeLabel("Assistant 1")).click();
  await inDialog(screen, fr.mcp.revoke).click();
  await expect.element(button(screen, fr.mcp.create)).toBeVisible();
  await expect.element(section(screen).getByText(fr.mcp.limit(5))).not.toBeInTheDocument();
});

// --- Revoking a token ---

test("McpSection — révoquer demande confirmation, puis le titre prend le focus", async () => {
  serve([USED, NEVER]);
  const screen = await mount();
  const revoke = button(screen, fr.mcp.revokeLabel(USED.name));

  // Nothing is done before the member says so.
  await revoke.click();
  await expect
    .element(dialog(screen).getByRole("heading", { name: fr.mcp.revokeTitle }))
    .toBeVisible();
  await expect.element(dialog(screen).getByText(fr.mcp.revokeWarning(USED.name))).toBeVisible();
  await inDialog(screen, fr.common.cancel).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(revoke).toHaveFocus();
  expect(changes()).toEqual([]);
  await expectRows(screen, 2);

  // Closing with the Escape key is cancelling too.
  await revoke.click();
  await expect.element(dialog(screen)).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(revoke).toHaveFocus();
  expect(changes()).toEqual([]);

  // Then it is revoked: the token of that row, and no other.
  await revoke.click();
  const confirm = inDialog(screen, fr.mcp.revoke);
  expect(confirm.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await confirm.click();

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  expect(changes()).toEqual([["DELETE", `${PATH}/${USED.id}`, undefined]]);
  await expectToast(fr.mcp.revoked);
  await expectRows(screen, 1);
  await expect.element(rows(screen).nth(0)).toMatchTextContent(NEVER.name);
  await expect.element(section(screen).getByText(USED.name)).not.toBeInTheDocument();
  // The button that had the focus is gone with its row: the title has it, not the page.
  await expect.element(heading(screen)).toHaveFocus();
});

test("McpSection — révoquer le dernier jeton laisse « Aucun jeton pour l'instant. »", async () => {
  serve([NEVER]);
  const screen = await mount();

  await button(screen, fr.mcp.revokeLabel(NEVER.name)).click();
  await inDialog(screen, fr.mcp.revoke).click();

  await expect.element(section(screen).getByText(fr.mcp.empty)).toBeVisible();
  await expect.element(rows(screen)).not.toBeInTheDocument();
  await expect.element(heading(screen)).toHaveFocus();
});

test("McpSection — révoquer : un seul envoi, et un refus reste dans la fenêtre, qui dit pourquoi", async () => {
  serve([USED]);
  const screen = await mount();
  await button(screen, fr.mcp.revokeLabel(USED.name)).click();
  const pending = Promise.withResolvers<unknown>();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET"
      ? Promise.resolve({ url: SERVER, max: 5, tokens: [USED] })
      : pending.promise,
  );

  const confirm = buttonOf(inDialog(screen, fr.mcp.revoke));
  clickTwice(confirm);
  await expectBusy(confirm);
  expect(changes()).toHaveLength(1);

  pending.reject(refusal(403, { code: "forbidden" }));
  await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(confirm);
  await expect.element(dialog(screen)).toBeVisible();
  // The page behind it still has the token.
  await expectRows(screen, 1);

  // Another try goes through.
  serve([USED]);
  confirm.click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(rows(screen)).not.toBeInTheDocument();
});

test("McpSection — un jeton déjà révoqué ailleurs : la fenêtre le dit, et la liste se relit", async () => {
  serve([USED, NEVER]);
  const screen = await mount();
  await button(screen, fr.mcp.revokeLabel(USED.name)).click();
  // It was revoked from another tab: the server no longer knows it.
  mocks.send.mockImplementation((_path, request) =>
    request.method === "DELETE"
      ? Promise.reject(refusal(404, { code: "not_found" }))
      : Promise.resolve({ url: SERVER, max: 5, tokens: [NEVER] }),
  );
  const before = reads();

  await inDialog(screen, fr.mcp.revoke).click();

  await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(fr.errors.not_found);
  // The page now says what there is.
  await expectRows(screen, 1);
  expect(reads()).toBe(before + 1);
  await inDialog(screen, fr.common.cancel).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  // The button that opened the window is gone: the title has the focus.
  await expect.element(heading(screen)).toHaveFocus();
});

// --- One request ---

test("McpSection — un double clic sur « Créer le jeton » n'envoie qu'une requête", async () => {
  serve([]);
  const screen = await mount();
  await button(screen, fr.mcp.create).click();
  await nameField(screen).fill("Claude");
  // From now on the server takes its time to answer.
  const pending = Promise.withResolvers<unknown>();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET"
      ? Promise.resolve({ url: SERVER, max: 5, tokens: [] })
      : pending.promise,
  );

  // Two taps in the same tick: one request, and the button says it is working without losing the focus.
  const submit = buttonOf(inDialog(screen, fr.mcp.createSubmit));
  clickTwice(submit);
  await expectBusy(submit);
  expect(changes()).toHaveLength(1);

  pending.resolve({
    id: "new1",
    name: "Claude",
    created: "2026-11-03 09:00:00.000Z",
    token: tokenOf(1),
    url: SERVER,
  });
  await expectSelected(tokenField(screen), tokenOf(1));
  expect(changes()).toHaveLength(1);
});

// --- Loading, and what goes wrong ---

test("McpSection — tant que la liste charge, rien à toucher", async () => {
  const status = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(status.promise);
  const screen = await mount();

  await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
  await expect.element(button(screen, fr.mcp.create)).not.toBeInTheDocument();
  await expect.element(section(screen).getByText(fr.mcp.empty)).not.toBeInTheDocument();

  status.resolve({ url: SERVER, max: 5, tokens: [] });
  await expect.element(button(screen, fr.mcp.create)).toBeVisible();
});

test("McpSection — absente quand le serveur répond 404", async () => {
  // The demo has no tokens: its routes do not exist.
  mocks.send.mockRejectedValue(refusal(404, { message: "The requested resource wasn't found." }));
  // A section that fails to draw would be gone too: React reports that as an
  // error of the window.
  const thrown: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    event.preventDefault();
    thrown.push(event.error);
  };
  window.addEventListener("error", onError);
  onTestFinished(() => {
    window.removeEventListener("error", onError);
  });
  const screen = await mount();

  await vi.waitFor(() => {
    expect(mocks.send).toHaveBeenCalled();
  });
  await expect.element(screen.getByText(fr.common.loading)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("region")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("alert")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
  // Asked once: a 404 is an answer, not a failure to try again.
  expect(reads()).toBe(1);
  expect(thrown).toEqual([]);
});

test("McpSection — une panne de lecture (pas un 404) dit l'erreur avec « Réessayer », et le titre prend le focus au clic", async () => {
  mocks.send.mockRejectedValueOnce(new TypeError("network"));
  const screen = await mount();

  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(heading(screen)).toBeVisible();
  // Not « Nouveau jeton »: it is not known how many there are.
  await expect.element(button(screen, fr.mcp.create)).not.toBeInTheDocument();
  await expect.element(section(screen).getByText(fr.mcp.empty)).not.toBeInTheDocument();

  serve([USED]);
  await button(screen, fr.common.retry).click();

  await expectRows(screen, 1);
  // The button went with the request: the title has the focus, not the page.
  await expect.element(heading(screen)).toHaveFocus();
  await expect.element(section(screen).getByRole("alert")).not.toBeInTheDocument();
});

test("McpSection — une erreur du serveur (500) n'est pas un 404 : elle se dit aussi", async () => {
  mocks.send.mockRejectedValue(refusal(500, { message: "boom" }));
  const screen = await mount();

  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(button(screen, fr.common.retry)).toBeVisible();
});

test("McpSection — « Réessayer » : un double appui ne redemande qu'une fois", async () => {
  mocks.send.mockRejectedValueOnce(new TypeError("network"));
  const screen = await mount();
  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  expect(reads()).toBe(1);
  const answer = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(answer.promise);

  clickTwice(buttonOf(button(screen, fr.common.retry)));

  await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
  await expect.element(heading(screen)).toHaveFocus();
  expect(reads()).toBe(2);
  answer.resolve({ url: SERVER, max: 5, tokens: [] });
  await expect.element(button(screen, fr.mcp.create)).toBeVisible();
});

// --- The account ---

test("McpSection — les jetons d'un compte ne sont pas montrés à celui qui se connecte ensuite", async () => {
  serve([USED]);
  const screen = await mount();
  await expectRows(screen, 1);

  // Another account signs in, over this session, and its list is slow to come:
  // nothing of Alice's is in the section meanwhile.
  const bobs = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(bobs.promise);
  setRecord(BOB);

  await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
  await expect.element(section(screen).getByText(USED.name)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.mcp.create)).not.toBeInTheDocument();

  bobs.resolve({ url: SERVER, max: 5, tokens: [] });
  await expect.element(section(screen).getByText(fr.mcp.empty)).toBeVisible();
});

// --- The language ---

test("McpSection — en anglais", async () => {
  serve([USED, NEVER]);
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const screen = await mount(["en-GB"]);
  const english = en.mcp;

  // The list.
  await expect.element(section(screen)).toHaveAccessibleName(english.title);
  await expect.element(section(screen).getByText(english.intro)).toBeVisible();
  await expect.element(rows(screen).nth(0)).toMatchTextContent(/Created on 3 Nov 2026/);
  await expect.element(rows(screen).nth(0)).toMatchTextContent(/Used on 3 Nov 2026.*14:05/);
  await expect.element(rows(screen).nth(1)).toMatchTextContent(english.neverUsed);
  await expect
    .element(button(screen, english.revokeLabel(USED.name)))
    .toHaveTextContent(english.revoke);

  // The window of a new token, then the token.
  await button(screen, english.create).click();
  await expect
    .element(dialog(screen).getByRole("heading", { name: english.createTitle }))
    .toBeVisible();
  await expect
    .element(nameField(screen, english.name))
    .toHaveAccessibleDescription(english.nameHint);
  await nameField(screen, english.name).fill("Claude");
  await inDialog(screen, english.createSubmit).click();
  await expectSelected(tokenField(screen, english.tokenLabel), tokenOf(1));
  await expect.element(dialog(screen).getByText(english.showOnce)).toBeVisible();
  await expect.element(dialog(screen).getByText(english.claudeCode)).toBeVisible();
  await expect.element(dialog(screen).getByText(english.otherClients(SERVER))).toBeVisible();
  await expect.element(commandField(screen, english.commandLabel)).toBeVisible();
  await inDialog(screen, english.copyToken).click();
  await expect.element(dialog(screen).getByRole("status")).toHaveTextContent(english.tokenCopied);
  await inDialog(screen, english.copyCommand).click();
  await expect.element(dialog(screen).getByRole("status")).toHaveTextContent(english.commandCopied);
  expect(writeText).toHaveBeenCalledTimes(2);
  await inDialog(screen, english.done).click();

  // A refusal, translated.
  const server = mocks.send.getMockImplementation();
  if (server === undefined) throw new Error("serve() first");
  mocks.send.mockImplementation((path, request) =>
    request.method === "POST"
      ? Promise.reject(refusal(400, { code: "token_limit" }))
      : server(path, request),
  );
  await button(screen, english.create).click();
  await nameField(screen, english.name).fill("Encore");
  await inDialog(screen, english.createSubmit).click();
  await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(en.errors.token_limit);
  await inDialog(screen, en.common.cancel).click();
  mocks.send.mockImplementation(server);

  // The confirmation, and the message that follows.
  await button(screen, english.revokeLabel(NEVER.name)).click();
  await expect
    .element(dialog(screen).getByRole("heading", { name: english.revokeTitle }))
    .toBeVisible();
  await expect.element(dialog(screen).getByText(english.revokeWarning(NEVER.name))).toBeVisible();
  await inDialog(screen, english.revoke).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expectToast(english.revoked);
  await expectRows(screen, 2);
});

test("McpSection — en anglais, à 5 jetons, le message de la limite", async () => {
  serve(FIVE);
  const screen = await mount(["en-GB"]);

  await expect.element(section(screen).getByText(en.mcp.limit(5))).toBeVisible();
  await expect.element(button(screen, en.mcp.create)).not.toBeInTheDocument();
});
