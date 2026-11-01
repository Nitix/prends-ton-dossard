import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { buttonOf, clickTwice, expectAvailable, expectBusy } from "../../test/busyButton";
import { CalendarSection } from "./CalendarSection";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

type Rec = Record<string, unknown>;

const mocks = vi.hoisted(() => ({
  send: vi.fn<(path: string, options: Rec) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({ pb: { send: mocks.send } }));

const PATH = "/api/app/calendar";
const link = (n: number) => `https://courses.example.test/api/app/calendar/token-${n}.ics`;

beforeEach(() => {
  mocks.send.mockReset();
  vi.restoreAllMocks();
});

afterEach(() => {
  // Gives the browser its own clipboard back, if a test took it away.
  Reflect.deleteProperty(navigator, "clipboard");
});

/**
 * The server of the link of the account, as far as the section can tell: it
 * says whether there is a link, makes a new one (each is different) when it is
 * asked to, and deletes it.
 */
function serve(options: { exists: boolean }) {
  let exists = options.exists;
  let made = 0;
  mocks.send.mockImplementation((path, request) => {
    if (path !== PATH) return Promise.reject(new Error(`unexpected request to ${path}`));
    switch (request.method) {
      case "GET":
        return Promise.resolve({ exists });
      case "POST":
        exists = true;
        made += 1;
        return Promise.resolve({ url: link(made) });
      case "DELETE":
        exists = false;
        return Promise.resolve({});
      default:
        return Promise.reject(new Error(`unexpected method ${String(request.method)}`));
    }
  });
}

function refusal(code: string) {
  return new ClientResponseError({
    status: 403,
    response: { status: 403, message: "…", data: { code } },
  });
}

/** What the section asked the server to do: `[method, body]`, without the reads of the status. */
function changes(): [unknown, unknown][] {
  return mocks.send.mock.calls
    .filter(([, request]) => request.method !== "GET")
    .map(([, request]) => [request.method, request.body]);
}

function mount(languages: string[] = ["fr"]) {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider languages={languages}>
        <ToastProvider>
          <CalendarSection />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

/** The only region of the page: the section, named by its title. */
const section = (screen: Screen) => screen.getByRole("region");
const field = (screen: Screen) => section(screen).getByRole("textbox");
const button = (screen: Screen, name: string) =>
  section(screen).getByRole("button", { name, exact: true });
const dialog = (screen: Screen) => screen.getByRole("dialog");
const inDialog = (screen: Screen, name: string) =>
  dialog(screen).getByRole("button", { name, exact: true });

/** The link field has the focus and all its text selected, ready to be copied. */
async function expectSelected(screen: Screen, url: string) {
  await expect.element(field(screen)).toHaveFocus();
  const input = inputOf(field(screen));
  expect(input.value).toBe(url);
  expect([input.selectionStart, input.selectionEnd]).toEqual([0, url.length]);
}

function inputOf(locator: { element(): Element }): HTMLInputElement {
  const element = locator.element();
  if (!(element instanceof HTMLInputElement)) throw new Error("not an input");
  return element;
}

// --- Creating the link ---

test("CalendarSection — créer affiche le lien une fois, avec Copier", async () => {
  serve({ exists: false });
  const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
  const screen = await mount();

  await expect.element(button(screen, fr.calendar.create)).toBeVisible();
  await expect.element(section(screen)).toHaveAccessibleName(fr.calendar.title);
  // Nothing to copy yet, and nothing said about a link that does not exist.
  await expect.element(field(screen)).not.toBeInTheDocument();
  await expect.element(section(screen).getByText(fr.calendar.exists)).not.toBeInTheDocument();

  await button(screen, fr.calendar.create).click();

  // The link, in a field that cannot be typed in, selected, with what to do with it.
  await expectSelected(screen, link(1));
  await expect.element(field(screen)).toHaveAttribute("readonly");
  await expect.element(section(screen).getByText(fr.calendar.shownOnce)).toBeVisible();
  await expect.element(section(screen).getByText(fr.calendar.help)).toBeVisible();
  await expect.element(button(screen, fr.calendar.create)).not.toBeInTheDocument();
  expect(changes()).toEqual([["POST", { lang: "fr" }]]);

  await button(screen, fr.calendar.copy).click();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(link(1));
  await expect.element(screen.getByText(fr.calendar.copied)).toBeVisible();
  // The tap target of the button is at least 44 px.
  expect(
    button(screen, fr.calendar.copy).element().getBoundingClientRect().height,
  ).toBeGreaterThanOrEqual(44);

  // The server only keeps the fingerprint of the token: once the page is left, the
  // link is not shown again, only that there is one.
  await screen.unmount();
  const again = await mount();
  await expect.element(section(again).getByText(fr.calendar.exists)).toBeVisible();
  await expect.element(field(again)).not.toBeInTheDocument();
  expect(again.container.textContent).not.toContain("token-1");
});

test("CalendarSection — un lien actif propose Nouveau lien et Supprimer, avec confirmation", async () => {
  serve({ exists: true });
  const screen = await mount();

  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeVisible();
  await expect.element(button(screen, fr.calendar.create)).not.toBeInTheDocument();
  for (const name of [fr.calendar.renew, fr.calendar.remove]) {
    const opener = button(screen, name);
    await expect.element(opener).toBeVisible();
    expect(opener.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }

  // Nothing is done before the member says so: each one asks first.
  await button(screen, fr.calendar.renew).click();
  await expect.element(dialog(screen).getByText(fr.calendar.renewHint)).toBeVisible();
  await expect
    .element(dialog(screen).getByRole("heading", { name: fr.calendar.renew }))
    .toBeVisible();
  await inDialog(screen, fr.common.cancel).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  // The focus is back on the button that opened the window.
  await expect.element(button(screen, fr.calendar.renew)).toHaveFocus();

  await button(screen, fr.calendar.remove).click();
  await expect
    .element(dialog(screen).getByRole("heading", { name: fr.calendar.remove }))
    .toBeVisible();
  await inDialog(screen, fr.common.cancel).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.remove)).toHaveFocus();

  // Closing with the Escape key is cancelling too.
  await button(screen, fr.calendar.renew).click();
  await expect.element(dialog(screen)).toBeVisible();
  await screen.getByRole("dialog").getByRole("button", { name: fr.common.close }).click();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.renew)).toHaveFocus();

  expect(changes()).toEqual([]);
  // The page still says the link is active.
  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeVisible();
});

