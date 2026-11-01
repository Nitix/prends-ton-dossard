import { Map as LeafletMap } from "leaflet";
import type { ComponentProps } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { BLANK_TILE } from "../../test/tiles";
import { toTrack } from "./gpx";
import TrackMap, { TILE_ATTRIBUTION, TILE_URL } from "./TrackMap";

// The size of the map and of its buttons are classes of Tailwind and a style of
// the map, which the page loads.
import "../../styles.css";

/** 2.2 km north, with a bend to the east: the start is at the south, the finish at the north. */
const TRACK = toTrack([
  { lat: 45, lon: 6 },
  { lat: 45.01, lon: 6.01 },
  { lat: 45.02, lon: 6 },
]);

/** Another one, somewhere else. */
const OTHER_TRACK = toTrack([
  { lat: 46, lon: 7 },
  { lat: 46.03, lon: 7.02 },
]);

afterEach(() => {
  vi.restoreAllMocks();
});

type Props = Partial<ComponentProps<typeof TrackMap>>;

/** The map of a track, with the language of the test and a blank tile unless it says another. */
function mapOf(props: Props = {}, languages = ["fr"]) {
  return (
    <I18nProvider languages={languages}>
      <TrackMap points={TRACK} tileUrl={BLANK_TILE} {...props} />
    </I18nProvider>
  );
}

async function renderMap(props: Props = {}, languages = ["fr"]) {
  const screen = await render(mapOf(props, languages));
  // The map is the region, named for a screen reader.
  await expect.element(screen.getByRole("region", { name: fr.route.map })).toBeVisible();
  return screen;
}

type Screen = Awaited<ReturnType<typeof renderMap>>;

/** The one element of the map that matches, or an error. */
function part(screen: Screen, selector: string): Element {
  const found = screen.container.querySelectorAll(selector);
  const [only] = found;
  if (found.length !== 1 || only === undefined) {
    throw new Error(`${found.length} elements match ${selector}, not 1`);
  }
  return only;
}

const centerY = (element: Element) => {
  const { top, height } = element.getBoundingClientRect();
  return top + height / 2;
};

test("TrackMap — the track is drawn without tiles", async () => {
  const screen = await renderMap();

  // One line, which is a path of its own in the overlay pane.
  const line = part(screen, ".leaflet-overlay-pane path.track-line");
  const d = line.getAttribute("d") ?? "";
  expect(d).toMatch(/^M[\d.-]+ [\d.-]+(L[\d.-]+ [\d.-]+)+$/);
  expect(d).not.toContain("NaN");
  // Its three points are there: the line goes to the bend and back.
  expect(d.match(/[ML]/g)).toHaveLength(3);

  // The tile is the one that the test gave: a blank picture, loaded.
  await expect
    .poll(() => screen.container.querySelectorAll("img.leaflet-tile-loaded").length)
    .toBeGreaterThan(0);
  for (const tile of screen.container.querySelectorAll<HTMLImageElement>("img.leaflet-tile")) {
    expect(tile.src).toBe(BLANK_TILE);
  }
});

test("TrackMap — the map is fitted to the track, with room around it", async () => {
  // 0.0279° of latitude are about 230 px at the zoom 13, in the 286 px of the
  // map: it fits with 16 px all around (254 px), but not with the room that the
  // labels and the attribution need above and below (202 px), so the map has to
  // go down to the zoom 12.
  const tight = toTrack([
    { lat: 45, lon: 6 },
    { lat: 45.0279, lon: 6 },
  ]);
  const screen = await renderMap({ points: tight });

  const map = screen.getByRole("region", { name: fr.route.map }).element().getBoundingClientRect();
  const track = part(screen, "path.track-line").getBoundingClientRect();
  // All of the track is in the map, with room around it: 16 px at the sides, 32
  // above and 52 below (the border is 1 px)...
  expect(track.left).toBeGreaterThanOrEqual(map.left + 15);
  expect(track.right).toBeLessThanOrEqual(map.right - 15);
  expect(track.top).toBeGreaterThanOrEqual(map.top + 31);
  expect(track.bottom).toBeLessThanOrEqual(map.bottom - 51);
  // ... the words beside its two ends are in the map, above the attribution...
  const attribution = part(screen, ".leaflet-control-attribution").getBoundingClientRect();
  for (const label of screen.container.querySelectorAll(".leaflet-tooltip")) {
    const { top, bottom } = label.getBoundingClientRect();
    expect(top).toBeGreaterThanOrEqual(map.top);
    expect(bottom).toBeLessThanOrEqual(attribution.top);
  }
  // ... and it fills the room as much as a whole zoom allows: half, at least.
  expect(track.height / (map.height - 84)).toBeGreaterThan(0.5);
});

