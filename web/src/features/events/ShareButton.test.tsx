import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { animationsDone } from "../../test/animations";
import { toEventView } from "./api";
import { shareText, whatsappURL } from "./share";
import { ShareButton } from "./ShareButton";
import { eventRecord } from "./testFixture";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

const TODAY = "2026-01-05";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  // Back to the browser's own: what a test defines shadows the prototype.
  for (const name of ["share", "canShare", "clipboard"]) Reflect.deleteProperty(navigator, name);
});

/** Replaces a member of `navigator` for the test, `undefined` for a browser that does not have it. */
function stubNavigator(name: "share" | "canShare" | "clipboard", value: unknown) {
  Object.defineProperty(navigator, name, { value, configurable: true, writable: true });
}

/** A browser that can share, and says it can. */
function withShare(
  share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(),
  canShare: ((data: ShareData) => boolean) | undefined = () => true,
) {
  stubNavigator("share", share);
  stubNavigator("canShare", canShare);
  return share;
}

/** Firefox on a computer: no share sheet, a clipboard. */
function withoutShare(writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()) {
  stubNavigator("share", undefined);
  stubNavigator("canShare", undefined);
  stubNavigator("clipboard", { writeText });
  return writeText;
}

const view = () => toEventView(eventRecord);

/** The text the button sends: the page is at `location.origin`, on the day of the tests. */
const expectedText = () =>
  shareText(view(), location.origin, Temporal.PlainDate.from(TODAY), createFormatters("fr-FR"), fr);

async function renderButton() {
  return render(
    <I18nProvider languages={["fr-FR"]}>
      <TodayProvider value={Temporal.PlainDate.from(TODAY)}>
        <ShareButton view={view()} />
      </TodayProvider>
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof renderButton>>;

const button = (screen: Screen) => screen.getByRole("button", { name: fr.share.button });
const dialog = (screen: Screen) => screen.getByRole("dialog", { name: fr.share.title });
const field = (screen: Screen) => screen.getByLabelText(fr.share.textLabel);

test("ShareButton — navigator.share reçoit le titre et le texte, l'adresse dans le texte et pas dans url", async () => {
  const share = withShare();
  const screen = await renderButton();

  await button(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledOnce();
  });
  const [data] = share.mock.calls[0] ?? [];
  expect(data).toEqual({ title: "Trail des Crêtes", text: expectedText() });
  expect(data?.text).toContain(`${location.origin}/evenements/event`);
  await expect.element(dialog(screen)).not.toBeInTheDocument();
});

test("ShareButton — une annulation ne fait rien", async () => {
  const share = withShare(
    vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new DOMException("", "AbortError")),
  );
  const screen = await renderButton();

  await button(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledOnce();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect.element(dialog(screen)).not.toBeInTheDocument();
});

test("ShareButton — un refus ouvre la fenêtre", async () => {
  withShare(
    vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new DOMException("", "NotAllowedError")),
  );
  const screen = await renderButton();

  await button(screen).click();

  await expect.element(dialog(screen)).toBeVisible();
});

test("ShareButton — canShare qui dit non ouvre la fenêtre sans appeler share", async () => {
  const share = withShare(undefined, () => false);
  const screen = await renderButton();

  await button(screen).click();

  await expect.element(dialog(screen)).toBeVisible();
  expect(share).not.toHaveBeenCalled();
});

test("ShareButton — sans navigator.share, la fenêtre : le texte sélectionné et focalisé, copier, WhatsApp, la phrase de connexion", async () => {
  withoutShare();
  const screen = await renderButton();

  await button(screen).click();

  await expect.element(dialog(screen)).toBeVisible();
  await animationsDone();
  const textarea = field(screen).element();
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("the text is not in a textarea");
  expect(textarea.readOnly).toBe(true);
  expect(textarea.value).toBe(expectedText());
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(textarea);
  });
  expect(textarea.selectionStart).toBe(0);
  expect(textarea.selectionEnd).toBe(textarea.value.length);

  await expect.element(screen.getByRole("button", { name: fr.share.copy })).toBeVisible();
  const link = screen.getByRole("link", { name: `${fr.share.whatsapp} ${fr.share.newTab}` });
  await expect.element(link).toHaveAttribute("href", whatsappURL(expectedText()));
  await expect.element(link).toHaveAttribute("target", "_blank");
  await expect.element(link).toHaveAttribute("rel", "noopener noreferrer");
  await expect.element(screen.getByText(fr.share.signIn)).toBeVisible();
});

test("ShareButton — la copie : « Texte copié. »", async () => {
  const writeText = withoutShare();
  const screen = await renderButton();
  await button(screen).click();
  await expect.element(dialog(screen)).toBeVisible();

  await screen.getByRole("button", { name: fr.share.copy }).click();

  expect(writeText).toHaveBeenCalledExactlyOnceWith(expectedText());
  await expect.element(dialog(screen).getByRole("status")).toHaveTextContent(fr.share.copied);
});

test("ShareButton — copie refusée : le texte reste sélectionné pour une copie à la main", async () => {
  withoutShare(vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("denied")));
  const screen = await renderButton();
  await button(screen).click();
  await expect.element(dialog(screen)).toBeVisible();

  await screen.getByRole("button", { name: fr.share.copy }).click();

  await expect.element(dialog(screen).getByRole("status")).toHaveTextContent(fr.share.copyFailed);
  const textarea = field(screen).element();
  if (!(textarea instanceof HTMLTextAreaElement)) throw new Error("the text is not in a textarea");
  expect(document.activeElement).toBe(textarea);
  expect(textarea.selectionStart).toBe(0);
  expect(textarea.selectionEnd).toBe(textarea.value.length);
});

test("ShareButton — le focus revient au bouton à la fermeture", async () => {
  withoutShare();
  const screen = await renderButton();
  await button(screen).click();
  await expect.element(dialog(screen)).toBeVisible();

  await dialog(screen).getByRole("button", { name: fr.common.close, exact: true }).first().click();

  await expect.element(dialog(screen)).not.toBeInTheDocument();
  await vi.waitFor(() => {
    expect(document.activeElement).toBe(button(screen).element());
  });
});

test("ShareButton — un second appui pendant que la feuille est ouverte est ignoré", async () => {
  const gate = Promise.withResolvers<void>();
  const share = withShare(
    vi.fn<(data: ShareData) => Promise<void>>().mockReturnValue(gate.promise),
  );
  const screen = await renderButton();

  await button(screen).click();
  await button(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledOnce();
  });
  gate.resolve();
  // Once it is over, the button shares again.
  await vi.waitFor(async () => {
    await button(screen).click();
    expect(share).toHaveBeenCalledTimes(2);
  });
});

test("ShareButton — InvalidStateError (une feuille déjà ouverte) n'ouvre pas la fenêtre", async () => {
  const share = withShare(
    vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new DOMException("", "InvalidStateError")),
  );
  const screen = await renderButton();

  await button(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledOnce();
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  await expect.element(dialog(screen)).not.toBeInTheDocument();
});