test("CalendarSection — annuler rend le focus au bouton même quand le navigateur ne le lui avait pas donné", async () => {
  serve({ exists: true });
  const screen = await mount();
  await expect.element(button(screen, fr.calendar.renew)).toBeVisible();

  // Safari does not give the focus to a button that is tapped: the window opens
  // from a button that has none.
  buttonOf(button(screen, fr.calendar.renew)).click();
  await expect.element(dialog(screen)).toBeVisible();
  await inDialog(screen, fr.common.cancel).click();

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.renew)).toHaveFocus();
});

test("CalendarSection — Nouveau lien confirmé remplace le lien et le montre, sélectionné", async () => {
  serve({ exists: true });
  const screen = await mount();

  await button(screen, fr.calendar.renew).click();
  await inDialog(screen, fr.calendar.renew).click();

  await expectSelected(screen, link(1));
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await expect.element(section(screen).getByText(fr.calendar.shownOnce)).toBeVisible();
  // The old state is gone: it is the new link that is on the page.
  await expect.element(section(screen).getByText(fr.calendar.exists)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.renew)).not.toBeInTheDocument();
  expect(changes()).toEqual([["POST", { lang: "fr" }]]);
});

test("CalendarSection — Supprimer le lien confirmé le supprime, puis propose d'en créer un, et le focus va au titre", async () => {
  serve({ exists: true });
  const screen = await mount();

  await button(screen, fr.calendar.remove).click();
  await inDialog(screen, fr.calendar.remove).click();

  await expect.element(button(screen, fr.calendar.create)).toBeVisible();
  await expect.element(dialog(screen)).not.toBeInTheDocument();
  expect(changes()).toEqual([["DELETE", undefined]]);
  await expect.element(section(screen).getByText(fr.calendar.exists)).not.toBeInTheDocument();
  // The button that had the focus is gone with the link: the title has it, not the page.
  await expect
    .element(section(screen).getByRole("heading", { name: fr.calendar.title }))
    .toHaveFocus();
});

