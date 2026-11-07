import {
  circleMarker,
  control,
  latLngBounds,
  map as createMap,
  polyline,
  tileLayer,
  type CircleMarker,
  type LatLngTuple,
  type Polyline,
  type LeafletMouseEvent,
  type Map as LeafletMap,
  type Point,
  type PointTuple,
  type TooltipOptions,
} from "leaflet";
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { coarsePointer, gateWheel, zoomModifier } from "./gestures";
import type { TrackPoint } from "./gpx";
import { MAP_BOX } from "./mapBox";
import { pointsIn, type KmRange } from "./range";
import { SLOPE_COLORS, SLOPE_FILLS, type SlopeZone } from "./slope";
import { TILE_HOST } from "./tileHost";
import { nearestKm, pointAtKm, trackIndex, type TrackIndex } from "./trackIndex";

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

/** How long the hint stays on the map, in milliseconds. */
const HINT_MS = 1500;
/** Changes of the portion that follow each other within this (milliseconds) are a gesture: the map is framed with no animation. */
const RAPID_MS = 250;
/** How far a finger has to go, in pixels, to be moving and not tapping (less than the slop of a browser). */
const FINGER_MOVE_PX = 4;

// The colours of the track and of its two ends are properties of the theme
// (`--map-*` in styles.css), which a skin sets. The start and the finish also
// differ by their size (the start is a dot in the ring of the finish, so both
// show when the race ends where it starts) and are named in words.
// The line is painted with the gradient of the dawn, and in this colour where
// the gradient cannot be drawn (see below).
const LINE_COLOR = "var(--map-line)";
const START_RADIUS = 6;
const FINISH_RADIUS = 10;

/** The mark of the cursor of the profile: between the start and the finish in size. */
const MARKER_RADIUS = 7;

/**
 * How near the track a mouse (or a pen) has to be, in pixels, for the profile to
 * read the track there, and a finger: half of a tap target of 44 px, since a
 * finger is wider and hides what it touches.
 */
const HOVER_PX = 12;
const TAP_PX = 22;

/**
 * How far apart two passes of the track (an out-and-back on one path, a loop
 * that ends at its start) are taken for one: 5 m, or 3 pixels when the map is
 * zoomed out and they are closer than that on the screen.
 */
const TIE_M = 5;
const TIE_PX = 3;

/**
 * The words beside a mark. They go toward the centre of the map, so they are
 * not cut by its edge; the start's goes up and the finish's down, so that two
 * marks on the same spot (a loop) have two words that can be read.
 */
function labelOptions(radius: number, shift: number): TooltipOptions {
  return { permanent: true, direction: "auto", offset: [radius + 2, shift] };
}

/** The map, the mark of the cursor of the profile that is moved on it, and the lines of the track. */
type Layers = {
  map: LeafletMap;
  dot: CircleMarker;
  halo: Polyline;
  line: Polyline;
  /** The two ends, kept over the portion's line. */
  ends: CircleMarker[];
  /** Whether the map moves without animation (less motion asked for). */
  calm: boolean;
  /** The portion that is shown now, and its two lines (made when there is one). */
  range: KmRange | null;
  portion: Polyline[];
};

/** The track out of the portion: half as strong as it is alone. */
const REST_OPACITY = 0.5;
const HALO_OPACITY = 0.85;

/**
 * Shows a portion of the track (or all of it, with `null`): the map is framed on
 * its points with the margins of the whole track, a line of its own, thicker,
 * is laid over it, and the rest of the track is at half opacity. `animate` is
 * false when the map is first made (it is framed already) and with less motion.
 */
