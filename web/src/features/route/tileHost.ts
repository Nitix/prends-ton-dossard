/**
 * The host of the tiles of the map (OpenTopoMap). A module of its own, without
 * Leaflet, for what only needs the name: the tests refuse any request to this
 * host (see src/test/blockTiles.ts).
 */
export const TILE_HOST = "opentopomap.org";
