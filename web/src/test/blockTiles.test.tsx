import { expect, test } from "vitest";

import { TILE_URL } from "../features/route/TrackMap";
import { BLANK_TILE } from "./tiles";

// It is a `.tsx` file only for the browser project: `HTMLImageElement` only
// exists in a browser, and it is the one that the guard of `blockTiles.ts`
// stands in for. Nothing here replaces the guard before the first call: it
// must refuse.

test("blockTiles — an image cannot be given the address of a tile server", () => {
  const image = new Image();

  expect(() => {
    image.src = "https://a.tile.opentopomap.org/12/2120/1472.png";
  }).toThrow("Real map tile request in a test");
  // Nothing was asked for.
  expect(image.getAttribute("src")).toBeNull();
});

test("blockTiles — the tile server of the map is the one that is refused", () => {
  const image = new Image();
  const address = TILE_URL.replace("{s}", "a")
    .replace("{z}", "12")
    .replace("{x}", "2120")
    .replace("{y}", "1472");

  expect(() => {
    image.src = address;
  }).toThrow("Real map tile request in a test");
});

test("blockTiles — a data URL is left alone", () => {
  const image = new Image();

  image.src = BLANK_TILE;

  expect(image.src).toBe(BLANK_TILE);
});