// --- The language ---

test("CalendarSection — envoie la langue de l'interface", async () => {
  serve({ exists: false });
  const screen = await mount(["en-GB"]);

  // The texts are in English, and so is the link that is asked for.
  const english = en.calendar;
  await expect.element(section(screen)).toHaveAccessibleName(english.title);
  await button(screen, english.create).click();
  await expectSelected(screen, link(1));
  await expect.element(screen.getByText(english.shownOnce)).toBeVisible();
  await expect.element(screen.getByText(english.help)).toBeVisible();
  expect(changes()).toEqual([["POST", { lang: "en" }]]);

  // A new link too.
  await screen.unmount();
  const again = await mount(["en-GB"]);
  await button(again, english.renew).click();
  await expect.element(dialog(again).getByText(english.renewHint)).toBeVisible();
  await inDialog(again, english.renew).click();
  await expectSelected(again, link(2));
  expect(changes()).toEqual([
    ["POST", { lang: "en" }],
    ["POST", { lang: "en" }],
  ]);

  // And in French, French.
  await again.unmount();
  mocks.send.mockClear();
  serve({ exists: false });
  const french = await mount(["fr-FR"]);
  await button(french, fr.calendar.create).click();
  await expectSelected(french, link(1));
  expect(changes()).toEqual([["POST", { lang: "fr" }]]);
});

// --- Copying ---

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
  "CalendarSection — quand %s, le lien est sélectionné et « Lien copié » ne s'affiche pas",
  async (_case, breakClipboard) => {
    serve({ exists: false });
    const screen = await mount();
    await button(screen, fr.calendar.create).click();
    await expectSelected(screen, link(1));

    breakClipboard();
    await button(screen, fr.calendar.copy).click();

    // The text is selected for the member to copy by hand: with the focus on the field.
    await expect.element(field(screen)).toHaveFocus();
    await expectSelected(screen, link(1));
    await expect.element(screen.getByText(fr.calendar.copied)).not.toBeInTheDocument();
  },
);

// --- Loading, and what goes wrong ---

test("CalendarSection — tant que le statut charge, rien à toucher", async () => {
  const status = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(status.promise);
  const screen = await mount();

  await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
  await expect.element(button(screen, fr.calendar.create)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.renew)).not.toBeInTheDocument();
  await expect.element(button(screen, fr.calendar.remove)).not.toBeInTheDocument();

  status.resolve({ exists: false });
  await expect.element(button(screen, fr.calendar.create)).toBeVisible();
});

test("CalendarSection — un statut qu'on n'a pas pu lire le dit, et on peut réessayer", async () => {
  mocks.send.mockRejectedValueOnce(new TypeError("network"));
  const screen = await mount();

  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  // Not "create": it is not known whether there is a link.
  await expect.element(button(screen, fr.calendar.create)).not.toBeInTheDocument();

  serve({ exists: true });
  await button(screen, fr.common.retry).click();
  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeVisible();
  // The button went with the request: the title has the focus, not the page.
  await expect
    .element(section(screen).getByRole("heading", { name: fr.calendar.title }))
    .toHaveFocus();
  await expect.element(section(screen).getByRole("alert")).not.toBeInTheDocument();
});

test("CalendarSection — un statut illisible relu par la fenêtre, sans « Réessayer », ne déplace pas le focus", async () => {
  mocks.send.mockRejectedValueOnce(new TypeError("network"));
  const screen = await mount();
  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  const heading = section(screen).getByRole("heading", { name: fr.calendar.title });

  // The window gets the focus again: the status is read again by itself, and it comes.
  serve({ exists: true });
  window.dispatchEvent(new Event("visibilitychange"));

  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeVisible();
  // Nobody asked for it: the page is not scrolled to the title, which has not taken the focus.
  expect(document.activeElement).not.toBe(heading.element());
  expect(document.activeElement).toBe(document.body);
});

