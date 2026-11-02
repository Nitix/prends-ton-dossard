import { useEffect, useRef } from "react";
import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin } from ".";
import { ON_DAWN } from "../components/buttons";
import { CountdownRing } from "../components/Dawn";
import { Dialog } from "../components/Dialog";
import { ToastProvider, useToast } from "../components/Toast";
import { toTrack } from "../features/route/gpx";
import TrackMap from "../features/route/TrackMap";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { EMPTY_LAYER, colourOf, ownDeclaration } from "../test/computed";
import { BLANK_TILE } from "../test/tiles";
import { MotifDefs } from "./crete/Alpenglow";
import { BrandMark } from "./crete/Brand";
import { EmptyArt } from "./crete/EmptyArt";
import { HeaderArt } from "./crete/HeaderArt";
import { HeroArt } from "./crete/HeroArt";
import { RidgeDivider } from "./crete/RidgeDivider";

import "../styles.css";
import "../skins/styles";

// What a palette skin changes without drawing anything: the colours that the
// pieces of the app read from the custom properties of the theme. Crête's
// motifs (they stand in for those a skin does not draw) and the map of a track
// are painted with `--motif-*` and `--map-*`, never with a colour written in
// them (an attribute, a style, a class): in every skin, each colour they show
// is the one the skin gives the property. So are the shade of a window
// (`--shade-dialog`), of a message and of the pieces on the sky of a hero, and
// the style of the titles (`--display-*`). These pieces are measured at every
// depth: a rule of mix or full on them reads the property (README.md).
// Nothing here names a skin.

afterEach(() => {
  chooseSkin("crete");
});

/** The custom property that an inline style of an element reads for `property`, if any. */
function tokenOf(element: Element, property: string): string | undefined {
  const value =
    element instanceof SVGElement || element instanceof HTMLElement
      ? element.style.getPropertyValue(property)
      : "";
  return /^var\((--[a-z0-9-]+)\)$/.exec(value.trim())?.[1];
}

