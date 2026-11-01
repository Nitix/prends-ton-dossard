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
 * The module `./TrackMap`, as a test of a page that shows a track has it: the
 * real map, loaded as it is in the app, but drawing blank tiles, so that the
 * test never asks the tile server for a tile. `original` is the
 * `importOriginal` of the `vi.mock` factory, which cannot use an import (it is
 * hoisted above them):
 *
 *     vi.mock("./TrackMap", async (importOriginal) => {
 *       const { blankTileModule } = await import("../../test/tiles");
 *       return blankTileModule(importOriginal);
 *     });
 */
export async function blankTileModule<M extends { default: ComponentType<MapProps> }>(
  original: () => Promise<M>,
): Promise<M> {
  const actual = await original();
  const TrackMap = actual.default;
  return {
    ...actual,
    default: function MapWithBlankTiles(props: MapProps) {
      return <TrackMap {...props} tileUrl={BLANK_TILE} />;
    },
  };
}