test("TrackMap — the track stays drawn when no tile can be loaded", async () => {
  // A picture that cannot be read: every tile fails, as when the phone is offline.
  const screen = await renderMap({ tileUrl: "data:image/png;base64,AAAA" });

  await expect
    .poll(() => {
      const tiles = [...screen.container.querySelectorAll<HTMLImageElement>("img.leaflet-tile")];
      return tiles.length > 0 && tiles.every((tile) => tile.complete);
    })
    .toBe(true);
  expect(screen.container.querySelectorAll("img.leaflet-tile-loaded")).toHaveLength(0);

  // The track and its marks are there, on the grey of the map.
  expect(part(screen, "path.track-line").getAttribute("d")).toMatch(/^M/);
  part(screen, "path.track-start");
  part(screen, "path.track-finish");
});

test("TrackMap — start and finish markers", async () => {
  const screen = await renderMap();

  // Two marks of two colours, at the two ends of the track: the start is at
  // the south, so under the finish.
  const start = part(screen, "path.track-start");
  const finish = part(screen, "path.track-finish");
  expect(getComputedStyle(start).fill).not.toBe(getComputedStyle(finish).fill);
  expect(centerY(start)).toBeGreaterThan(centerY(finish));

  // The colours are not what says which is which: each mark is named in words, beside it.
  const labels = screen.container.querySelectorAll(".leaflet-tooltip");
  expect([...labels].map((label) => label.textContent)).toEqual(
    expect.arrayContaining([fr.route.start, fr.route.finish]),
  );
  await expect.element(screen.getByText(fr.route.start, { exact: true })).toBeVisible();
  await expect.element(screen.getByText(fr.route.finish, { exact: true })).toBeVisible();

  // Drawn, not pictures: Leaflet's marker images do not load with a bundler.
  expect(screen.container.querySelectorAll("img:not(.leaflet-tile)")).toHaveLength(0);
});

test("TrackMap — a race that ends where it starts shows both marks", async () => {
  const loop = toTrack([
    { lat: 45, lon: 6 },
    { lat: 45.01, lon: 6.01 },
    { lat: 45, lon: 6 },
  ]);
  const screen = await renderMap({ points: loop });

  // The two labels do not cover one another.
  const labels = [...screen.container.querySelectorAll(".leaflet-tooltip")].map((label) =>
    label.getBoundingClientRect(),
  );
  expect(labels).toHaveLength(2);
  const [a, b] = labels;
  expect(a && b && (a.bottom <= b.top + 1 || b.bottom <= a.top + 1)).toBe(true);
});

test("TrackMap — zoom buttons are 44 px, wheel zoom is off", async () => {
  const screen = await renderMap();

  // The buttons have names, in the language of the page, and are tap targets.
  for (const name of [fr.route.zoomIn, fr.route.zoomOut]) {
    const button = screen.getByRole("button", { name });
    await expect.element(button).toBeVisible();
    const { width, height } = button.element().getBoundingClientRect();
    expect(width).toBeGreaterThanOrEqual(44);
    expect(height).toBeGreaterThanOrEqual(44);
  }

  // The wheel scrolls the page, as anywhere else: Leaflet cancels a wheel that it zooms with.
  const region = screen.getByRole("region", { name: fr.route.map }).element();
  const wheel = new WheelEvent("wheel", { deltaY: -400, bubbles: true, cancelable: true });
  region.dispatchEvent(wheel);
  expect(wheel.defaultPrevented).toBe(false);

  // The buttons do zoom: the track gets bigger.
  const line = part(screen, "path.track-line");
  const before = line.getBoundingClientRect().height;
  await screen.getByRole("button", { name: fr.route.zoomIn }).click();
  await expect
    .poll(() => line.getBoundingClientRect().height, { timeout: 3000 })
    .toBeGreaterThan(before * 1.5);
});

