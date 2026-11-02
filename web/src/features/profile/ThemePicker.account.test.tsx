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

/** The skins whose look cannot be loaded (offline, never loaded before). */
const failing = vi.hoisted(() => new Set<string>());

vi.mock("../../skins/looks", async (importOriginal) => {
  const { LOOKS: real } = await importOriginal<typeof import("../../skins/looks")>();
  return {
    LOOKS: Object.fromEntries(
      Object.entries(real).map(([path, load]) => [
        path,
        async () => {
          if (failing.has(/^\.\/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path)) {
            throw new TypeError(`Failed to fetch dynamically imported module: ${path}`);
          }
          return load();
        },
      ]),
    ),
  };
});

beforeEach(() => {
  account.record = { id: "u1", collectionName: "users" };
  account.update.mockReset();
  account.update.mockResolvedValue({});
  failing.clear();
});

afterEach(async () => {
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(UNSAVED_KEY);
  await chooseSkin("crete");
});

/** The skins but Crête, in the order of the picker. */
const OTHERS = SKINS.filter((skin) => skin.id !== "crete" && !skin.id.startsWith("_"));
const [A, , C] = OTHERS;
if (A === undefined || C === undefined) throw new Error("three skins besides Crête");
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
