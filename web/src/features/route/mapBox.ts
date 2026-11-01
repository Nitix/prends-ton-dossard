/**
 * The box of the map of a track, and of what stands in its place while the map
 * loads (see RouteSection): the same size, so that the page does not jump. A
 * fixed height, so that the map does not take the whole screen of a phone, and
 * the page can be scrolled past it. It is a module of its own, so that the page
 * need not load the map (and Leaflet) to know it.
 */
export const MAP_BOX =
  "h-72 w-full overflow-hidden rounded-[1.25rem] border-2 border-white shadow-[0_0_0_1px_rgb(233_226_242),0_18px_40px_-16px_rgb(214_51_111/0.5),0_6px_24px_-12px_rgb(94_74_227/0.45)]";
