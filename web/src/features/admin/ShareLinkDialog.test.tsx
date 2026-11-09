import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
import { animationsDone } from "../../test/animations";
import { ShareLinkDialog } from "./ShareLinkDialog";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

const URL_OF_LINK = "https://courses.example.test/invitation#s3cr3t-t0ken";
// The route answers in RFC 3339.
const EXPIRES_AT = "2026-11-07T12:00:00Z";

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

/** A browser that cannot share, but copies. */
function withClipboard(writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue()) {
  stubNavigator("share", undefined);
  stubNavigator("canShare", undefined);
  stubNavigator("clipboard", { writeText });
  return writeText;
}

/** A browser that can share. */
function withShare(share = vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue()) {
  const canShare = vi.fn<(data: ShareData) => boolean>().mockReturnValue(true);
  stubNavigator("share", share);
  stubNavigator("canShare", canShare);
  return { share, canShare };
}

async function renderDialog(
  props: {
    kind?: "invite" | "reset";
    languages?: string[];
    message?: string;
    onClose?: () => void;
  } = {},
) {
  const { kind = "invite", languages = ["fr-FR"], message, onClose = () => {} } = props;
  const screen = await render(
    <QueryClientProvider client={new QueryClient()}>
      <I18nProvider languages={languages}>
        <ToastProvider>
          <ShareLinkDialog
            open
            onClose={onClose}
            url={URL_OF_LINK}
            expiresAt={EXPIRES_AT}
            kind={kind}
            message={message}
            runnerName="Alice"
          />
        </ToastProvider>
      </I18nProvider>
    </QueryClientProvider>,
  );
  await expect.element(screen.getByRole("dialog")).toBeVisible();
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderDialog>>;

const shareButton = (screen: Screen) => screen.getByRole("button", { name: fr.admin.share });
const copyButton = (screen: Screen) => screen.getByRole("button", { name: fr.admin.copy });

/**
 * The line that says what a button came to, inside the dialog. A modal dialog
 * makes the rest of the page inert, so a screen reader does not read the toast
 * out: this line is where the message is heard.
 */
const status = (screen: Screen) => screen.getByRole("dialog").getByRole("status");

/** What the toasts say: they are in the page, outside the dialog. */
const toastText = (screen: Screen) =>
  [...screen.container.querySelectorAll("output")]
    .filter((output) => output.closest("dialog") === null)
    .map((output) => output.textContent)
    .join("");

test("ShareLinkDialog — sans navigator.share, pas de bouton Partager ; Copier appelle clipboard.writeText avec l'URL", async () => {
  const writeText = withClipboard();
  const screen = await renderDialog();

  await expect.element(shareButton(screen)).not.toBeInTheDocument();
  await copyButton(screen).click();

  expect(writeText).toHaveBeenCalledExactlyOnceWith(URL_OF_LINK);
  await expect.element(status(screen)).toHaveTextContent(fr.admin.copied);
  await vi.waitFor(() => {
    expect(toastText(screen)).toBe(fr.admin.copied);
  });
});

test("ShareLinkDialog — la ligne d'état est dans la fenêtre dès l'ouverture, vide : une zone vivante ne lit que ce qu'on y met", async () => {
  withClipboard();
  const screen = await renderDialog();

  await expect.element(status(screen)).toBeInTheDocument();
  expect(status(screen).element().textContent).toBe("");
});

test("ShareLinkDialog — le lien est dans un champ en lecture seule", async () => {
  withClipboard();
  const screen = await renderDialog();

  const input = screen.getByLabelText(fr.admin.link, { exact: true });
  await expect.element(input).toHaveValue(URL_OF_LINK);
  await expect.element(input).toHaveAttribute("readonly");
});

test("ShareLinkDialog — dit jusqu'à quand le lien marche", async () => {
  withClipboard();
  const screen = await renderDialog();

  const day = createFormatters("fr-FR").dateLong(Temporal.PlainDate.from("2026-11-07"));
  expect(day).toContain("7");
  await expect.element(screen.getByText(fr.admin.expires(day), { exact: false })).toBeVisible();
});

test("ShareLinkDialog — la date d'expiration suit la langue", async () => {
  withClipboard();
  const screen = await renderDialog({ languages: ["en-GB"] });

  const day = createFormatters("en-GB").dateLong(Temporal.PlainDate.from("2026-11-07"));
  await expect.element(screen.getByText(en.admin.expires(day), { exact: false })).toBeVisible();
});

test("ShareLinkDialog — le titre dit pour qui est le lien et ce qu'il fait", async () => {
  withClipboard();
  const invite = await renderDialog({ kind: "invite" });
  await expect
    .element(invite.getByRole("heading", { name: fr.admin.shareTitle.invite("Alice") }))
    .toBeVisible();
  await invite.unmount();

  const reset = await renderDialog({ kind: "reset" });
  await expect
    .element(reset.getByRole("heading", { name: fr.admin.shareTitle.reset("Alice") }))
    .toBeVisible();
});

test("ShareLinkDialog — avec navigator.canShare, Partager appelle navigator.share avec l'URL et un titre", async () => {
  withClipboard();
  const { share, canShare } = withShare();
  const screen = await renderDialog();

  await shareButton(screen).click();

  expect(canShare).toHaveBeenCalledWith({ url: URL_OF_LINK });
  expect(share).toHaveBeenCalledExactlyOnceWith({
    url: URL_OF_LINK,
    title: fr.admin.shareSubject.invite,
  });
  // Nothing to say: the share sheet of the system is the feedback.
  expect(screen.container.textContent).not.toContain(fr.errors.generic);
});

test("ShareLinkDialog — le titre du partage est celui d'une réinitialisation pour un lien reset", async () => {
  const { share } = withShare();
  const screen = await renderDialog({ kind: "reset" });

  await shareButton(screen).click();

  expect(share).toHaveBeenCalledExactlyOnceWith({
    url: URL_OF_LINK,
    title: fr.admin.shareSubject.reset,
  });
});

test("ShareLinkDialog — canShare qui refuse l'URL : pas de bouton Partager", async () => {
  withClipboard();
  const { canShare } = withShare();
  canShare.mockReturnValue(false);
  const screen = await renderDialog();

  await expect.element(shareButton(screen)).not.toBeInTheDocument();
  await expect.element(copyButton(screen)).toBeVisible();
});

test("ShareLinkDialog — fermer la feuille de partage (AbortError) ne dit rien", async () => {
  withClipboard();
  const share = vi
    .fn<(data: ShareData) => Promise<void>>()
    .mockRejectedValue(new DOMException("Share canceled", "AbortError"));
  withShare(share);
  const screen = await renderDialog();

  await shareButton(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledOnce();
  });
  // Nothing is said: not in the toasts, not in the line of the dialog.
  expect(toastText(screen)).toBe("");
  expect(status(screen).element().textContent).toBe("");
  await expect.element(shareButton(screen)).toBeEnabled();
});

