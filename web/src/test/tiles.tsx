import type { ComponentProps, ComponentType } from "react";

import type TrackMapComponent from "../features/route/TrackMap";

/**
 * A 1×1 transparent PNG, as a data URL: the tile that a test gives the map, so
 * that no test loads a real one from the network.
 */
export const BLANK_TILE =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";

type MapProps = ComponentProps<typeof TrackMapComponent>;

/**
 * The map of a track, drawing blank tiles. A test of a page that shows a track
 * mocks `./TrackMap` with it (`vi.mock`, using the original module), so that
 * the test still goes through the real map, loaded as it is in the app, but
 * never asks the tile server for a tile.
 */
export function withBlankTiles(TrackMap: ComponentType<MapProps>): ComponentType<MapProps> {
  return function MapWithBlankTiles(props) {
    return <TrackMap {...props} tileUrl={BLANK_TILE} />;
  };
}
