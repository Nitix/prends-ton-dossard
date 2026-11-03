import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { SKIN_KEY, SKINS, chooseSkin } from "../../skins";
import { UNSAVED_KEY } from "../auth/accountSkin";
import { AppearanceSection } from "./AppearanceSection";

import "../../styles.css";

// « Thème » in « Apparence », for somebody who is signed in: the skin chosen
// goes to the account too (the rules of what it keeps, and when it fails, are
// features/auth/accountSkin.test.ts), and a look that cannot be loaded says so.
// The server is a stand-in here, and so is the loading of the looks, which can
// fail as offline. A look is loaded once and then kept, so the skin that fails
// is one that no test here ever loads for good.

/** The account of the session, and what the server is asked. */
const account = vi.hoisted(() => ({
  record: null as { id: string; collectionName: string } | null,
  update: vi.fn<(id: string, body: { skin: string }) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    authStore: {
      get record() {
        return account.record;
      },
      onChange: () => () => {},
    },
    collection: () => ({ update: account.update }),
  },
}));

/**
 * What the browser says of the network, and the reload that it would do: a look
 * that cannot be loaded online is a tab older than the deploy, and the page
 * reloads (lib/staleChunks.ts), which a test must not do.
 */
const net = vi.hoisted(() => ({ online: false, reload: undefined as undefined | (() => boolean) }));

vi.mock("../../lib/staleChunks", () => ({
  isOnline: () => net.online,
  reloadOnce: () => net.reload?.() ?? false,
}));

/** The skins whose look cannot be loaded (offline, never loaded before), and those that a test holds back (a slow network). */
const failing = vi.hoisted(() => new Set<string>());
const gates = vi.hoisted(() => new Map<string, Promise<void>>());

vi.mock("../../skins/looks", async (importOriginal) => {
  const { LOOKS: real } = await importOriginal<typeof import("../../skins/looks")>();
  return {
    LOOKS: Object.fromEntries(
      Object.entries(real).map(([path, load]) => [
        path,
        async () => {
          const id = /^\.\/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path;
          await gates.get(id);
          if (failing.has(id)) {
            throw new TypeError(`Failed to fetch dynamically imported module: ${path}`);
          }
          return load();
        },
      ]),
    ),
  };
});

beforeEach(() => {
  // Offline unless a test says otherwise: the message that blames the connection.
  net.online = false;
  net.reload = undefined;
  account.record = { id: "u1", collectionName: "users" };
  account.update.mockReset();
  account.update.mockResolvedValue({});
  failing.clear();
  gates.clear();
});

afterEach(async () => {
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(UNSAVED_KEY);
  await chooseSkin("crete");
});

/** The skins but Crête, in the order of the picker. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete" && !skin.id.startsWith("_"));
const [A, B, C] = OTHERS;
if (A === undefined || B === undefined || C === undefined) {
  throw new Error("three skins besides Crête");
}
/** A skin that has one mode only: « Clair ou sombre » gives way to a sentence when it is the page's. */
const SINGLE = SKINS.find((skin) => skin.modes.length === 1 && !skin.id.startsWith("_"));
const CRETE = SKINS.find((skin) => skin.id === "crete")?.label.fr ?? "Crête";