/** Colours an SVG may still write out: none, white (the trails, the map of the sky), the colour of the text, a gradient. */
const WRITABLE = /^(none|#fff|#ffffff|white|currentColor|url\(#[^)]+\))$/i;

/**
 * A colour written out: `#…`, `rgb(…)` and the other functions of colour, in a
 * style or in a class, where `_` stands for a space (`…_rgb(36_27_53/0.45)]`).
 */
const COLOUR_LITERAL =
  /#[0-9a-f]{3,8}(?![0-9a-z])|(?<![a-z-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(/i;

/**
 * A shadow (or a drop shadow) is drawn in the colour of a property of the
 * theme. The property is one of Crête's (a name the test had wrong would read
 * as `transparent`). Crête declares every one, so whether a skin sets it is for
 * the skin's own sheet to say (`ownDeclaration`), where the skin must.
 */
function expectShadowOf(shadow: string, property: string, what: string) {
  expect(ownDeclaration("crete", property), `${property} is one of Crête's`).not.toBe("");
  expect(shadow.replaceAll(EMPTY_LAYER, ""), `${what}: its shade`).toContain(colourOf(property));
}

/**
 * The arbitrary values in the classes of an element (`shadow-[…]`,
 * `drop-shadow-[…]`, `fill-[…]`), but those of a mask: its colours are only an
 * alpha (`mask-[linear-gradient(…,#000_85%)]`), never seen.
 */
function arbitraryValues(element: Element): string[] {
  return (element.getAttribute("class") ?? "")
    .split(/\s+/)
    .filter((name) => !/^(?:[a-z-]+:)*mask-\[/.test(name))
    .flatMap((name) => name.match(/\[[^\]]*\]/g) ?? []);
}

test("tokens — les motifs de Crête prennent leurs couleurs des propriétés --motif-*, dans chaque skin", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    // The boxes are sized inline: a class named only in a test is not in the CSS.
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <MotifDefs />
        <div className="relative" style={{ height: 160 }}>
          <HeaderArt place="header" sun />
        </div>
        <div className="relative" style={{ height: 320 }}>
          <HeaderArt place="welcome" />
        </div>
        <div className="relative" style={{ height: 160 }}>
          <HeroArt place="event" />
        </div>
        <BrandMark />
        <div className="relative">
          <EmptyArt />
        </div>
        <div data-testid="divider">
          <RidgeDivider />
        </div>
      </I18nProvider>,
    );
    const root = screen.container;
    // Not an empty search: the stops of the ridges, the sun, its halo, the mark, the empty list.
    const stops = [...root.querySelectorAll("stop")];
    expect(stops.length, `${skin.id}: the stops of the motifs`).toBeGreaterThan(15);
    for (const stop of stops) {
      expect(stop.getAttribute("stop-color"), `${skin.id}: a stop written out`).toBeNull();
      const token = tokenOf(stop, "stop-color");
      expect(token, `${skin.id}: a stop that reads no property`).toMatch(/^--motif-/);
      expect(getComputedStyle(stop).stopColor, `${skin.id}: ${token}`).toBe(colourOf(token ?? ""));
    }
    // What is filled or stroked: a gradient, white, or a property of the theme.
    for (const element of root.querySelectorAll("[fill], [stroke]")) {
      for (const attribute of ["fill", "stroke"]) {
        const value = element.getAttribute(attribute);
        if (value === null) continue;
        expect(value, `${skin.id}: <${element.tagName} ${attribute}="${value}">`).toMatch(WRITABLE);
      }
    }
    // Nor in a style or in a class: a fill, a shadow, a drop shadow.
    for (const element of root.querySelectorAll("*")) {
      const style = element.getAttribute("style") ?? "";
      expect(style, `${skin.id}: <${element.tagName} style="${style}">`).not.toMatch(
        COLOUR_LITERAL,
      );
      for (const value of arbitraryValues(element)) {
        expect(value, `${skin.id}: <${element.tagName} class="…${value}…">`).not.toMatch(
          COLOUR_LITERAL,
        );
      }
    }
    // The band under the ridges, behind the sheet of the page.
    const band = [...root.querySelectorAll<HTMLElement>("span[style]")].find((span) =>
      span.style.backgroundColor.startsWith("var("),
    );
    expect(band, `${skin.id}: the band under the ridges`).toBeDefined();
    expect(getComputedStyle(band ?? root).backgroundColor).toBe(colourOf("--motif-ridge-near-to"));
    // The shadows of the mark: under its tile, behind the name of the app.
    const name = screen.getByText(fr.common.appName).element();
    const tile = name.previousElementSibling ?? root;
    expectShadowOf(
      getComputedStyle(tile).boxShadow,
      "--motif-mark-shade",
      `${skin.id}: the tile of the mark`,
    );
    expectShadowOf(
      getComputedStyle(name).filter,
      "--motif-name-shade",
      `${skin.id}: the name of the app`,
    );
    // The glow of the sun on the divider.
    const sun = [...screen.getByTestId("divider").element().querySelectorAll("span")].find(
      (span) => getComputedStyle(span).boxShadow !== "none",
    );
    expect(sun, `${skin.id}: the sun of the divider`).toBeDefined();
    expectShadowOf(
      getComputedStyle(sun ?? root).boxShadow,
      "--motif-sun-glow",
      `${skin.id}: the sun of the divider`,
    );
    await screen.unmount();
  }
});

test("tokens — la fenêtre d'un dialogue a l'ombre --shade-dialog, dans chaque skin", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <Dialog open title="Une fenêtre" onClose={() => {}}>
          <p>Son contenu</p>
        </Dialog>
      </I18nProvider>,
    );
    const dialog = screen.getByRole("dialog", { name: "Une fenêtre" });
    await expect.element(dialog).toBeVisible();
    expectShadowOf(
      getComputedStyle(dialog.element()).boxShadow,
      "--shade-dialog",
      `the dialog in ${skin.id}`,
    );
    await screen.unmount();
  }
});

/** A message shown as soon as it is drawn. */
function Toaster({ message }: { message: string }) {
  const toasts = useToast();
  const shown = useRef(false);
  useEffect(() => {
    // Once, as the page would after an action.
    if (shown.current) return;
    shown.current = true;
    toasts.show(message);
  }, [toasts, message]);
  return null;
}

