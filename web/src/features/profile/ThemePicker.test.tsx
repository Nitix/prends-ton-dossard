import interUrl from "@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEME_KEY, chooseTheme } from "../../lib/theme";
import { SKIN_KEY, SKINS, applySkin, chooseSkin, readSkin } from "../../skins";
import type { Skin } from "../../skins/types";
import { fontsReady } from "../../test/fontsReady";
import { emulateMedia, resetMedia } from "../../test/media";
import { AppearanceSection } from "./AppearanceSection";

import "../../styles.css";

// « Thème » in « Apparence », on the settings page: the skins of the app as
// cards (a name, two colours, a sample of its font), then « Clair ou sombre »
// for a skin that has both modes. The tests of the modes themselves are those
// of SettingsPage.test.tsx. Nothing here names a skin but Crête: the others are
// taken from the registry, so that a skin added later is tested as it is.

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
const modes = (screen: Screen) => screen.getByRole("group", { name: fr.settings.mode });
/** A value the test needs, or a failure that says which. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`no ${what}`);
  return value;
}

const crete = must(
  SKINS.find((skin) => skin.id === "crete"),
  "Crête",
);
/** Another skin than Crête. */
const other = SKINS.find((skin) => skin.id !== "crete");
/** A skin that has one mode only. */
const singleMode = SKINS.find((skin) => skin.modes.length === 1);
/** What the settings say of a skin that has one mode only. */
const onlyOne = (skin: Skin | undefined, texts = fr) =>
  skin?.modes[0] === "dark" ? texts.settings.onlyDark : texts.settings.onlyLight;

/** A colour as the browser paints it (`rgb(…)`). */
function painted(hex: string): string {
  const span = document.createElement("span");
  span.style.backgroundColor = hex;
  document.body.append(span);
  const colour = getComputedStyle(span).backgroundColor;
  span.remove();
  return colour;
}

/** A `font-family` as the browser computes it. */
function computedFamily(family: string): string {
  const span = document.createElement("span");
  span.style.fontFamily = family;
  document.body.append(span);
  const computed = getComputedStyle(span).fontFamily;
  span.remove();
  return computed;
}

/** The card of a skin in the picker. */
function cardOf(screen: Screen, skin: Skin): HTMLElement {
  const card = skins(screen)
    .getByRole("radio", { name: skin.label.fr, exact: true })
    .element()
    .closest("label");
  if (card === null) throw new Error(`the card of ${skin.id}`);
  return card;
}

/** The sample « Aa » of a card. */
function sampleOf(card: HTMLElement): HTMLElement {
  const sample = card.querySelector<HTMLElement>("[data-font-sample]");
  if (sample === null) throw new Error("a card without its sample");
  return sample;
}

/** The ground of the page, as painted. */
const sheet = () => getComputedStyle(document.body).backgroundColor;

