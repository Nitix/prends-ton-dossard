import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { buttonOf, clickTwice } from "../../test/busyButton";
import type { InstallEnvironment } from "./environment";
import { captureInstallPrompt } from "./installPrompt";
import { InstallSection } from "./InstallSection";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../../styles.css";

let stop: (() => void) | undefined;

afterEach(() => {
  stop?.();
  stop = undefined;
});

/** What main.tsx does at the start of the app: the browser sends its offer once, early. */
function listen() {
  stop = captureInstallPrompt();
}

/** What Chromium sends when the site can be installed. */
function offer(
  prompt = vi.fn<() => Promise<unknown>>(() => Promise.resolve({ outcome: "accepted" })),
) {
  const event = Object.assign(new Event("beforeinstallprompt", { cancelable: true }), { prompt });
  window.dispatchEvent(event);
  return { event, prompt };
}

/** A tab of a browser, not installed, not an iPhone. */
const TAB: InstallEnvironment = { standalone: false, ios: false };

function mount(environment: InstallEnvironment = TAB, languages: string[] = ["fr"]) {
  return render(
    <I18nProvider languages={languages}>
      <InstallSection environment={() => environment} />
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

const installButton = (screen: Screen) =>
  screen.getByRole("button", { name: fr.install.button, exact: true });
const title = (screen: Screen) => screen.getByRole("heading", { name: fr.install.title });

test("InstallSection — le bouton après beforeinstallprompt, qui appelle prompt()", async () => {
  listen();
  const screen = await mount();
  // Nothing to install yet: the way to do it from the menu of the browser.
  await expect.element(screen.getByRole("region", { name: fr.install.title })).toBeVisible();
  await expect.element(screen.getByText(fr.install.other)).toBeVisible();
  await expect.element(installButton(screen)).not.toBeInTheDocument();

  const { event, prompt } = offer();

  // The mini-bar of the browser stays away: the button is the way.
  expect(event.defaultPrevented).toBe(true);
  await expect.element(installButton(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.install.other)).not.toBeInTheDocument();
  expect(installButton(screen).element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

  await installButton(screen).click();

  expect(prompt).toHaveBeenCalledTimes(1);
  // The offer is spent, and cannot be made again: the button goes, and the
  // focus goes to the title of the section, not to the page.
  await expect.element(installButton(screen)).not.toBeInTheDocument();
  await expect.element(title(screen)).toHaveFocus();
  await expect.element(screen.getByText(fr.install.other)).toBeVisible();
});

test("InstallSection — l'offre reçue avant l'affichage de la section est gardée", async () => {
  // The browser sends it once, long before somebody opens the profile.
  listen();
  const { prompt } = offer();

  const screen = await mount();
  await installButton(screen).click();

  expect(prompt).toHaveBeenCalledTimes(1);
});

test("InstallSection — un deuxième appui ne rappelle pas prompt()", async () => {
  listen();
  const { prompt } = offer();
  const screen = await mount();
  await expect.element(installButton(screen)).toBeVisible();

  // Two taps in the same tick, as a double tap does.
  clickTwice(buttonOf(installButton(screen)));

  await expect.element(installButton(screen)).not.toBeInTheDocument();
  expect(prompt).toHaveBeenCalledTimes(1);
});

test("InstallSection — l'appli installée, le bouton disparaît sans prendre le focus", async () => {
  listen();
  offer();
  const screen = await mount();
  await expect.element(installButton(screen)).toBeVisible();
  const elsewhere = document.createElement("input");
  document.body.append(elsewhere);
  elsewhere.focus();

  window.dispatchEvent(new Event("appinstalled"));

  await expect.element(installButton(screen)).not.toBeInTheDocument();
  await expect.element(screen.getByText(fr.install.other)).toBeVisible();
  // The focus was somewhere else, and stays there.
  expect(document.activeElement).toBe(elsewhere);
  elsewhere.remove();
});

test("InstallSection — l'appli installée pendant que le bouton a le focus, le titre le prend", async () => {
  listen();
  offer();
  const screen = await mount();
  const button = buttonOf(installButton(screen));
  button.focus();
  expect(document.activeElement).toBe(button);

  // Installed some other way (the menu of the browser): the button goes while it has the focus.
  window.dispatchEvent(new Event("appinstalled"));

  await expect.element(installButton(screen)).not.toBeInTheDocument();
  await expect.element(title(screen)).toHaveFocus();
});

test("InstallSection — une nouvelle offre redessine la page sans enlever le focus au bouton", async () => {
  listen();
  offer();
  const screen = await mount();
  const button = buttonOf(installButton(screen));
  button.focus();

  // The browser can make its offer again: the page draws again, and the same button stays.
  offer();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));

  expect(buttonOf(installButton(screen))).toBe(button);
  expect(document.activeElement).toBe(button);
});

test("InstallSection — rien quand le site est installé", async () => {
  listen();
  offer();

  const screen = await mount({ standalone: true, ios: false });

  await expect.element(screen.getByRole("region")).not.toBeInTheDocument();
  await expect.element(screen.getByRole("heading")).not.toBeInTheDocument();
  await expect.element(installButton(screen)).not.toBeInTheDocument();
  expect(screen.container.textContent).toBe("");
});

test("InstallSection — la phrase iPhone sur iOS", async () => {
  listen();

  const screen = await mount({ standalone: false, ios: true });

  await expect.element(screen.getByText(fr.install.ios)).toBeVisible();
  await expect.element(screen.getByText(fr.install.other)).not.toBeInTheDocument();
  await expect.element(screen.getByRole("button")).not.toBeInTheDocument();
});

test("InstallSection — en anglais", async () => {
  listen();
  const screen = await mount({ standalone: false, ios: true }, ["en"]);
  await expect.element(screen.getByRole("region", { name: en.install.title })).toBeVisible();
  await expect.element(screen.getByText(en.install.ios)).toBeVisible();
  await screen.unmount();

  const other = await mount(TAB, ["en"]);
  await expect.element(other.getByText(en.install.other)).toBeVisible();
  offer();
  await expect.element(other.getByRole("button", { name: en.install.button })).toBeVisible();
});
