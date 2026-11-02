import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { SKINS, chooseSkin } from ".";
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

import "../styles.css";
import "../skins/styles";

// What a palette skin changes without drawing anything: the colours that the
// pieces of the app read from the custom properties of the theme. Crête's
// motifs (they stand in for those a skin does not draw) and the map of a track
// are painted with `--motif-*` and `--map-*`, never with a colour written in
// them: in every skin, each colour they show is the one the skin gives the
// property. Nothing here names a skin.

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

test("tokens — les motifs de Crête prennent leurs couleurs des propriétés --motif-*, dans chaque skin", async () => {
  for (const skin of SKINS) {
    chooseSkin(skin.id);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <MotifDefs />
        <div className="relative h-40">
          <HeaderArt place="header" sun />
        </div>
        <div className="relative h-80">
          <HeaderArt place="welcome" />
        </div>
        <div className="relative h-40">
          <HeroArt place="event" />
        </div>
        <BrandMark />
        <div className="relative">
          <EmptyArt />
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
    // The band under the ridges, behind the sheet of the page.
    const band = [...root.querySelectorAll<HTMLElement>("span[style]")].find((span) =>
      span.style.backgroundColor.startsWith("var("),
    );
    expect(band, `${skin.id}: the band under the ridges`).toBeDefined();
    expect(getComputedStyle(band ?? root).backgroundColor).toBe(colourOf("--motif-ridge-near-to"));
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
    await screen.unmount();
  }
});