test("Thème — une carte par skin, Crête d'abord et cochée, avant « Clair ou sombre »", async () => {
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
    .element(group.getByRole("radio", { name: crete.label.fr, exact: true }))
    .toBeChecked();
  // A tap target of 44 px at least.
  for (const radio of radios.elements()) {
    expect(radio.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }
  // « Thème » first, then the modes, named for what they are beside it.
  await expect.element(screen.getByText(fr.settings.mode, { exact: true })).toBeVisible();
  const order = group.element().compareDocumentPosition(modes(screen).element());
  expect(order & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

test("Thème — chaque carte montre les deux couleurs du skin, et son échantillon est dans sa police si et seulement si elle est chargée", async () => {
  const screen = await renderAppearance();
  await fontsReady();

  for (const skin of SKINS) {
    const card = cardOf(screen, skin);
    const swatches = [...card.querySelectorAll("[data-swatch]")].map(
      (swatch) => getComputedStyle(swatch).backgroundColor,
    );
    expect(swatches, `the colours of ${skin.id}`).toEqual(skin.swatches.map(painted));
    const sample = sampleOf(card);
    expect(sample.getAttribute("aria-hidden"), `the sample of ${skin.id}`).toBe("true");
    const loaded = document.fonts.check(`700 1em ${skin.fontSample}`);
    expect(sample.style.fontFamily !== "", `the font of ${skin.id} (loaded: ${loaded})`).toBe(
      loaded,
    );
    // Its family when loaded, else the one of the card (the app's).
    expect(getComputedStyle(sample).fontFamily, `the font of ${skin.id}`).toBe(
      loaded ? computedFamily(skin.fontSample) : getComputedStyle(card).fontFamily,
    );
  }
  // Crête's font is on the page (its titles): its card shows it.
  expect(sampleOf(cardOf(screen, crete)).style.fontFamily).not.toBe("");
});

/** The first family of a `font-family` list, without its quotes. */
const firstFamily = (list: string) =>
  list
    .split(",")[0]
    ?.trim()
    .replace(/^["']|["']$/g, "") ?? "";

test("Thème — une police déclarée mais pas encore chargée : l'échantillon attend, puis la prend dès qu'elle l'est", async () => {
  // A skin whose font no face of the page declares yet (a font of the system, or one of its own).
  const skin = SKINS.find(
    (one) => ![...document.fonts].some((face) => face.family === firstFamily(one.fontSample)),
  );
  expect(skin, "a skin whose font is not on the page").toBeDefined();
  if (skin === undefined) return;
  // Its font, declared and not loaded: as when its skin's stylesheet has a face that nothing used yet.
  const face = new FontFace(firstFamily(skin.fontSample), `url(${interUrl})`, {
    weight: "100 900",
  });
  document.fonts.add(face);
  try {
    expect(face.status).toBe("unloaded");
    const screen = await renderAppearance();
    const sample = sampleOf(cardOf(screen, skin));
    expect(document.fonts.check(`700 1em ${skin.fontSample}`)).toBe(false);
    // Not loaded: the app's font, and the picker does not load it to show it.
    expect(sample.style.fontFamily).toBe("");
    expect(face.status).toBe("unloaded");

    // Loaded (the skin was chosen elsewhere): the sample takes it.
    await face.load();
    await expect.poll(() => sample.style.fontFamily).not.toBe("");
    expect(getComputedStyle(sample).fontFamily).toBe(computedFamily(skin.fontSample));
  } finally {
    document.fonts.delete(face);
  }
});

test("Thème — choisir un skin l'applique à la page tout de suite et le garde sur l'appareil", async () => {
  expect(other, "a skin other than Crête").toBeDefined();
  // The colour of the bar of the browser, as index.html has it.
  const bar = document.createElement("meta");
  bar.name = "theme-color";
  bar.content = crete.themeColor;
  document.head.append(bar);
  try {
    const screen = await renderAppearance();
    const root = document.documentElement;
    const day = sheet();

    await skins(screen).getByRole("radio", { name: other?.label.fr, exact: true }).click();
    await expect
      .element(skins(screen).getByRole("radio", { name: other?.label.fr, exact: true }))
      .toBeChecked();
    expect(root.dataset.skin).toBe(other?.id);
    expect(localStorage.getItem(SKIN_KEY)).toBe(other?.id);
    // Its stylesheet paints the page: the sheet is the colour that the skin gives `neutral-50`.
    expect(sheet()).toBe(painted(getComputedStyle(root).getPropertyValue("--color-neutral-50")));
    // And the bar of the browser takes its colour.
    expect(bar.content).toBe(other?.themeColor);

    // Back to Crête: nothing on the page, nothing kept, its violet on the bar.
    await skins(screen).getByRole("radio", { name: crete.label.fr, exact: true }).click();
    expect(root.dataset.skin).toBeUndefined();
    expect(localStorage.getItem(SKIN_KEY)).toBeNull();
    expect(sheet()).toBe(day);
    expect(bar.content).toBe(crete.themeColor);
  } finally {
    bar.remove();
  }
});

test("Thème — « Clair ou sombre » seulement pour un skin qui a les deux modes ; sinon une phrase le dit", async () => {
  expect(singleMode, "a skin with one mode only").toBeDefined();
  const only = singleMode?.modes[0] ?? "light";
  const otherMode = only === "light" ? "dark" : "light";
  const screen = await renderAppearance();
  await expect.element(modes(screen)).toBeVisible();
  await expect.element(screen.getByText(onlyOne(singleMode))).not.toBeInTheDocument();

  // The other mode chosen, then a skin that has one mode only.
  await modes(screen)
    .getByRole("radio", {
      name: otherMode === "dark" ? fr.settings.themeDark : fr.settings.themeLight,
    })
    .click();
  expect(document.documentElement.dataset.theme).toBe(otherMode);
  await skins(screen).getByRole("radio", { name: singleMode?.label.fr, exact: true }).click();
  await expect.element(screen.getByText(onlyOne(singleMode))).toBeVisible();
  await expect.element(modes(screen)).not.toBeInTheDocument();
  // The page is drawn in its mode; the choice of the device is kept for later.
  expect(document.documentElement.dataset.theme).toBe(only);
  expect(getComputedStyle(document.documentElement).colorScheme).toBe(only);
  expect(localStorage.getItem(THEME_KEY)).toBe(otherMode);

  // Back to Crête: the modes, and the choice as it was.
  await skins(screen).getByRole("radio", { name: crete.label.fr, exact: true }).click();
  await expect
    .element(
      modes(screen).getByRole("radio", {
        name: otherMode === "dark" ? fr.settings.themeDark : fr.settings.themeLight,
      }),
    )
    .toBeChecked();
  expect(document.documentElement.dataset.theme).toBe(otherMode);
});

test("Thème — le skin gardé sur l'appareil est coché en arrivant, et les noms sont dans la langue de la page", async () => {
  localStorage.setItem(SKIN_KEY, singleMode?.id ?? "");
  // What main.tsx does at start.
  applySkin(readSkin());
  const screen = await renderAppearance(["en"]);
  const group = screen.getByRole("radiogroup", { name: en.settings.skin });
  await expect
    .element(group.getByRole("radio", { name: singleMode?.label.en, exact: true }))
    .toBeChecked();
  await expect.element(screen.getByText(onlyOne(singleMode, en))).toBeVisible();
});

test("Thème — au clavier, les flèches passent d'un skin à l'autre", async () => {
  const screen = await renderAppearance();
  const first = skins(screen).getByRole("radio", { name: crete.label.fr, exact: true });
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
    .element(group.getByRole("radio", { name: crete.label.fr, exact: true }))
    .toBeChecked();
  const dots = [...group.element().querySelectorAll("[data-dot]")].map((dot) => {
    const style = getComputedStyle(dot);
    return !/^0(s|$)/.test(style.scale);
  });
  expect(dots).toEqual(SKINS.map((skin) => skin.id === "crete"));
});
