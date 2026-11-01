/**
 * The box of the map of a track, and of what stands in its place while the map
 * loads (see RouteSection): the same size, so that the page does not jump. A
 * fixed height, so that the map does not take the whole screen of a phone, and
 * the page can be scrolled past it. It is a module of its own, so that the page
 * need not load the map (and Leaflet) to know it.
 */
export const MAP_BOX = "h-72 w-full rounded-lg border border-neutral-300";