test("ShareLinkDialog — un autre échec du partage est dit", async () => {
  withClipboard();
  const share = vi
    .fn<(data: ShareData) => Promise<void>>()
    .mockRejectedValue(new DOMException("No", "NotAllowedError"));
  withShare(share);
  const screen = await renderDialog();

  await shareButton(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.shareFailed);
  await vi.waitFor(() => {
    expect(toastText(screen)).toBe(fr.admin.shareFailed);
  });
});

test("ShareLinkDialog — un partage refusé après un partage annulé est dit, et l'annulation suivante efface le message", async () => {
  withClipboard();
  const share = vi
    .fn<(data: ShareData) => Promise<void>>()
    .mockRejectedValueOnce(new DOMException("No", "NotAllowedError"))
    .mockRejectedValueOnce(new DOMException("Share canceled", "AbortError"));
  withShare(share);
  const screen = await renderDialog();

  await shareButton(screen).click();
  await expect.element(status(screen)).toHaveTextContent(fr.admin.shareFailed);
  await shareButton(screen).click();

  // The old message does not stay on screen as if it were the answer to this press.
  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledTimes(2);
    expect(status(screen).element().textContent).toBe("");
  });
});

test("ShareLinkDialog — une copie refusée est dite, et le lien reste à copier à la main", async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  withClipboard(writeText);
  const screen = await renderDialog();

  await copyButton(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.copyFailed);
  await vi.waitFor(() => {
    expect(toastText(screen)).toBe(fr.admin.copyFailed);
  });
  expect(screen.container.textContent).not.toContain(fr.admin.copied);
  await expect
    .element(screen.getByLabelText(fr.admin.link, { exact: true }))
    .toHaveValue(URL_OF_LINK);
});