/** A colour as the browser computes it for the fill of an SVG, from a CSS value. */
function fillOf(value: string): string {
  const probe = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  probe.style.fill = value;
  svg.append(probe);
  document.body.append(svg);
  const fill = getComputedStyle(probe).fill;
  svg.remove();
  return fill;
}

test("tokens — les ombres et les voiles des pièces sur le ciel et des messages prennent leurs couleurs des propriétés du thème, dans chaque skin", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ToastProvider>
          <Toaster message="Enregistré" />
        </ToastProvider>
        <div className="on-dawn">
          <a href="#inscription" className={ON_DAWN}>
            S'inscrire
          </a>
          <CountdownRing days={9} tone="light" />
        </div>
      </I18nProvider>,
    );
    // The pill of a message (a toast).
    const toast = screen.getByText("Enregistré");
    await expect.element(toast).toBeVisible();
    expectShadowOf(
      getComputedStyle(toast.element()).boxShadow,
      "--shade-toast",
      `${skin.id}: a toast`,
    );
    // The white pill on a hero (« S'inscrire »).
    expectShadowOf(
      getComputedStyle(screen.getByRole("link", { name: "S'inscrire" }).element()).boxShadow,
      "--shade-on-dawn",
      `${skin.id}: the white pill on the sky`,
    );
    // The veil inside the ring of the days left on a hero: the veil of a hero, a little lighter.
    const track = screen.container.querySelector(".on-dawn svg circle");
    expect(track, `${skin.id}: the ring of the days left`).not.toBeNull();
    expect(ownDeclaration("crete", "--hero-veil"), "--hero-veil is one of Crête's").not.toBe("");
    expect(getComputedStyle(track ?? screen.container).fill, `${skin.id}: its veil`).toBe(
      fillOf("color-mix(in srgb, var(--hero-veil) 90%, transparent)"),
    );
    await screen.unmount();
  }
});

/** The style of the display face that the titles take from the theme. */
const DISPLAY = [
  "--display-style",
  "--display-transform",
  "--display-stretch",
  "--display-tracking",
];

/**
 * The titles of the app, with the letter-spacing each has from `--display-tracking`:
 * the title of a page (and of a hero, of a window) has it as it is, the title of a
 * block or of a card 0.01em more.
 */
const TITLES = [
  {
    what: "the title of a page",
    element: "h1",
    className: "page-title",
    tracking: "var(--display-tracking)",
  },
  {
    what: "the title of a block",
    element: "h2",
    className: "block-title",
    tracking: "calc(var(--display-tracking) + 0.01em)",
  },
  {
    what: "the title of a card",
    element: "h3",
    className: "card-title",
    tracking: "calc(var(--display-tracking) + 0.01em)",
  },
  {
    what: "the title of a hero or a window",
    element: "h2",
    className: "display-title font-display text-xl",
    tracking: "var(--display-tracking)",
  },
] as const;

/** Each title is drawn in the style that the properties give, here and now. */
async function expectDisplayStyle(label: string) {
  const screen = await render(
    <div>
      {TITLES.map(({ element: Title, className, what }) => (
        <Title key={what} className={className}>
          {what}
        </Title>
      ))}
    </div>,
  );
  for (const { what, tracking } of TITLES) {
    const title = screen.getByText(what).element();
    // A probe in the title (its size, so its `em`) with the properties as they are.
    const probe = document.createElement("span");
    probe.style.cssText = `font-style: var(--display-style); text-transform: var(--display-transform); font-stretch: var(--display-stretch); letter-spacing: ${tracking}`;
    title.append(probe);
    const [own, expected] = [getComputedStyle(title), getComputedStyle(probe)];
    for (const property of [
      "fontStyle",
      "textTransform",
      "fontStretch",
      "letterSpacing",
    ] as const) {
      expect(own[property], `${label}: ${what}, its ${property}`).toBe(expected[property]);
    }
    probe.remove();
  }
  await screen.unmount();
}

