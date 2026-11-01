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

// Leaflet and its styles are only imported here, and this module only by
// `React.lazy` (see RouteSection): they make a chunk of their own, loaded on the
// page of an event that has a track, and nowhere else.
import "leaflet/dist/leaflet.css";
import "./TrackMap.css";

/** The tiles of OpenTopoMap: a topographic map, with contour lines. `{s}` is one of the `subdomains`. */
export const TILE_URL = "https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png";

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

// The room kept around the track when the map is fitted to it, in pixels: 16 on
// the sides; more above, for the words beside the start, and below, for the
// attribution (two lines on a phone) and the words beside the finish, which
// would cover the end of the track.
const PADDING_TOP_LEFT: PointTuple = [16, 32];
const PADDING_BOTTOM_RIGHT: PointTuple = [16, 52];

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

    // The zoom control is added below, to be in the language of the page.
    const map = createMap(container, {
      scrollWheelZoom: false,
      maxZoom: MAX_ZOOM,
      zoomControl: false,
    });
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
      map.remove();
    };
  }, [points, tileUrl, zoomIn, zoomOut, start, finish]);

  // A <section> with a name is a region. `isolate` keeps the layers of Leaflet
  // (which go up to z-index 1000) under whatever the page puts over the content.
  return (
    <section ref={element} aria-label={t.route.map} className={`track-map isolate ${MAP_BOX}`} />
  );
}
