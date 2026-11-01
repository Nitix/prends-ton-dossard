import {
  circleMarker,
  control,
  map as createMap,
  polyline,
  tileLayer,
  type LatLngTuple,
  type PointTuple,
  type TooltipOptions,
} from "leaflet";
import { useEffect, useRef } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { TrackPoint } from "./gpx";
import { MAP_BOX } from "./mapBox";
import { TILE_HOST } from "./tileHost";

// Leaflet and its styles are only imported here, and this module only by
// `React.lazy` (see RouteSection): they make a chunk of their own, loaded on the
// page of an event that has a track, and nowhere else.
import "leaflet/dist/leaflet.css";
import "./TrackMap.css";

/** The tiles of OpenTopoMap: a topographic map, with contour lines. `{s}` is one of the `subdomains`. */
export const TILE_URL = `https://{s}.tile.${TILE_HOST}/{z}/{x}/{y}.png`;

/**
 * What the map says about where it comes from, as HTML (Leaflet takes it so):
 * the terms of OpenStreetMap and of OpenTopoMap require it, with the links.
 * The links open a new tab, so that the page of the event stays where it is.
 */
export const TILE_ATTRIBUTION = [
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors, SRTM',
  '© <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)',
].join(" | ");

/** OpenTopoMap has no tile closer than this. */
const MAX_ZOOM = 17;

// The room kept around the track when the map is fitted to it, in pixels:
// - on the left, 72, for the zoom buttons: they end 60 px from the edge (a margin
//   of 10, 44 of button, the borders), and the biggest dot, the finish (10 px and
//   a ring of 1), must be clear of them, whichever end of the track is at the
//   north-west;
// - above, 32, for the words beside the start;
// - below, 52, for the attribution (two lines on a phone) and the words beside
//   the finish, which would cover the end of the track;
// - on the right, 16.
const PADDING_TOP_LEFT: PointTuple = [72, 32];
const PADDING_BOTTOM_RIGHT: PointTuple = [16, 52];

/** The user asks the system for less motion. */
const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

// The colours of the track and of its two ends. The start and the finish also
// differ by their size (the start is a dot in the ring of the finish, so both
// show when the race ends where it starts) and are named in words.
const LINE_COLOR = "#dc2626";
const START_COLOR = "#15803d";
const FINISH_COLOR = "#171717";
const START_RADIUS = 6;
const FINISH_RADIUS = 10;

/**
 * The words beside a mark. They go toward the centre of the map, so they are
 * not cut by its edge; the start's goes up and the finish's down, so that two
 * marks on the same spot (a loop) have two words that can be read.
 */
function labelOptions(radius: number, shift: number): TooltipOptions {
  return { permanent: true, direction: "auto", offset: [radius + 2, shift] };
}

/**
 * A track on a topographic map that can be moved and zoomed (with the buttons,
 * the keys, or two fingers: the wheel scrolls the page): the line, and two dots
 * for the start and the finish. Pass the whole track, with at least one point;
 * Leaflet reduces the line to what the zoom shows. `tileUrl` is where the tiles
 * come from, which only a test changes. Without tiles (offline, or blocked) the
 * track stays drawn, on grey.
 *
 * The map is a region of the page, named for a screen reader. It tells nothing
 * that the page does not say beside it: the numbers of the track are written
 * outside.
 *
 * Leaflet works on the DOM itself: the map is made in an effect, on the element
 * that React gives, and removed when the effect is cleaned up. The component is
 * the default export because `React.lazy` takes one.
 */
export default function TrackMap({
  points,
  tileUrl = TILE_URL,
}: {
  points: TrackPoint[];
  tileUrl?: string;
}) {
  const { t } = useI18n();
  const element = useRef<HTMLElement>(null);
  const { zoomIn, zoomOut, start, finish } = t.route;

  useEffect(() => {
    const container = element.current;
    const first = points[0];
    const last = points.at(-1);
    if (container === null || first === undefined || last === undefined) return undefined;

    // The zoom control is added below, to be in the language of the page. With
    // less motion asked for, nothing is animated: not the zoom, not the fade of
    // the tiles, not the zoom of the markers (otherwise Leaflet decides for each browser).
    const calm = window.matchMedia(REDUCED_MOTION).matches;
    const map = createMap(container, {
      scrollWheelZoom: false,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
      ...(calm ? { zoomAnimation: false, fadeAnimation: false, markerZoomAnimation: false } : {}),
    });
    // Leaflet's own link (in English, and in the same tab) is left out: what the
    // map says about itself is the attribution of its tiles.
    map.attributionControl.setPrefix(false);
    control.zoom({ zoomInTitle: zoomIn, zoomOutTitle: zoomOut }).addTo(map);
    tileLayer(tileUrl, {
      subdomains: "abc",
      maxZoom: MAX_ZOOM,
      attribution: TILE_ATTRIBUTION,
    }).addTo(map);

    // What is drawn does not take the touches, so that a finger that starts on
    // the track still moves the map.
    const line = polyline(
      points.map((p): LatLngTuple => [p.lat, p.lon]),
      { className: "track-line", color: LINE_COLOR, weight: 4, opacity: 0.9, interactive: false },
    ).addTo(map);
    const mark = (className: string, color: string, radius: number) => ({
      className,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
      radius,
      interactive: false,
    });
    circleMarker([last.lat, last.lon], mark("track-finish", FINISH_COLOR, FINISH_RADIUS))
      .bindTooltip(finish, labelOptions(FINISH_RADIUS, 14))
      .addTo(map);
    circleMarker([first.lat, first.lon], mark("track-start", START_COLOR, START_RADIUS))
      .bindTooltip(start, labelOptions(START_RADIUS, -14))
      .addTo(map);

    map.fitBounds(line.getBounds(), {
      paddingTopLeft: PADDING_TOP_LEFT,
      paddingBottomRight: PADDING_BOTTOM_RIGHT,
    });
    return () => {
      // Leaflet 1.9.4 ends an animated zoom with a timer of 250 ms that
      // `remove()` does not cancel, and that fails on the map once it is gone (the
      // person leaves the page just after a click on a zoom button). The first
      // thing that the timer looks at is the flag below: it does nothing without it.
      // It is a private flag of that exact version, which the package.json pins.
      Object.assign(map, { _animatingZoom: false });
      map.remove();
    };
  }, [points, tileUrl, zoomIn, zoomOut, start, finish]);

  // A <section> with a name is a region. `isolate` keeps the layers of Leaflet
  // (which go up to z-index 1000) under whatever the page puts over the content.
  return (
    <section ref={element} aria-label={t.route.map} className={`track-map isolate ${MAP_BOX}`} />
  );
}
