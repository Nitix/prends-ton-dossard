import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { THEME_KEY, chooseTheme } from "../../lib/theme";
import { SKIN_KEY, SKINS, chooseSkin, showKeptSkin } from "../../skins";
import type { Skin } from "../../skins/types";
import { contrast } from "../../test/colour";
import { shadowLayers } from "../../test/computed";
import { emulateMedia, resetMedia } from "../../test/media";

import "../../styles.css";

// « Thème » in « Apparence », on the settings page: the skins of the app as
// cards (a name, two colours, a sample of its font), then « Clair ou sombre »
// for a skin that has both modes. The tests of the modes themselves are those
// of SettingsPage.test.tsx. Nothing here names a skin but Crête: the others are
// taken from the registry, so that a skin added later is tested as it is.
// The module of the section is imported by the tests, not by this file: what
// the page has before it (`AT_START`) is the page of the other pages.

/** The families that the faces of the page declare, and the font files it has asked for. */
const fontsOfPage = () => ({
  families: [...new Set([...document.fonts].map((face) => face.family.replaceAll('"', "")))],
  files: performance
    .getEntriesByType("resource")
    .map((entry) => entry.name)
    .filter((name) => name.endsWith(".woff2")),
});

/** The fonts of the page as this file found it, before the module of the section and before any test. */
const AT_START = fontsOfPage();

/** The module of the section « Apparence », with the faces of its samples. */
const section = () => import("./AppearanceSection");

afterEach(async () => {
  // The skin and the theme belong to the page and to the device: a test leaves neither to the next.
  await chooseSkin("crete");
  chooseTheme("auto");
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(THEME_KEY);
  await resetMedia();
});

