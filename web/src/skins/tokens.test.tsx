import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin } from ".";
import { Dialog } from "../components/Dialog";
import { toTrack } from "../features/route/gpx";
import TrackMap from "../features/route/TrackMap";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
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
// is the one the skin gives the property. So is the shade of a window
// (`--shade-dialog`). Nothing here names a skin.

afterEach(() => {
  chooseSkin("crete");
});

/** A colour of the theme as the browser computes it, here and now. */
function colourOf(property: string): string {
  const probe = document.createElement("span");
  probe.style.color = `var(${property}, transparent)`;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

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

/** The empty layer that Tailwind puts in a `box-shadow` for a ring or an inset shadow it does not draw. */
const EMPTY_LAYER = "rgba(0, 0, 0, 0) 0px 0px 0px 0px";

/** A shadow (or a drop shadow) is drawn in the colour of a property of the theme, which is declared. */
function expectShadowOf(shadow: string, property: string, what: string) {
  const declared = getComputedStyle(document.documentElement).getPropertyValue(property);
  expect(declared.trim(), `${property} is declared`).not.toBe("");
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