test("TrackMap — a named region with the attribution", async () => {
  const screen = await renderMap();

  // The region is the map; the attribution of the tiles is in it, with its links.
  const region = screen.getByRole("region", { name: fr.route.map });
  await expect
    .element(region.getByRole("link", { name: "OpenStreetMap" }))
    .toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
  await expect
    .element(region.getByRole("link", { name: "OpenTopoMap" }))
    .toHaveAttribute("href", "https://opentopomap.org");
  await expect
    .element(region.getByRole("link", { name: "CC-BY-SA" }))
    .toHaveAttribute("href", expect.stringContaining("creativecommons.org/licenses/by-sa"));
  expect(region.element().querySelector(".leaflet-control-attribution")?.textContent).toContain(
    "© OpenStreetMap contributors, SRTM | © OpenTopoMap (CC-BY-SA)",
  );

  // They open a new tab: the page of the event stays where it is.
  for (const name of ["OpenStreetMap", "OpenTopoMap", "CC-BY-SA"]) {
    const link = region.getByRole("link", { name }).element();
    expect(link.getAttribute("target")).toBe("_blank");
    expect((link.getAttribute("rel") ?? "").split(" ")).toEqual(
      expect.arrayContaining(["noopener", "noreferrer"]),
    );
  }

  // The map can be reached with the keyboard: it takes the focus, and moves with the arrows.
  expect(region.element().tabIndex).toBe(0);
});

test("TrackMap — OpenTopoMap tiles, and never closer than zoom 17", async () => {
  // The setter of `src` is replaced for this test: it keeps the addresses and
  // loads nothing, so that the default tiles are asked for without going on the network.
  const asked: string[] = [];
  vi.spyOn(HTMLImageElement.prototype, "src", "set").mockImplementation((address) => {
    asked.push(address);
  });

  // A track with no length is shown as close as the map goes.
  await renderMap({ points: toTrack([{ lat: 45, lon: 6 }]), tileUrl: undefined });

  await expect.poll(() => asked.length).toBeGreaterThan(0);
  for (const address of asked) {
    expect(address).toMatch(/^https:\/\/[abc]\.tile\.opentopomap\.org\/17\/\d+\/\d+\.png$/);
  }
  expect(TILE_URL).toBe("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png");
  expect(TILE_ATTRIBUTION).toContain("openstreetmap.org/copyright");
  expect(TILE_ATTRIBUTION).toContain("opentopomap.org");
});

test("TrackMap — a track of one point, or of one place, is drawn", async () => {
  for (const points of [
    toTrack([{ lat: 45, lon: 6 }]),
    toTrack([
      { lat: 45, lon: 6 },
      { lat: 45, lon: 6 },
    ]),
  ]) {
    const screen = await renderMap({ points });

    part(screen, "path.track-start");
    part(screen, "path.track-finish");
    expect(screen.container.innerHTML).not.toContain("NaN");
    await screen.unmount();
  }
});

test("TrackMap — a new track replaces the old one", async () => {
  const screen = await renderMap();
  const before = part(screen, "path.track-line").getAttribute("d");

  await screen.rerender(mapOf({ points: OTHER_TRACK }));

  // Still one map, in the one region, with the other track.
  expect(screen.container.querySelectorAll(".leaflet-container")).toHaveLength(1);
  expect(part(screen, "path.track-line").getAttribute("d")).not.toBe(before);
  part(screen, "path.track-start");
  part(screen, "path.track-finish");
});

test("TrackMap — the map is removed when it goes away", async () => {
  const remove = vi.spyOn(LeafletMap.prototype, "remove");
  const screen = await renderMap();
  expect(remove).not.toHaveBeenCalled();

  await screen.unmount();

  expect(remove).toHaveBeenCalledOnce();
});

test("TrackMap — in English, the texts are English", async () => {
  const screen = await render(mapOf({}, ["en-GB"]));

  const region = screen.getByRole("region", { name: "Route map" });
  await expect.element(region).toBeVisible();
  await expect.element(region.getByRole("button", { name: "Zoom in" })).toBeVisible();
  await expect.element(region.getByRole("button", { name: "Zoom out" })).toBeVisible();
  await expect.element(region.getByText("Start", { exact: true })).toBeVisible();
  await expect.element(region.getByText("Finish", { exact: true })).toBeVisible();
});
