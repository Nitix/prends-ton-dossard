import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { createFormatters } from "../../lib/format";
import { ensureTemporal } from "../../lib/temporal";
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
  props: { kind?: "invite" | "reset"; languages?: string[]; onClose?: () => void } = {},
) {
  const { kind = "invite", languages = ["fr-FR"], onClose = () => {} } = props;
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

test("ShareLinkDialog — sans navigator.share, pas de bouton Partager ; Copier appelle clipboard.writeText avec l'URL", async () => {
  const writeText = withClipboard();
  const screen = await renderDialog();

  await expect.element(shareButton(screen)).not.toBeInTheDocument();
  await copyButton(screen).click();

  expect(writeText).toHaveBeenCalledExactlyOnceWith(URL_OF_LINK);
  await expect.element(screen.getByText(fr.admin.copied)).toBeVisible();
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
  // The toasts are in the live region: nothing shows up in it.
  expect(screen.container.querySelector("output")?.textContent ?? "").toBe("");
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

  await expect.element(screen.getByText(fr.admin.shareFailed)).toBeVisible();
});

test("ShareLinkDialog — une copie refusée est dite, et le lien reste à copier à la main", async () => {
  const writeText = vi
    .fn<(text: string) => Promise<void>>()
    .mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
  withClipboard(writeText);
  const screen = await renderDialog();

  await copyButton(screen).click();

  await expect.element(screen.getByText(fr.admin.copyFailed)).toBeVisible();
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

  await expect.element(screen.getByText(fr.admin.copyFailed)).toBeVisible();
});

test("ShareLinkDialog — les boutons font au moins 44 px", async () => {
  withClipboard();
  withShare();
  const screen = await renderDialog();

  for (const button of [shareButton(screen), copyButton(screen)]) {
    expect(button.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
});