test("CalendarSection — « Réessayer » : le focus est sur le titre dès l'appui, un double appui ne redemande qu'une fois", async () => {
  mocks.send.mockRejectedValueOnce(new TypeError("network"));
  const screen = await mount();
  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  const reads = () =>
    mocks.send.mock.calls.filter(([, request]) => request.method === "GET").length;
  expect(reads()).toBe(1);
  const answer = Promise.withResolvers<unknown>();
  mocks.send.mockReturnValue(answer.promise);
  const retry = buttonOf(button(screen, fr.common.retry));
  expect(retry.disabled).toBe(false);

  clickTwice(retry);

  await expect.element(section(screen).getByText(fr.common.loading)).toBeVisible();
  await expect
    .element(section(screen).getByRole("heading", { name: fr.calendar.title }))
    .toHaveFocus();
  // The first read, and one more.
  expect(reads()).toBe(2);
  answer.resolve({ exists: true });
  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeVisible();
  await expect
    .element(section(screen).getByRole("heading", { name: fr.calendar.title }))
    .toHaveFocus();
});

test("CalendarSection — créer : un seul envoi, le bouton dit qu'il travaille sans perdre le focus, et un refus se lit et se réessaie", async () => {
  serve({ exists: false });
  const screen = await mount();
  await expect.element(button(screen, fr.calendar.create)).toBeVisible();
  // From now on the server takes its time to answer.
  const pending = Promise.withResolvers<unknown>();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET" ? Promise.resolve({ exists: false }) : pending.promise,
  );

  // Two taps in the same tick: one request.
  const create = buttonOf(button(screen, fr.calendar.create));
  clickTwice(create);
  await expectBusy(create);
  expect(changes()).toHaveLength(1);

  // The server refuses: its answer is said in words, and the button is there for another try.
  pending.reject(refusal("forbidden"));
  await expect.element(section(screen).getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(create);

  serve({ exists: false });
  create.click();
  await expectSelected(screen, link(1));
  await expect.element(section(screen).getByRole("alert")).not.toBeInTheDocument();
});

test("CalendarSection — Nouveau lien refusé reste dans la fenêtre, qui dit pourquoi et peut recommencer", async () => {
  serve({ exists: true });
  const screen = await mount();
  await button(screen, fr.calendar.renew).click();
  const pending = Promise.withResolvers<unknown>();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET" ? Promise.resolve({ exists: true }) : pending.promise,
  );

  const confirm = buttonOf(inDialog(screen, fr.calendar.renew));
  clickTwice(confirm);
  await expectBusy(confirm);
  expect(changes()).toHaveLength(1);

  pending.reject(refusal("forbidden"));
  await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(fr.errors.forbidden);
  await expectAvailable(confirm);
  await expect.element(dialog(screen)).toBeVisible();

  serve({ exists: true });
  confirm.click();
  await expectSelected(screen, link(1));
  await expect.element(dialog(screen)).not.toBeInTheDocument();
});

test("CalendarSection — Supprimer le lien refusé reste dans la fenêtre, qui dit pourquoi", async () => {
  serve({ exists: true });
  const screen = await mount();
  await button(screen, fr.calendar.remove).click();
  mocks.send.mockImplementation((_path, request) =>
    request.method === "GET"
      ? Promise.resolve({ exists: true })
      : Promise.reject(new TypeError("network")),
  );

  const confirm = buttonOf(inDialog(screen, fr.calendar.remove));
  clickTwice(confirm);

  await expect.element(dialog(screen).getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expectAvailable(confirm);
  expect(changes()).toHaveLength(1);
  // The window stays, and the page behind it still says the link is active.
  await expect.element(dialog(screen)).toBeVisible();
  await expect.element(section(screen).getByText(fr.calendar.exists)).toBeInTheDocument();
});