function showRange(
  layers: Layers | null,
  points: TrackPoint[],
  range: KmRange | null,
  animate: boolean,
) {
  if (layers === null) return;
  const { map, halo, line } = layers;
  layers.range = range;
  for (const part of layers.portion) part.remove();
  layers.portion = [];
  const shown = range === null ? points : pointsIn(points, range);
  const latLngs = shown.map((p): LatLngTuple => [p.lat, p.lon]);
  if (range !== null && latLngs.length > 0) {
    // A white halo under the portion, as the track has, and the line over both.
    const edge = polyline(latLngs, {
      className: "track-portion-halo",
      color: "#ffffff",
      weight: 12,
      opacity: 1,
      interactive: false,
    }).addTo(map);
    const portion = polyline(latLngs, {
      className: "track-portion",
      weight: 7,
      opacity: 1,
      interactive: false,
    }).addTo(map);
    // Over the line, under the marks of the start, of the finish and of the cursor.
    layers.portion = [edge, portion];
    for (const end of layers.ends) end.bringToFront();
    if (map.hasLayer(layers.dot)) layers.dot.bringToFront();
  }
  halo.setStyle({ opacity: range === null ? HALO_OPACITY : HALO_OPACITY * REST_OPACITY });
  line.setStyle({ opacity: range === null ? 1 : REST_OPACITY });
  if (latLngs.length > 0) {
    map.fitBounds(latLngBounds(latLngs), {
      paddingTopLeft: PADDING_TOP_LEFT,
      paddingBottomRight: PADDING_BOTTOM_RIGHT,
      animate: animate && !layers.calm,
    });
  }
}

/** Where the mark of the cursor goes: a kilometer (or none) and the zone of the slope there. */
type Wanted = { km: number | null; zone: SlopeZone | null };

/**
 * Puts the mark at its kilometer, in the colour of its zone, or takes it away.
 * The colour is the one of the theme (`var(--color-slope-N)`, as the dot of
 * the profile has), so that it follows the theme without being painted again;
 * the ink of the profile when the zone is not known.
 */
function place(layers: Layers | null, index: TrackIndex, { km, zone }: Wanted) {
  if (layers === null) return;
  const { map, dot } = layers;
  const at = km === null ? undefined : pointAtKm(index, km);
  if (at === undefined) {
    dot.remove();
    return;
  }
  dot.setLatLng([at.lat, at.lon]);
  if (!map.hasLayer(dot)) dot.addTo(map);
  // Leaflet draws a new path each time the mark is added.
  const path = dot.getElement();
  if (path instanceof SVGElement) {
    // For the eye only: the cursor of the profile says where it is, in words.
    path.setAttribute("aria-hidden", "true");
    path.style.fill = zone === null ? "var(--color-relief)" : SLOPE_FILLS[zone];
  }
}

/**
 * A track on a topographic map that can be moved and zoomed (with the buttons,
 * the keys, Ctrl or ⌘ and the wheel, or two fingers: the wheel alone scrolls the
 * page, and on a touch screen so does one finger; a hint says so, see gestures.ts): the line, and two dots
 * for the start and the finish. Pass the whole track, with at least one point;
 * Leaflet reduces the line to what the zoom shows. `tileUrl` is where the tiles
 * come from, which only a test changes. Without tiles (offline, or blocked) the
 * track stays drawn, on grey.
 *
 * The map is a region of the page, named for a screen reader. It tells nothing
 * that the page does not say beside it: the numbers of the track are written
 * outside.
 *
 * It is linked to the elevation profile (see RouteSection): `markerKm` puts a
 * mark on the track at that kilometer, in the colour of the slope `markerZone`
 * (the cursor of the profile, with the colour of its dot), and `onTrackKm` is
 * told the kilometer of the track under a mouse or a pen with no button down (within `HOVER_PX`),
 * or under a tap (within `TAP_PX`), and `null` when the pointer leaves the
 * track or the map, or a tap is away from the track. The mark takes no pointer
 * and no focus, and says nothing to a screen reader: the cursor of the profile
 * is what tells the place.
 *
 * `range` is a portion of the track, in kilometers (the profile zoomed on it, see
 * RouteSection): the map is framed on its points, a line of its own is laid over
 * it and the rest of the track is dimmed; `null` frames the whole track again.
 *
 * Leaflet works on the DOM itself: the map is made in an effect, on the element
 * that React gives, and removed when the effect is cleaned up. The component is
 * the default export because `React.lazy` takes one.
 */
