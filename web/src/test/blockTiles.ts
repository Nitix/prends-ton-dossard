import { TILE_HOST } from "../features/route/tileHost";

// Setup file of the browser project (see vite.config.ts).
//
// A test never loads a map tile from the network: it would be slow, it would
// fail offline, and it would show the address of whoever runs the suite to a
// service that is not ours. Leaflet loads a tile by setting the `src` of an
// `<img>`, so that is where the guard stands: the setter refuses the address of
// a tile server, with an error that says what to do. The test gives the map a
// blank `data:` image instead (`BLANK_TILE`, in tiles.tsx). The server is the one of
// the map, `TILE_HOST`: the guard and the map cannot disagree on it.
//
// It is defined on the prototype, so `vi.spyOn(HTMLImageElement.prototype,
// "src", "set")` wraps it and `vi.restoreAllMocks()` gives it back.

function isTileServer(address: string): boolean {
  try {
    return new URL(address, document.baseURI).hostname.endsWith(TILE_HOST);
  } catch {
    // Not an address: the browser will say what it makes of it.
    return false;
  }
}

const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
// Called below with the image as `this`.
// oxlint-disable-next-line typescript/unbound-method
const setSrc = descriptor?.set;
if (descriptor && setSrc) {
  Object.defineProperty(HTMLImageElement.prototype, "src", {
    ...descriptor,
    set(address: string) {
      if (isTileServer(address)) {
        throw new Error(
          `Real map tile request in a test: ${address} — give TrackMap a tileUrl (BLANK_TILE in src/test/tiles.tsx), or mock ./TrackMap with blankTileModule (both in src/test/tiles.tsx)`,
        );
      }
      setSrc.call(this, address);
    },
  });
}