test("ShareLinkDialog — sans API de presse-papiers, la copie échoue proprement", async () => {
  stubNavigator("share", undefined);
  stubNavigator("canShare", undefined);
  stubNavigator("clipboard", undefined);
  const screen = await renderDialog();

  await copyButton(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.copyFailed);
});

test("ShareLinkDialog — une copie réussie après un échec remplace le message d'échec", async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValueOnce(new DOMException("Denied", "NotAllowedError"))
    .mockResolvedValueOnce();
  withClipboard(writeText);
  const screen = await renderDialog();

  await copyButton(screen).click();
  await expect.element(status(screen)).toHaveTextContent(fr.admin.copyFailed);
  await copyButton(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.copied);
  expect(status(screen).element().textContent).not.toContain(fr.admin.copyFailed);
});

test("ShareLinkDialog — les boutons font au moins 44 px", async () => {
  withClipboard();
  withShare();
  const screen = await renderDialog();
  await animationsDone();

  for (const button of [shareButton(screen), copyButton(screen)]) {
    expect(button.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});

const MESSAGE = `Alice t'invite sur Prends ton dossard.\n\n${URL_OF_LINK}`;

const named = (screen: Screen, name: string) => screen.getByRole("button", { name, exact: true });
const shareMessage = (screen: Screen) => named(screen, fr.admin.shareMessageButton);
const copyMessage = (screen: Screen) => named(screen, fr.admin.copyMessage);
const shareLink = (screen: Screen) => named(screen, fr.admin.shareLinkButton);
const copyLink = (screen: Screen) => named(screen, fr.admin.copyLink);

test("ShareLinkDialog — invitation : le message et le lien sont montrés en même temps, sans choix", async () => {
  withClipboard();
  withShare();
  const screen = await renderDialog({ message: MESSAGE });

  const box = screen.getByLabelText(fr.admin.messageLabel);
  await expect.element(box).toHaveValue(MESSAGE);
  expect(box.element()).toHaveProperty("readOnly", true);
  const link = screen.getByLabelText(fr.admin.link, { exact: true });
  await expect.element(link).toHaveValue(URL_OF_LINK);
  expect(link.element()).toHaveProperty("readOnly", true);
  expect(screen.getByRole("radio").elements()).toHaveLength(0);
  // The message comes first.
  expect(
    box.element().compareDocumentPosition(link.element()) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("ShareLinkDialog — « Partager le message » envoie { title, text }", async () => {
  withClipboard();
  const { share, canShare } = withShare();
  const screen = await renderDialog({ message: MESSAGE });

  await shareMessage(screen).click();

  expect(canShare).toHaveBeenCalledWith({ text: MESSAGE });
  expect(share).toHaveBeenCalledExactlyOnceWith({
    title: fr.admin.shareSubject.invite,
    text: MESSAGE,
  });
});

test("ShareLinkDialog — « Partager le lien » envoie { url, title }", async () => {
  withClipboard();
  const { share, canShare } = withShare();
  const screen = await renderDialog({ message: MESSAGE });

  await shareLink(screen).click();

  expect(canShare).toHaveBeenCalledWith({ url: URL_OF_LINK });
  expect(share).toHaveBeenCalledExactlyOnceWith({
    url: URL_OF_LINK,
    title: fr.admin.shareSubject.invite,
  });
});

test("ShareLinkDialog — chaque bouton Copier copie son contenu et le dit", async () => {
  const writeText = withClipboard();
  const screen = await renderDialog({ message: MESSAGE });

  await copyMessage(screen).click();
  expect(writeText).toHaveBeenLastCalledWith(MESSAGE);
  await expect.element(status(screen)).toHaveTextContent(fr.admin.messageCopied);

  await copyLink(screen).click();
  expect(writeText).toHaveBeenLastCalledWith(URL_OF_LINK);
  await expect.element(status(screen)).toHaveTextContent(fr.admin.copied);
});

test("ShareLinkDialog — sans partage possible, seuls les boutons Copier sont là, « Copier le message » en premier choix", async () => {
  withClipboard();
  const screen = await renderDialog({ message: MESSAGE });

  await expect.element(shareMessage(screen)).not.toBeInTheDocument();
  await expect.element(shareLink(screen)).not.toBeInTheDocument();
  expect(copyMessage(screen).element().className).toBe(PRIMARY);
  expect(copyLink(screen).element().className).toBe(SECONDARY);
});

test("ShareLinkDialog — avec le partage, « Partager le message » est le seul bouton principal", async () => {
  withClipboard();
  withShare();
  const screen = await renderDialog({ message: MESSAGE });

  expect(shareMessage(screen).element().className).toBe(PRIMARY);
  for (const other of [copyMessage(screen), shareLink(screen), copyLink(screen)]) {
    expect(other.element().className).toBe(SECONDARY);
  }
});

test("ShareLinkDialog — une copie du message refusée est dite", async () => {
  withClipboard(vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("no")));
  const screen = await renderDialog({ message: MESSAGE });

  await copyMessage(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.messageCopyFailed);
});

test("ShareLinkDialog — une copie du lien refusée est dite", async () => {
  withClipboard(vi.fn<(text: string) => Promise<void>>().mockRejectedValue(new Error("no")));
  const screen = await renderDialog({ message: MESSAGE });

  await copyLink(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.copyFailed);
});

test("ShareLinkDialog — un partage du message qui échoue le dit", async () => {
  withClipboard();
  withShare(vi.fn<(data: ShareData) => Promise<void>>().mockRejectedValue(new Error("no")));
  const screen = await renderDialog({ message: MESSAGE });

  await shareMessage(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.messageShareFailed);
});

test("ShareLinkDialog — un partage du lien qui échoue le dit", async () => {
  withClipboard();
  withShare(vi.fn<(data: ShareData) => Promise<void>>().mockRejectedValue(new Error("no")));
  const screen = await renderDialog({ message: MESSAGE });

  await shareLink(screen).click();

  await expect.element(status(screen)).toHaveTextContent(fr.admin.shareFailed);
});

test("ShareLinkDialog — un partage annulé ne dit rien", async () => {
  withClipboard();
  const { share } = withShare(
    vi
      .fn<(data: ShareData) => Promise<void>>()
      .mockRejectedValue(new DOMException("Share canceled", "AbortError")),
  );
  const screen = await renderDialog({ message: MESSAGE });

  await shareMessage(screen).click();
  await shareLink(screen).click();

  await vi.waitFor(() => {
    expect(share).toHaveBeenCalledTimes(2);
  });
  expect(toastText(screen)).toBe("");
  expect(status(screen).element().textContent).toBe("");
});

test("ShareLinkDialog — réinitialisation : le lien comme avant, sans message", async () => {
  const writeText = withClipboard();
  const screen = await renderDialog({ kind: "reset" });

  await expect.element(screen.getByLabelText(fr.admin.messageLabel)).not.toBeInTheDocument();
  await expect.element(screen.getByLabelText(fr.admin.link)).toHaveValue(URL_OF_LINK);
  await expect.element(named(screen, fr.admin.copyLink)).not.toBeInTheDocument();
  await copyButton(screen).click();
  expect(writeText).toHaveBeenCalledExactlyOnceWith(URL_OF_LINK);
});

test("ShareLinkDialog — en anglais, les boutons suivent la langue", async () => {
  withClipboard();
  const screen = await renderDialog({ message: MESSAGE, languages: ["en-GB"] });

  await expect
    .element(screen.getByRole("button", { name: en.admin.copyMessage, exact: true }))
    .toBeVisible();
  await expect
    .element(screen.getByRole("button", { name: en.admin.copyLink, exact: true }))
    .toBeVisible();
});