test("tokens — les titres prennent le style de la police des titres (--display-*), dans chaque skin", async () => {
  for (const property of DISPLAY) {
    expect(ownDeclaration("crete", property), `${property} is one of Crête's`).not.toBe("");
  }
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    await expectDisplayStyle(skin.id);
  }
  // Values that a skin may give (italic capitals, a wider face, more space):
  // the titles follow them, not only the values that are Crête's.
  chooseSkin("crete");
  const root = document.documentElement.style;
  const given = {
    "--display-style": "italic",
    "--display-transform": "uppercase",
    "--display-stretch": "125%",
    "--display-tracking": "0.04em",
  };
  try {
    for (const [property, value] of Object.entries(given)) root.setProperty(property, value);
    const screen = await render(
      <h1 className="page-title" data-testid="title">
        Accueil
      </h1>,
    );
    const title = getComputedStyle(screen.getByTestId("title").element());
    expect([title.fontStyle, title.textTransform, title.fontStretch]).toEqual([
      "italic",
      "uppercase",
      "125%",
    ]);
    expect(Number.parseFloat(title.letterSpacing)).toBeCloseTo(
      0.04 * Number.parseFloat(title.fontSize),
      2,
    );
    await screen.unmount();
    await expectDisplayStyle("italic, capitals, wide");
  } finally {
    for (const property of Object.keys(given)) root.removeProperty(property);
  }
});

const TRACK = toTrack([
  { lat: 45, lon: 6 },
  { lat: 45.01, lon: 6.01 },
  { lat: 45.02, lon: 6 },
]);

test("tokens — la carte d'une trace prend ses couleurs des propriétés --map-*, dans chaque skin", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <TrackMap points={TRACK} tileUrl={BLANK_TILE} />
      </I18nProvider>,
    );
    await expect.element(screen.getByRole("region", { name: fr.route.map })).toBeVisible();
    const root = screen.container;
    const part = (selector: string) => {
      const found = root.querySelector(selector);
      if (found === null) throw new Error(`${skin.id}: no ${selector}`);
      return found;
    };
    // The gradient of the line, and its colour where a gradient cannot be drawn.
    const stops = [...root.querySelectorAll("linearGradient stop")];
    expect(
      stops.map((stop) => getComputedStyle(stop).stopColor),
      `the gradient in ${skin.id}`,
    ).toEqual(["--map-line-from", "--map-line-via", "--map-line-to"].map(colourOf));
    expect(getComputedStyle(part("path.track-line")).stroke, `the line in ${skin.id}`).toMatch(
      new RegExp(`\\) ${colourOf("--map-line").replace(/[()]/g, "\\$&")}$`),
    );
    // The start and the finish.
    expect(getComputedStyle(part("path.track-start")).fill, `a dot in ${skin.id}`).toBe(
      colourOf("--map-start"),
    );
    expect(getComputedStyle(part("path.track-finish")).fill, `a dot in ${skin.id}`).toBe(
      colourOf("--map-finish"),
    );
    // The links of the attribution.
    const links = [...root.querySelectorAll(".leaflet-control-attribution a")];
    expect(links.length, `links in ${skin.id}`).toBeGreaterThan(0);
    for (const link of links) {
      expect(getComputedStyle(link).color, `a link in ${skin.id}`).toBe(colourOf("--map-link"));
    }
    // The words of the start and of the finish, the zoom buttons: their ink, their shade.
    const labels = [...root.querySelectorAll(".leaflet-tooltip")];
    expect(labels.length, `the labels in ${skin.id}`).toBe(2);
    for (const label of labels) {
      expect(getComputedStyle(label).color, `a label in ${skin.id}`).toBe(colourOf("--map-ink"));
      expectShadowOf(getComputedStyle(label).boxShadow, "--map-shade", `a label in ${skin.id}`);
    }
    const zoom = [...root.querySelectorAll(".leaflet-bar a")];
    expect(zoom.length, `the zoom buttons in ${skin.id}`).toBeGreaterThan(0);
    for (const button of zoom) {
      expect(getComputedStyle(button).color, `a zoom button in ${skin.id}`).toBe(
        colourOf("--map-ink"),
      );
    }
    expectShadowOf(
      getComputedStyle(part(".leaflet-bar")).boxShadow,
      "--map-shade",
      `the zoom in ${skin.id}`,
    );
    await screen.unmount();
  }
});
