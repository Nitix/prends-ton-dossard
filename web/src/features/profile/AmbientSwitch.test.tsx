import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { ToastProvider } from "../../components/Toast";
import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { AMBIENT_KEY, chooseAmbient, readAmbient } from "../../lib/ambient";
import { SKINS, chooseSkin } from "../../skins";
import { HeroArt } from "../../skins/carnet/motifs";
import { AppearanceSection } from "./AppearanceSection";

import "../../styles.css";

// « Animer le fond » in « Apparence »: the switch that stops the motion of a skin
// whose background moves (src/skins/README.md, « Motion »; WCAG 2.2.2, moving
// content that lasts more than five seconds). Shown only for such a skin, on by
// default, kept on the device, and the motifs stand still when it is off.

afterEach(async () => {
  chooseAmbient(true);
  localStorage.removeItem(AMBIENT_KEY);
  await chooseSkin("crete");
});

function renderAppearance(languages = ["fr"]) {
  return render(
    <I18nProvider languages={languages}>
      <ToastProvider>
        <AppearanceSection />
      </ToastProvider>
      {/* A motif of the skin, on the page: it follows the switch. */}
      <div data-art className="relative h-40 w-80">
        <HeroArt place="event" />
      </div>
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof renderAppearance>>;

const switchOf = (screen: Screen, texts = fr) =>
  screen.getByRole("switch", { name: texts.settings.animateBackground });

/** Whether anything in the motif on the page moves. */
const moves = () =>
  document
    .querySelector("[data-art]")
    ?.getAnimations({ subtree: true })
    .some((animation) => animation instanceof CSSAnimation) ?? false;

test("« Animer le fond » : seul un skin dont le fond bouge l'offre, et il disparaît avec lui", async () => {
  // Crête, and every skin that does not say it has an animated background: no switch.
  const steady = SKINS.filter((skin) => !skin.animatedBackground);
  expect(steady.length).toBeGreaterThan(0);
  for (const skin of steady) {
    await chooseSkin(skin.id);
    const screen = await renderAppearance();
    await expect.element(screen.getByRole("radiogroup", { name: fr.settings.skin })).toBeVisible();
    await expect.element(switchOf(screen)).not.toBeInTheDocument();
    await screen.unmount();
  }
  for (const skin of SKINS.filter((one) => one.animatedBackground)) {
    await chooseSkin(skin.id);
    const screen = await renderAppearance();
    await expect.element(switchOf(screen)).toBeVisible();
    // Choosing a skin that has none: the switch is gone, the choice is kept for the next.
    await screen.getByRole("radio", { name: SKINS[0]?.label.fr ?? "", exact: true }).click();
    await expect.element(switchOf(screen)).not.toBeInTheDocument();
    await screen.unmount();
  }
});

test("« Animer le fond » : allumé par défaut, et les dessins bougent", async () => {
  await chooseSkin("carnet");
  const screen = await renderAppearance();
  await expect.element(switchOf(screen)).toBeChecked();
  expect(moves()).toBe(true);
});

test("« Animer le fond » : éteint, c'est gardé sur l'appareil et les dessins s'arrêtent ; rallumé, ils reprennent", async () => {
  await chooseSkin("carnet");
  const screen = await renderAppearance();

  await switchOf(screen).click();
  await expect.element(switchOf(screen)).not.toBeChecked();
  expect(localStorage.getItem(AMBIENT_KEY)).toBe("off");
  expect(readAmbient()).toBe(false);
  await expect.poll(moves).toBe(false);
  // Everything is still drawn: it only stands still.
  expect(document.querySelectorAll("[data-art] .carnet-veil")).toHaveLength(4);

  await switchOf(screen).click();
  await expect.element(switchOf(screen)).toBeChecked();
  expect(localStorage.getItem(AMBIENT_KEY)).toBeNull();
  await expect.poll(moves).toBe(true);
});

test("« Animer le fond » : ce qui est gardé sur l'appareil est là en arrivant", async () => {
  await chooseSkin("carnet");
  localStorage.setItem(AMBIENT_KEY, "off");
  const screen = await renderAppearance();
  await expect.element(switchOf(screen)).not.toBeChecked();
  expect(moves()).toBe(false);
});

test("« Animer le fond » : un autre onglet qui l'éteint l'éteint ici aussi", async () => {
  await chooseSkin("carnet");
  const screen = await renderAppearance();
  await expect.element(switchOf(screen)).toBeChecked();

  // What the storage tells the other pages of the site when a tab changes a key.
  localStorage.setItem(AMBIENT_KEY, "off");
  window.dispatchEvent(new StorageEvent("storage", { key: AMBIENT_KEY, newValue: "off" }));
  await expect.element(switchOf(screen)).not.toBeChecked();
  await expect.poll(moves).toBe(false);
});

test("« Animer le fond » : au clavier, la barre d'espace le bascule ; une cible de 44 px au moins, dite en français et en anglais", async () => {
  await chooseSkin("carnet");
  const screen = await renderAppearance();
  const control = switchOf(screen);
  const { width, height } = control.element().getBoundingClientRect();
  expect(width).toBeGreaterThanOrEqual(44);
  expect(height).toBeGreaterThanOrEqual(44);

  control.element().focus();
  await userEvent.keyboard(" ");
  await expect.element(control).not.toBeChecked();
  await userEvent.keyboard(" ");
  await expect.element(control).toBeChecked();
  // It says what it does, beyond its name.
  await expect.element(control).toHaveAccessibleDescription(fr.settings.animateBackgroundHint);
  await screen.unmount();

  const english = await renderAppearance(["en-GB"]);
  await expect.element(switchOf(english, en)).toBeVisible();
  await expect
    .element(switchOf(english, en))
    .toHaveAccessibleDescription(en.settings.animateBackgroundHint);
});
