import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEME_KEY, chooseTheme } from "../../lib/theme";
import { SKIN_KEY, SKINS, chooseSkin } from "../../skins";
import { fontsReady } from "../../test/fontsReady";
import { emulateMedia, resetMedia } from "../../test/media";
import { AppearanceSection } from "./AppearanceSection";
// « Thème » in « Apparence », on the settings page: the skins of the app as
// cards (a name, two colours, a sample of its font), then « Auto / Clair /
// Sombre » for a skin that has both modes. The tests of the modes themselves
// are those of SettingsPage.test.tsx, unchanged.

import "../../styles.css";

afterEach(async () => {
  // The skin and the theme belong to the page and to the device: a test leaves neither to the next.
  chooseSkin("crete");
  chooseTheme("auto");
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(THEME_KEY);
  await resetMedia();
});

function renderAppearance(languages = ["fr"]) {
  return render(
    <I18nProvider languages={languages}>
      <AppearanceSection />
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof renderAppearance>>;

const skins = (screen: Screen) => screen.getByRole("radiogroup", { name: fr.settings.skin });
const modes = (screen: Screen) => screen.getByRole("group", { name: fr.settings.appearance });
const example = SKINS.find((skin) => skin.id === "_example");

/** A colour as the browser paints it (`rgb(…)`). */
function painted(hex: string): string {
  const span = document.createElement("span");
  span.style.backgroundColor = hex;
  document.body.append(span);
  const colour = getComputedStyle(span).backgroundColor;
  span.remove();
  return colour;
}

/** The ground of the page, as painted. */
const sheet = () => getComputedStyle(document.body).backgroundColor;
const crete = SKINS.find((skin) => skin.id === "crete");

test("Thème — une carte par skin, Crête d'abord et cochée, avant Auto / Clair / Sombre", async () => {
  const screen = await renderAppearance();

  const group = skins(screen);
  await expect.element(group).toBeVisible();
  const radios = group.getByRole("radio");
  expect(radios.elements()).toHaveLength(SKINS.length);
  // Each card is named by the skin, in the language of the page.
  for (const skin of SKINS) {
    await expect
      .element(group.getByRole("radio", { name: skin.label.fr, exact: true }))
      .toBeVisible();
  }
  await expect
    .element(group.getByRole("radio", { name: crete?.label.fr, exact: true }))
    .toBeChecked();
  // A tap target of 44 px at least.
  for (const radio of radios.elements()) {
    expect(radio.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // « Thème » first, then the modes.
  const order = group.element().compareDocumentPosition(modes(screen).element());
  expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Thème — chaque carte montre les deux couleurs du skin et un échantillon de sa police", async () => {
  const screen = await renderAppearance();
  await fontsReady();

  for (const skin of SKINS) {
    const card = skins(screen)
      .getByRole("radio", { name: skin.label.fr, exact: true })
      .element()
      .closest("label");
    if (card === null) throw new Error(`the card of ${skin.id}`);
    const swatches = [...card.querySelectorAll("[data-swatch]")].map(
      (swatch) => getComputedStyle(swatch).backgroundColor,
    );
    expect(swatches, `the colours of ${skin.id}`).toEqual(skin.swatches.map(painted));
    // Its font, once loaded: Crête's titles are on the page, the example's is a font of the system.
    const sample = card.querySelector("[data-font-sample]");
    expect(sample, `the sample of ${skin.id}`).not.toBeNull();
    expect(sample?.getAttribute("aria-hidden"), `the sample of ${skin.id}`).toBe("true");
    expect(document.fonts.check(`1em ${skin.fontSample}`), `the font of ${skin.id}`).toBe(true);
    const probeFont = document.createElement("span");
    probeFont.style.fontFamily = skin.fontSample;
    document.body.append(probeFont);
    const expected = getComputedStyle(probeFont).fontFamily;
    probeFont.remove();
    expect(getComputedStyle(sample ?? document.body).fontFamily, `the font of ${skin.id}`).toBe(
      expected,
    );
  }
});

test("Thème — choisir un skin l'applique à la page tout de suite et le garde sur l'appareil", async () => {
  expect(example, "the example skin of development").toBeDefined();
  const screen = await renderAppearance();
  const day = sheet();

  await skins(screen).getByRole("radio", { name: example?.label.fr, exact: true }).click();
  await expect
    .element(skins(screen).getByRole("radio", { name: example?.label.fr, exact: true }))
    .toBeChecked();
  expect(document.documentElement.dataset.skin).toBe("_example");
  expect(localStorage.getItem(SKIN_KEY)).toBe("_example");
  // Its stylesheet paints the page: the sheet of the page is its own.
  expect(sheet()).not.toBe(day);
  expect(
    getComputedStyle(document.documentElement).getPropertyValue("--color-neutral-50").trim(),
  ).toBe("#f4f7f2");

  // Back to Crête: nothing on the page, nothing kept.
  await skins(screen).getByRole("radio", { name: crete?.label.fr, exact: true }).click();
  expect(document.documentElement.dataset.skin).toBeUndefined();
  expect(localStorage.getItem(SKIN_KEY)).toBeNull();
  expect(sheet()).toBe(day);
});

test("Thème — Auto / Clair / Sombre seulement pour un skin qui a les deux modes ; sinon une phrase le dit", async () => {
  const screen = await renderAppearance();
  await expect.element(modes(screen)).toBeVisible();
  await expect.element(screen.getByText(fr.settings.onlyLight)).not.toBeInTheDocument();

  // « Sombre » chosen, then a skin with a light mode only.
  await modes(screen).getByRole("radio", { name: fr.settings.themeDark }).click();
  expect(document.documentElement.dataset.theme).toBe("dark");
  await skins(screen).getByRole("radio", { name: example?.label.fr, exact: true }).click();
  await expect.element(screen.getByText(fr.settings.onlyLight)).toBeVisible();
  await expect.element(modes(screen)).not.toBeInTheDocument();
  // The page is drawn in it; the choice of the device is kept for later.
  expect(document.documentElement.dataset.theme).toBe("light");
  expect(getComputedStyle(document.documentElement).colorScheme).toBe("light");
  expect(localStorage.getItem(THEME_KEY)).toBe("dark");

  // Back to Crête: the modes, and « Sombre » as it was.
  await skins(screen).getByRole("radio", { name: crete?.label.fr, exact: true }).click();
  await expect
    .element(modes(screen).getByRole("radio", { name: fr.settings.themeDark }))
    .toBeChecked();
  expect(document.documentElement.dataset.theme).toBe("dark");
});

test("Thème — le skin gardé sur l'appareil est coché en arrivant, et les noms sont dans la langue de la page", async () => {
  localStorage.setItem(SKIN_KEY, "_example");
  const screen = await renderAppearance(["en"]);
  const group = screen.getByRole("radiogroup", { name: en.settings.skin });
  await expect
    .element(group.getByRole("radio", { name: example?.label.en, exact: true }))
    .toBeChecked();
  await expect.element(screen.getByText(en.settings.onlyLight)).toBeVisible();
});

test("Thème — au clavier, les flèches passent d'un skin à l'autre", async () => {
  const screen = await renderAppearance();
  const first = skins(screen).getByRole("radio", { name: crete?.label.fr, exact: true });
  first.element().focus();
  await userEvent.keyboard("{ArrowDown}");
  const second = SKINS[1];
  await expect
    .element(skins(screen).getByRole("radio", { name: second?.label.fr, exact: true }))
    .toBeChecked();
  expect(document.documentElement.dataset.skin).toBe(second?.id);
  // The ring of the focus is drawn around the card.
  expect(getComputedStyle(document.activeElement ?? document.body).outlineStyle).not.toBe("none");
});

test("Thème — en couleurs forcées, la carte cochée se voit encore", async () => {
  await emulateMedia({ forcedColors: "active" });
  const screen = await renderAppearance();
  const group = skins(screen);
  await expect
    .element(group.getByRole("radio", { name: crete?.label.fr, exact: true }))
    .toBeChecked();
  const dots = [...group.element().querySelectorAll("[data-dot]")].map((dot) => {
    const style = getComputedStyle(dot);
    return !/^0(s|$)/.test(style.scale);
  });
  expect(dots).toEqual(SKINS.map((skin) => skin.id === "crete"));
});