function renderAppearance(languages = ["fr"]) {
  return render(
    <I18nProvider languages={languages}>
      <ToastProvider>
        <AppearanceSection />
      </ToastProvider>
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof renderAppearance>>;

const card = (screen: Screen, label: string) =>
  screen.getByRole("radiogroup", { name: fr.settings.skin }).getByRole("radio", {
    name: label,
    exact: true,
  });

test("Thème — connecté, choisir un thème l'enregistre sur le compte, une fois son look chargé", async () => {
  const screen = await renderAppearance();

  await card(screen, A.label.fr).click();

  await expect.poll(() => document.documentElement.dataset.skin).toBe(A.id);
  await expect.poll(() => account.update.mock.calls).toEqual([["u1", { skin: A.id }]]);
  await expect.element(card(screen, A.label.fr)).toBeChecked();
});

test("Thème — choisir Crête de nouveau l'enregistre aussi", async () => {
  const screen = await renderAppearance();
  await card(screen, A.label.fr).click();
  await expect.poll(() => account.update.mock.calls.length).toBe(1);

  await card(screen, CRETE).click();

  await expect.poll(() => account.update.mock.calls.at(-1)).toEqual(["u1", { skin: "crete" }]);
  await expect.element(card(screen, CRETE)).toBeChecked();
});

test("Thème — sans session, le choix vaut pour l'appareil et rien n'est envoyé", async () => {
  account.record = null;
  const screen = await renderAppearance();

  await card(screen, A.label.fr).click();

  await expect.poll(() => document.documentElement.dataset.skin).toBe(A.id);
  expect(localStorage.getItem(SKIN_KEY)).toBe(A.id);
  expect(account.update).not.toHaveBeenCalled();
});

test("Thème — hors ligne, le choix reste sur l'appareil et la carte cochée, sans message : le compte le recevra à la prochaine connexion", async () => {
  account.update.mockRejectedValue(new TypeError("Failed to fetch"));
  const screen = await renderAppearance();

  await card(screen, A.label.fr).click();

  await expect.poll(() => localStorage.getItem(UNSAVED_KEY)).toBe("u1");
  expect(localStorage.getItem(SKIN_KEY)).toBe(A.id);
  expect(document.documentElement.dataset.skin).toBe(A.id);
  await expect.element(card(screen, A.label.fr)).toBeChecked();
  expect(document.querySelector(".toast")).toBeNull();
});

test("Thème — un look qui ne se charge pas : un message le dit, le thème d'avant reste choisi et rien n'est envoyé", async () => {
  failing.add(C.id);
  const screen = await renderAppearance();

  await card(screen, C.label.fr).click();

  await expect.element(screen.getByText(fr.settings.skinLoadFailed)).toBeVisible();
  expect(fr.settings.skinLoadFailed).toBe("Ce thème n'a pas pu se charger : vérifie ta connexion.");
  await expect.element(card(screen, CRETE)).toBeChecked();
  await expect.element(card(screen, C.label.fr)).not.toBeChecked();
  expect(document.documentElement.dataset.skin).toBeUndefined();
  expect(localStorage.getItem(SKIN_KEY)).toBeNull();
  expect(account.update).not.toHaveBeenCalled();
});

test("Thème — le message d'un look qui ne se charge pas est dans la langue de la page", async () => {
  failing.add(C.id);
  const screen = await renderAppearance(["en"]);

  await screen
    .getByRole("radiogroup", { name: en.settings.skin })
    .getByRole("radio", { name: C.label.en, exact: true })
    .click();

  await expect.element(screen.getByText(en.settings.skinLoadFailed)).toBeVisible();
  expect(en.settings.skinLoadFailed).not.toBe(fr.settings.skinLoadFailed);
});

test("Thème — un look qui ne se charge pas n'écrase pas un thème déjà choisi : sa carte reste cochée", async () => {
  failing.add(C.id);
  const screen = await renderAppearance();
  await card(screen, A.label.fr).click();
  await expect.poll(() => document.documentElement.dataset.skin).toBe(A.id);

  await card(screen, C.label.fr).click();

  await expect.element(screen.getByText(fr.settings.skinLoadFailed)).toBeVisible();
  await expect.element(card(screen, A.label.fr)).toBeChecked();
  expect(document.documentElement.dataset.skin).toBe(A.id);
  expect(localStorage.getItem(SKIN_KEY)).toBe(A.id);
  expect(account.update.mock.calls).toEqual([["u1", { skin: A.id }]]);
});

// What assistive technology hears while a look loads: the card is checked at
// once, which says nothing of the wait.
test("Thème — pendant que le look se charge, un état poli le dit (« Chargement du thème… »), puis plus rien", async () => {
  const { promise, resolve } = Promise.withResolvers<void>();
  gates.set(B.id, promise);
  const screen = await renderAppearance();
  const group = screen.getByRole("radiogroup", { name: fr.settings.skin });

  await card(screen, B.label.fr).click();

  // In a live region, politely: it is read out when it appears, without interrupting.
  const status = screen.getByText(fr.settings.skinLoading);
  await expect.element(status).toBeInTheDocument();
  const region = status.element().closest("output");
  expect(region, "a live region").not.toBeNull();
  expect(group.element().getAttribute("aria-busy")).toBe("true");

  resolve();
  await expect.poll(() => document.documentElement.dataset.skin).toBe(B.id);
  // Nothing more to say: the region stays, empty.
  await expect.poll(() => region?.textContent).toBe("");
  expect(group.element().getAttribute("aria-busy")).toBe("false");
});

test("Thème — l'état de chargement est dans la langue de la page, et un échec ne le laisse pas : c'est le message qui parle", async () => {
  failing.add(C.id);
  const { promise, resolve } = Promise.withResolvers<void>();
  gates.set(C.id, promise);
  const screen = await renderAppearance(["en"]);

  await screen
    .getByRole("radiogroup", { name: en.settings.skin })
    .getByRole("radio", { name: C.label.en, exact: true })
    .click();
  await expect.element(screen.getByText(en.settings.skinLoading)).toBeInTheDocument();

  resolve();
  // The message says it failed (it is a live region too): no « loading » is left behind.
  const failed = screen.getByText(en.settings.skinLoadFailed);
  await expect.element(failed).toBeVisible();
  expect(failed.element().closest("output"), "the message is in a live region").not.toBeNull();
  await expect.poll(() => document.body.textContent.includes(en.settings.skinLoading)).toBe(false);
});

test("Thème — quand « Clair ou sombre » cède la place à une phrase, le focus reste sur les thèmes, pas au sommet de la page", async () => {
  if (SINGLE === undefined) throw new Error("a skin with one mode only");
  const screen = await renderAppearance();
  const light = screen
    .getByRole("group", { name: fr.settings.mode })
    .getByRole("radio", { name: fr.settings.themeLight });
  light.element().focus();
  expect(document.activeElement).toBe(light.element());

  // The skin comes from elsewhere (another tab, the account at sign-in) while the focus is in the modes.
  await chooseSkin(SINGLE.id);

  const sentence = SINGLE.modes[0] === "dark" ? fr.settings.onlyDark : fr.settings.onlyLight;
  await expect.element(screen.getByText(sentence)).toBeVisible();
  expect(document.activeElement, "the focus is on the skin chosen").toBe(
    card(screen, SINGLE.label.fr).element(),
  );
});

// A look that does not load while the browser is online is a tab that is older
// than the last deploy: the choice is kept for the page that comes, and the page
// reloads, with no message. If it was reloaded just before, the look is missing
// for good: a message that does not blame the connection.
test("Thème — en ligne, un look qui ne se charge pas (un déploiement) : le choix est gardé, la page se recharge, sans message, et la carte reste cochée", async () => {
  const reload = vi.fn<() => boolean>(() => true);
  net.online = true;
  net.reload = reload;
  failing.add(C.id);
  const screen = await renderAppearance();

  await card(screen, C.label.fr).click();

  await expect.poll(() => reload.mock.calls.length).toBe(1);
  expect(localStorage.getItem(SKIN_KEY)).toBe(C.id);
  expect(localStorage.getItem(UNSAVED_KEY)).toBe("u1");
  // The page is about to go: nothing is said, and the card is not unchecked under the finger.
  expect(document.querySelector(".toast")).toBeNull();
  await expect.element(card(screen, C.label.fr)).toBeChecked();
  expect(document.documentElement.dataset.skin).toBeUndefined();
  expect(account.update).not.toHaveBeenCalled();
});

test("Thème — en ligne, un look qui manque encore après un rechargement : un message qui ne met pas en cause la connexion", async () => {
  net.online = true;
  net.reload = () => false;
  failing.add(C.id);
  const screen = await renderAppearance();

  await card(screen, C.label.fr).click();

  await expect.element(screen.getByText(fr.settings.skinLoadFailedOnline)).toBeVisible();
  expect(fr.settings.skinLoadFailedOnline).toBe(
    "Ce thème n'a pas pu se charger : recharge l'application.",
  );
  expect(fr.settings.skinLoadFailedOnline).not.toContain("connexion");
  await expect.element(card(screen, CRETE)).toBeChecked();
});

test("Thème — le message d'un look qui manque en ligne est dans la langue de la page", async () => {
  net.online = true;
  net.reload = () => false;
  failing.add(C.id);
  const screen = await renderAppearance(["en"]);

  await screen
    .getByRole("radiogroup", { name: en.settings.skin })
    .getByRole("radio", { name: C.label.en, exact: true })
    .click();

  await expect.element(screen.getByText(en.settings.skinLoadFailedOnline)).toBeVisible();
});