async function renderAppearance(languages = ["fr"]) {
  const { AppearanceSection } = await section();
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

/** Whether a `unicode-range` (`U+0000-00FF, U+0131`) holds a character. */
function covers(range: string, char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return range.split(",").some((part) => {
    const [from = "", to = from] = part.trim().replace(/^U\+/i, "").split("-");
    if (from.includes("?")) {
      return (
        Number.parseInt(from.replaceAll("?", "0"), 16) <= code &&
        code <= Number.parseInt(from.replaceAll("?", "F"), 16)
      );
    }
    return Number.parseInt(from, 16) <= code && code <= Number.parseInt(to, 16);
  });
}

/** The families of a `font-family` that are named in quotes: those the page declares. */
const familiesOf = (stack: string) =>
  [...stack.matchAll(/"([^"]+)"/g)].map(([, family = ""]) => family);

/** The faces of the page of a family that draw the letters of « Aa ». */
const letterFaces = (family: string) =>
  [...document.fonts].filter(
    (face) => face.family.replaceAll('"', "") === family && covers(face.unicodeRange, "A"),
  );

/** The family that draws the sample « Aa » of a skin: the first of its stack that the page has for the letters. */
const sampleFamily = (skin: Skin) =>
  familiesOf(skin.fontSample).find((family) => letterFaces(family).length > 0);

/** The families of Crête, which every page has (styles.css). */
const CRETE_FAMILIES = ["Inter Variable", "Plus Jakarta Sans Variable"];

test("Thème — les polices des échantillons viennent avec la section : la page n'en a ni déclaré ni demandé aucune avant", async () => {
  // The families that draw the samples, but Crête's, which every page has.
  const titles = new Set(SKINS.flatMap((skin) => familiesOf(skin.fontSample)));
  for (const family of CRETE_FAMILIES) titles.delete(family);
  // Before the module of the section: none declared, no file but Crête's asked for.
  expect(AT_START.families.filter((family) => titles.has(family))).toEqual([]);
  expect(AT_START.files.filter((file) => !/\/(inter|plus-jakarta-sans)-latin/.test(file))).toEqual(
    [],
  );
  // With it, the faces of the samples are there.
  await section();
  const declared = fontsOfPage().families.filter((family) => titles.has(family));
  expect(declared.length, "the families of the samples, with the section").toBeGreaterThan(5);
});

test("Thème — chaque carte montre les deux couleurs du skin, et son échantillon dans la police des titres du skin, chargée avec la section", async () => {
  const screen = await renderAppearance();
  for (const skin of SKINS) {
    const card = cardOf(screen, skin);
    const swatches = [...card.querySelectorAll("[data-swatch]")].map(
      (swatch) => getComputedStyle(swatch).backgroundColor,
    );
    expect(swatches, `the colours of ${skin.id}`).toEqual(skin.swatches.map(painted));
    const sample = sampleOf(card);
    expect(sample.getAttribute("aria-hidden"), `the sample of ${skin.id}`).toBe("true");
    // Its stack is the one of the skin's titles, whether the skin is worn or not…
    expect(getComputedStyle(sample).fontFamily, `the font of ${skin.id}`).toBe(
      computedFamily(skin.fontSample),
    );
    // … and the page has a face of it for the letters, which the sample loads.
    const family = sampleFamily(skin);
    expect(family, `a face of the font of ${skin.id} for « Aa »`).toBeDefined();
    await expect
      .poll(() => letterFaces(family ?? "").some((face) => face.status === "loaded"), {
        timeout: 5000,
      })
      .toBe(true);
  }
  // Not an empty search: the samples are in other faces than Crête's.
  const families = new Set(SKINS.map(sampleFamily));
  expect(families.size).toBeGreaterThan(5);
});

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

/** A colour as `getComputedStyle` gives it (`rgb(r, g, b)`), as `#rrggbb`. */
function hexOf(rgb: string): string {
  const channels = /^rgba?\((\d+), (\d+), (\d+)(?:, ([\d.]+))?\)$/.exec(rgb);
  if (channels === null || (channels[4] !== undefined && Number(channels[4]) !== 1)) {
    throw new Error(`not an opaque rgb() colour: ${rgb}`);
  }
  return `#${channels
    .slice(1, 4)
    .map((value) => Number(value).toString(16).padStart(2, "0"))
    .join("")}`;
}

test("Thème — chaque pastille a un bord qui se voit sur sa carte, cochée ou non, claire ou sombre : 3:1, dans chaque skin et chaque mode", async () => {
  // A dark swatch on a dark card (or a light one on a light card) would be
  // only the other one of its pair: its edge, a ring inside it, says where it
  // is, whatever its colour (WCAG 1.4.11, 3:1 against the ground of its card).
  for (const skin of SKINS) {
    for (const mode of skin.modes) {
      await chooseSkin(skin.id);
      chooseTheme(mode);
      for (const checked of [false, true]) {
        const { SkinCard } = await section();
        const screen = await render(
          <I18nProvider languages={["fr"]}>
            <SkinCard skin={crete} name="Crête" sample="Aa" checked={checked} onChoose={() => {}} />
          </I18nProvider>,
        );
        const card = screen.container.querySelector("label");
        const ground = hexOf(getComputedStyle(card ?? document.body).backgroundColor);
        const swatches = [...screen.container.querySelectorAll("[data-swatch]")];
        expect(swatches).toHaveLength(2);
        for (const swatch of swatches) {
          const edge = shadowLayers(getComputedStyle(swatch).boxShadow).find((layer) =>
            layer.endsWith(" inset"),
          );
          const what = `${skin.id}, ${mode}, ${checked ? "chosen" : "not chosen"}: the edge of a swatch`;
          expect(edge, `${what}: a ring inside it`).toBeDefined();
          const colour = hexOf(/^rgba?\([^)]*\)/.exec(edge ?? "")?.[0] ?? "");
          expect(
            contrast(colour, ground),
            `${what} (${colour} on ${ground})`,
          ).toBeGreaterThanOrEqual(3);
        }
        await screen.unmount();
      }
    }
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
    await expect
      .element(skins(screen).getByRole("radio", { name: crete.label.fr, exact: true }))
      .toBeChecked();
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
  await showKeptSkin();
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