export default function TrackMap({
  points,
  tileUrl = TILE_URL,
  markerKm = null,
  markerZone = null,
  range = null,
  onTrackKm,
}: {
  points: TrackPoint[];
  tileUrl?: string;
  markerKm?: number | null;
  markerZone?: SlopeZone | null;
  range?: KmRange | null;
  onTrackKm?: (km: number | null) => void;
}) {
  const { t } = useI18n();
  const element = useRef<HTMLElement>(null);
  const gate = useRef<HTMLDivElement>(null);
  const help = useId();
  // The hint over the map, which goes away by itself.
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef(0);
  const showHint = useCallback((text: string) => {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), HINT_MS);
  }, []);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  const key = zoomModifier();
  const { wheelHint, fingersHint } = t.route;
  // Each map has its gradient: two tracks on a page have two maps.
  const gradient = useId();
  const { zoomIn, zoomOut, start, finish } = t.route;
  // Where each kilometer is, and which is nearest to a place: once per track.
  const index = useMemo(() => trackIndex(points), [points]);
  const layers = useRef<Layers | null>(null);
  // Where the mark goes, kept for a map that is made again (another language).
  const wanted = useRef<Wanted>({ km: null, zone: null });
  // The portion shown, kept for a map that is made again too.
  const shownRange = useRef<KmRange | null>(range);
  // Who is told of the track under the pointer, without making the map again when it changes.
  const tell = useRef(onTrackKm);
  useLayoutEffect(() => {
    tell.current = onTrackKm;
  });

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
      // The wheel zooms with Ctrl or ⌘ only (see gateWheel); on a touch screen a
      // finger scrolls the page, and two fingers move and zoom the map.
      scrollWheelZoom: true,
      dragging: !coarsePointer(),
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
    const latLngs = points.map((p): LatLngTuple => [p.lat, p.lon]);
    // A white halo under the line, so that it stands out of the map.
    const halo = polyline(latLngs, {
      className: "track-halo",
      color: "#ffffff",
      weight: 9,
      opacity: 0.85,
      interactive: false,
    }).addTo(map);
    // The gradient of the dawn, laid on the box of the line, and the plain colour
    // where it cannot be: a track due east or due north has a box of no height
    // or no width, on which a gradient has nothing to be drawn.
    const line = polyline(latLngs, {
      className: "track-line",
      weight: 5,
      opacity: 1,
      interactive: false,
    }).addTo(map);
    const mark = (className: string, color: string, radius: number) => ({
      className,
      color: "#ffffff",
      weight: 2,
      fillColor: color,
      fillOpacity: 1,
      radius,
      interactive: false,
    });
    // The fills of the start and of the finish are in TrackMap.css (`--map-start`, `--map-finish`).
    const finishMark = circleMarker(
      [last.lat, last.lon],
      mark("track-finish", "none", FINISH_RADIUS),
    )
      .bindTooltip(finish, labelOptions(FINISH_RADIUS, 14))
      .addTo(map);
    const startMark = circleMarker(
      [first.lat, first.lon],
      mark("track-start", "none", START_RADIUS),
    )
      .bindTooltip(start, labelOptions(START_RADIUS, -14))
      .addTo(map);

    map.fitBounds(line.getBounds(), {
      paddingTopLeft: PADDING_TOP_LEFT,
      paddingBottomRight: PADDING_BOTTOM_RIGHT,
    });
    // The colours of the line are properties of the theme, which a skin sets: a
    // style of its element, there once the map is drawn, since the id of the
    // gradient is the map's own.
    const path = line.getElement();
    if (path instanceof SVGElement) path.style.stroke = `url(#${gradient}) ${LINE_COLOR}`;

    // The mark of the cursor of the profile: one dot, made once and moved (see
    // `place`, which paints it), over the track. A ring of the card around it,
    // as the dot of the profile has (TrackMap.css), detaches it from the map and
    // from the line.
    const dot = circleMarker(
      [first.lat, first.lon],
      mark("track-marker", SLOPE_COLORS[1], MARKER_RADIUS),
    );
    layers.current = {
      map,
      dot,
      halo,
      line,
      calm,
      range: null,
      portion: [],
      ends: [finishMark, startMark],
    };
    place(layers.current, index, wanted.current);
    // A portion that was chosen before the map was made (or made again): framed at once.
    if (shownRange.current !== null) showRange(layers.current, points, shownRange.current, false);

    // The kilometer of the track nearest to a point of the map, if the track is
    // within `tolerance` pixels of it there. Where the track passes twice so
    // close that the two cannot be told apart (TIE_M, or TIE_PX on the screen),
    // the pass nearest the cursor is kept: it does not jump from one to the other.
    const kmNear = (point: Point, tolerance: number): number | null => {
      const here = map.containerPointToLatLng(point);
      const { lat, lng } = here;
      const cursor = wanted.current.km;
      const pixelM = map.distance(here, map.containerPointToLatLng(point.add([1, 0])));
      const km = nearestKm(
        index,
        lat,
        lng,
        cursor === null
          ? undefined
          : { km: cursor, withinKm: Math.max(TIE_M, TIE_PX * pixelM) / 1000 },
      );
      const near = km === undefined ? undefined : pointAtKm(index, km);
      if (km === undefined || near === undefined) return null;
      return map.latLngToContainerPoint([near.lat, near.lon]).distanceTo(point) <= tolerance
        ? km
        : null;
    };
    // What the page was last told: a pointer that wanders away from the track
    // says `null` once, not at every move (and leaves alone a cursor that the
    // keys have put on the profile).
    let told: number | null = null;
    const say = (km: number | null) => {
      told = km;
      tell.current?.(km);
    };
    // A mouse or a pen over the map: the track under it, once an image at most.
    // A pointer with a button down is moving the map, not pointing (the track
    // passing under it would make the cursor flicker): a finger on the screen
    // always is, and says where with a tap.
    let frame = 0;
    let pointer: Point | null = null;
    let pointerType = "mouse";
    const onPointerDown = (event: PointerEvent) => {
      pointerType = event.pointerType;
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.buttons !== 0) return;
      pointer = map.mouseEventToContainerPoint(event);
      if (frame !== 0) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const km = pointer === null ? null : kmNear(pointer, HOVER_PX);
        pointer = null;
        if (km !== null || told !== null) say(km);
      });
    };
    // The pointer leaves the map (a finger "leaves" at the end of every touch: not that).
    const onPointerLeave = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = null;
      if (told !== null) say(null);
    };
    // A tap (or a click) on the track, or near it; elsewhere, it puts the cursor
    // away. Leaflet does not count a click at the end of a drag, and nothing
    // here moves the map: the map stays where it is.
    const onClick = (event: LeafletMouseEvent) => {
      say(kmNear(event.containerPoint, pointerType === "touch" ? TAP_PX : HOVER_PX));
    };
    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerleave", onPointerLeave);
    map.on("click", onClick);

    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerleave", onPointerLeave);
      cancelAnimationFrame(frame);
      layers.current = null;
      // Leaflet 1.9.4 ends an animated zoom with a timer of 250 ms that
      // `remove()` does not cancel, and that fails on the map once it is gone (the
      // person leaves the page just after a click on a zoom button). The first
      // thing that the timer looks at is the flag below: it does nothing without it.
      // It is a private flag of that exact version, which the package.json pins.
      Object.assign(map, { _animatingZoom: false });
      map.remove();
    };
  }, [points, index, tileUrl, zoomIn, zoomOut, start, finish, gradient]);

  // The wheel alone scrolls the page, and says why.
  useEffect(() => {
    const gateElement = gate.current;
    if (gateElement === null) return undefined;
    return gateWheel(gateElement, () => showHint(wheelHint(key)));
  }, [showHint, wheelHint, key]);

  // On a touch screen, a finger that moves over the map scrolls the page: it says
  // that two fingers move the map. (Two fingers are the map's, and say nothing.)
  useEffect(() => {
    const container = element.current;
    if (container === null || !coarsePointer()) return undefined;
    const down = new Map<number, { x: number; y: number }>();
    // Whether a second finger was down during this gesture (until all are up): a pinch
    // that the browser cancels is not a finger that scrolls.
    let multi = false;
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      // A finger on a button or another control of the map is not trying to move the map.
      if (event.target instanceof Element && event.target.closest(".leaflet-control")) return;
      down.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (down.size >= 2) multi = true;
    };
    const onMove = (event: PointerEvent) => {
      const from = down.get(event.pointerId);
      if (from === undefined || down.size !== 1 || multi) return;
      if (Math.hypot(event.clientX - from.x, event.clientY - from.y) >= FINGER_MOVE_PX) {
        showHint(fingersHint);
      }
    };
    const onEnd = (event: PointerEvent) => {
      down.delete(event.pointerId);
      if (down.size === 0) multi = false;
    };
    // The browser that takes a finger for a scroll cancels its pointer, sometimes before it
    // has moved by `FINGER_MOVE_PX` (iOS): a lone finger that is cancelled says why too.
    const onCancel = (event: PointerEvent) => {
      if (down.has(event.pointerId) && down.size === 1 && !multi) showHint(fingersHint);
      onEnd(event);
    };
    container.addEventListener("pointerdown", onDown);
    container.addEventListener("pointermove", onMove);
    container.addEventListener("pointerup", onEnd);
    container.addEventListener("pointercancel", onCancel);
    return () => {
      container.removeEventListener("pointerdown", onDown);
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("pointerup", onEnd);
      container.removeEventListener("pointercancel", onCancel);
    };
  }, [showHint, fingersHint]);

  // The map follows the portion of the profile. This effect too comes after the map's.
  // A pinch changes the portion at every move of the fingers: the map is drawn once an image
  // at most, and without the animation of the frame while the changes come one on the
  // other (a button or a key makes one change, and is animated).
  const lastChange = useRef(0);
  useEffect(() => {
    shownRange.current = range;
    const at = performance.now();
    const rapid = at - lastChange.current < RAPID_MS;
    lastChange.current = at;
    const frame = requestAnimationFrame(() => {
      const current = layers.current;
      const same =
        current?.range?.from === range?.from &&
        current?.range?.to === range?.to &&
        (current?.range === null) === (range === null);
      if (!same) showRange(current, points, range, !rapid);
    });
    return () => cancelAnimationFrame(frame);
  }, [points, range]);

  // The mark follows the cursor of the profile. This effect comes after the one
  // above, so a new track has its map before its mark.
  useEffect(() => {
    wanted.current = { km: markerKm, zone: markerZone };
    place(layers.current, index, wanted.current);
  }, [index, markerKm, markerZone]);

  // A <section> with a name is a region. `isolate` keeps the layers of Leaflet
  // (which go up to z-index 1000) under whatever the page puts over the content.
  return (
    <>
      {/* The gradient of the line of the track: the dawn, across the box of the track, from its
          north-west corner (peach) to its south-east one (violet), whichever way the race runs. */}
      <svg aria-hidden="true" width="0" height="0" className="absolute">
        <defs>
          <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--map-line-from)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--map-line-via)" }} />
            <stop offset="1" style={{ stopColor: "var(--map-line-to)" }} />
          </linearGradient>
        </defs>
      </svg>
      <div ref={gate} className="relative isolate">
        <section
          ref={element}
          aria-label={t.route.map}
          aria-describedby={help}
          className={`track-map isolate ${MAP_BOX}`}
        />
        <p id={help} className="sr-only">
          {t.route.mapHelp(key)}
        </p>
        {/* The hint: over the map, for the eye only, and it takes no pointer. */}
        {hint === null ? null : (
          <div
            aria-hidden="true"
            className="track-hint pointer-events-none absolute inset-0 flex items-center justify-center rounded-[1.25rem] bg-black/55 p-4 text-center text-base font-semibold text-white"
          >
            {hint}
          </div>
        )}
      </div>
    </>
  );
}
