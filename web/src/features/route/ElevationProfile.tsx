import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import { SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { coarsePointer } from "./gestures";
import { simplify, type TrackPoint } from "./gpx";
import { clampRange, MIN_SPAN_KM, pointsIn, zoomAround, type KmRange } from "./range";
import { SLOPE_FILLS, SLOPE_STEPS, SLOPE_ZONES, slopeZone, type SlopeZone } from "./slope";
import { altitudeScale, distanceTicks } from "./ticks";

// The height of the drawing and the room around the plot for the labels of the
// graduations, in pixels. Its width is the one of its container: the drawing is
// measured, so that its labels keep their size from a phone to a wide screen.
const HEIGHT = 212;
const MARGIN = { top: 30, right: 20, bottom: 28, left: 56 };
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TICK_LENGTH = 4;
const LABEL_FONT_SIZE = 11;
/** The width before it is measured: about a phone's. */
const FIRST_WIDTH = 340;
/**
 * How many bands of slope the profile is cut into, whatever its width: a phone
 * and a wide screen read the same slopes (a band is about 5 px wide on a
 * computer, under 2 on a phone).
 */
const RUNS = 150;
/** How far the box of the cursor goes beyond the plot on each side, in pixels. */
const CURSOR_BLEED = 4;
/** How far a drag has to go, in pixels, to choose a portion and not to place the cursor. */
const MIN_DRAG_PX = 8;
/** What a button of zoom, a key or a spread of fingers does to the length of the portion: twice shorter, twice longer. */
const ZOOM_FACTOR = 0.5;
/** The least time between two steps of zoom by the wheel, in milliseconds. */
const WHEEL_STEP_MS = 120;

type WithAltitude = TrackPoint & { ele: number };

/** The coordinates of a point of the path, to a tenth of a unit. */
const coordinates = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** The shortest half-length over which a slope is read once zoomed, in kilometers: 25 m. */
const MIN_SLOPE_HALF_KM = 0.025;
/** The same on the whole track, as it was before the zoom: 75 m, so a short track is read as it always was. */
const MIN_WHOLE_SLOPE_HALF_KM = 0.075;

/**
 * Half the length over which a slope is read around a kilometer, in kilometers:
 * 1 % of the portion shown, at least 25 m (75 m on the whole track, `whole`) and at
 * least the gap between the points there (a slope needs two of them), so that the
 * noise of the GPS does not stripe the profile while the colours get finer as one
 * zooms. On the whole track it is as it always was, 1 % of the track and at least
 * 75 m (so the same on any track); on 200 m it is 25 m.
 */
function slopeHalf(points: WithAltitude[], km: number, span: number, whole: boolean): number {
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((points[middle]?.km ?? 0) <= km) low = middle;
    else high = middle;
  }
  const gap = (points[high]?.km ?? 0) - (points[low]?.km ?? 0);
  const floor = whole ? MIN_WHOLE_SLOPE_HALF_KM : MIN_SLOPE_HALF_KM;
  return Math.max(span / 100, floor, Number.isFinite(gap) ? gap : 0);
}

/**
 * The altitude at a distance, between the two points around it: a mean of the
 * two, weighted by the distance, which stays between them (their difference
 * could overflow, and `Infinity × 0` is no altitude).
 */
function altitudeAt(points: WithAltitude[], km: number): number {
  let low = 0;
  let high = points.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if ((points[middle]?.km ?? 0) <= km) low = middle;
    else high = middle;
  }
  const a = points[low];
  const b = points[high];
  if (!a || !b) return a?.ele ?? b?.ele ?? 0;
  if (b.km === a.km) return a.ele;
  const ratio = Math.min(1, Math.max(0, (km - a.km) / (b.km - a.km)));
  return a.ele * (1 - ratio) + b.ele * ratio;
}

/**
 * Runs of the track in the same zone of slope: the portion shown is cut in `RUNS` bands, the gradient of each band is worked out from the altitudes at its
 * two ends, and the neighbouring bands of the same zone are joined.
 */
function slopeRuns(
  points: WithAltitude[],
  view: KmRange,
  lastKm: number,
  whole: boolean,
): { from: number; to: number; zone: SlopeZone }[] {
  const count = RUNS;
  const band = (view.to - view.from) / count;
  const zones = Array.from({ length: count }, (_, i) => {
    const middle = view.from + band * (i + 0.5);
    const half = slopeHalf(points, middle, view.to - view.from, whole);
    const from = Math.max(0, middle - half);
    const to = Math.min(lastKm, middle + half);
    const percent =
      ((altitudeAt(points, to) - altitudeAt(points, from)) / ((to - from) * 1000)) * 100;
    return slopeZone(Number.isFinite(percent) ? percent : 0);
  });
  // A band alone between two of another zone takes theirs: it is a hiccup, not a slope.
  for (let i = 1; i < count - 1; i++) {
    const before = zones[i - 1];
    if (before !== undefined && before === zones[i + 1] && zones[i] !== before) zones[i] = before;
  }
  const runs: { from: number; to: number; zone: SlopeZone }[] = [];
  zones.forEach((zone, i) => {
    const previous = runs.at(-1);
    if (previous && previous.zone === zone) previous.to = view.from + band * (i + 1);
    else runs.push({ from: view.from + band * i, to: view.from + band * (i + 1), zone });
  });
  return runs;
}

/** Where the label of a graduation ends on the right, by its anchor. */
function labelRight(
  label: { km: number; anchor: "start" | "middle" | "end" },
  x: (km: number) => number,
  wide: number,
): number {
  const centre = x(label.km);
  if (label.anchor === "start") return centre + wide;
  if (label.anchor === "end") return centre;
  return centre + wide / 2;
}

/** How often the live region of the portion speaks during a gesture, at most, in milliseconds. */
const SAY_MS = 500;

/**
 * A value that changes at most once in `ms`: the first change is at once, the
 * ones that follow within the delay give way to the latest, at its end.
 */
function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    if (shown === value) return undefined;
    const wait = Math.max(0, last.current + ms - Date.now());
    const timer = setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, ms]);
  return shown;
}

/** The width of an element, followed as it changes. */
function useWidth<E extends HTMLElement>(): [RefObject<E | null>, number] {
  const ref = useRef<E>(null);
  const [width, setWidth] = useState(FIRST_WIDTH);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => {
      const measured = Math.round(element.getBoundingClientRect().width);
      if (measured > 0) setWidth(measured);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
    };
  }, []);
  return [ref, width];
}

/**
 * The elevation profile of a track, drawn in SVG: the altitude along the
 * distance, as an ink line over an area coloured by the slope, in five zones
 * (under 5 %, 5 to 10, 10 to 15, 15 to 25, 25 % and more, up or down), with
 * the graduations in kilometers (4 to 6) and in meters (3 to 5) at round
 * numbers, the highest point named with its altitude, and a legend of the
 * zones under it. Nothing when there is nothing to draw: no point has an
 * altitude (a track without them has no profile), or the track has no length.
 * The scale of the altitudes does not start at 0: it frames the track, and its
 * graduations say where it is.
 *
 * A cursor gives the distance, the altitude and the slope where it is: it
 * follows a finger or a pointer, and the arrow keys once the profile has the
 * focus (Home and End go to the start and the finish, Escape puts it away). It
 * adds to the picture: the numbers of the track are written beside it.
 *
 * The page can drive the cursor (the map of the track moves it, see
 * RouteSection): with `cursorKm`, the cursor is where it says (`null`: none),
 * with the same figures and the same words for a screen reader, and
 * `onCursorKm` is told where the cursor goes on the profile (pointer, finger,
 * keys; `null` when it goes away). Without `cursorKm`, the profile keeps its
 * cursor itself. `onCursorZone` is told the zone of the slope under the cursor,
 * whatever moves it (`null` with no cursor), so that the map paints its mark in
 * the colour of the dot of the profile.
 *
 * The profile zooms on a portion of the track (`range`, in kilometers, `null`
 * for the whole track): a drag with a mouse or a pen, two fingers that spread
 * or draw together, the buttons under it, or the keys + and − when it has the
 * focus. The portion is redrawn from the points of the whole track (reduced to
 * 1 000 again), with the altitudes and the graduations of the portion; a slope
 * is read over the same length as in the whole view, so its colour never changes
 * with the zoom. With `range` the page holds the portion (and `onRange` is told
 * where it goes); without it, the profile keeps it itself.
 *
 * Pass the whole track: it is reduced to 1 000 points here. `label` is the
 * accessible name of the drawing, which says the numbers.
 */
export function ElevationProfile({ points, ...profile }: ProfileProps & { points: TrackPoint[] }) {
  // The points that have an altitude.
  const all = useMemo(() => points.filter((p): p is WithAltitude => p.ele !== undefined), [points]);
  // The whole track, at most 1 000 points.
  const drawn = useMemo(() => simplify(all), [all]);
  const lastKm = all.at(-1)?.km ?? 0;
  if (drawn.length < 2 || !(lastKm > 0)) return null;
  return <Profile all={all} drawn={drawn} lastKm={lastKm} {...profile} />;
}

type ProfileProps = {
  label: string;
  cursorKm?: number | null;
  onCursorKm?: (km: number | null) => void;
  onCursorZone?: (zone: SlopeZone | null) => void;
  range?: KmRange | null;
  onRange?: (range: KmRange | null) => void;
};

/** The drawing of `ElevationProfile`, for a track that has one: two points with an altitude at least, and a length. */
function Profile({
  all,
  drawn,
  lastKm,
  label,
  cursorKm,
  onCursorKm,
  onCursorZone,
  range: rangeProp,
  onRange,
}: ProfileProps & { all: WithAltitude[]; drawn: WithAltitude[]; lastKm: number }) {
  const { t, f, formatLocale } = useI18n();
  const [box, width] = useWidth<HTMLDivElement>();
  const [ownCursor, setOwnCursor] = useState<number | null>(null);
  const [ownRange, setOwnRange] = useState<KmRange | null>(null);
  const clipId = useId();
  const helpId = useId();

  // The cursor is the page's when it drives it, the profile's otherwise; the
  // page is told whenever the cursor moves on the profile.
  const cursor = cursorKm === undefined ? ownCursor : cursorKm;
  const setCursor = (km: number | null) => {
    setOwnCursor(km);
    onCursorKm?.(km);
  };

  // The portion shown, the same way: the page's, or the profile's own.
  const range = rangeProp === undefined ? ownRange : rangeProp;
  // The latest portion, for gestures that come faster than a render.
  const latest = useRef<KmRange | null>(range);
  useLayoutEffect(() => {
    latest.current = range;
  });
  // Whether the portion was put back to the whole track, which the <output> then says.
  const [wasReset, setWasReset] = useState(false);
  const setRange = (next: KmRange | null) => {
    latest.current = next;
    setWasReset(next === null);
    setOwnRange(next);
    onRange?.(next);
  };
  const viewFrom = range?.from ?? 0;
  const viewTo = range?.to ?? lastKm;
  const view: KmRange = { from: viewFrom, to: viewTo };
  const span = view.to - view.from;
  const zoomed = range !== null;

  // What is drawn: the points of the portion, read in the whole track and reduced to 1 000 again.
  const shown = useMemo(
    () => (range === null ? drawn : simplify(pointsIn(all, range))),
    [all, drawn, range],
  );

  const plotWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
  const altitudes = shown.map((p) => p.ele);
  const scale = altitudeScale(Math.min(...altitudes), Math.max(...altitudes));
  const kilometers = useMemo(() => distanceTicks(viewFrom, viewTo), [viewFrom, viewTo]);

  const x = (km: number) => MARGIN.left + ((km - view.from) / span) * plotWidth;
  const y = (ele: number) =>
    MARGIN.top + (1 - (ele - scale.from) / (scale.to - scale.from)) * PLOT_HEIGHT;
  const bottom = MARGIN.top + PLOT_HEIGHT;

  // The drawing is worked out again when the points, the portion or the width change, not at
  // every move of a pointer (which only moves the cursor or the band).
  const { line, area } = useMemo(() => {
    const drawing = shown
      .map((p, i) => `${i === 0 ? "M" : "L"}${coordinates(x(p.km), y(p.ele))}`)
      .join(" ");
    return {
      line: drawing,
      area: `${drawing} L${coordinates(x(shown.at(-1)?.km ?? viewTo), bottom)} L${coordinates(x(shown[0]?.km ?? viewFrom), bottom)} Z`,
    };
    // x and y are functions of exactly the values listed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, viewFrom, viewTo, plotWidth, scale.from, scale.to]);
  const runs = useMemo(
    () => slopeRuns(all, { from: viewFrom, to: viewTo }, lastKm, !zoomed),
    [all, viewFrom, viewTo, lastKm, zoomed],
  );

  // The labels of the kilometers stay in the drawing (the first starts at its
  // tick when it is at the left edge, one that would pass the right edge ends at
  // it), and one that would touch the label before it is left out: its tick stays.
  const kmLabels = useMemo(() => {
    const labels: { km: number; anchor: "start" | "middle" | "end"; shown: boolean }[] = [];
    for (const [i, km] of kilometers.entries()) {
      const wide = f.km(km).length * LABEL_FONT_SIZE * 0.6;
      const centre = x(km);
      const anchor =
        i === 0 && centre - wide / 2 < MARGIN.left
          ? "start"
          : centre + wide / 2 > width - 2
            ? "end"
            : "middle";
      const left =
        anchor === "start" ? centre : anchor === "end" ? centre - wide : centre - wide / 2;
      const previous = labels.findLast((mark) => mark.shown);
      const previousRight = previous
        ? labelRight(previous, x, f.km(previous.km).length * LABEL_FONT_SIZE * 0.6)
        : -Infinity;
      labels.push({ km, anchor, shown: left > previousRight + 6 });
    }
    return labels;
    // x is a function of exactly the values listed.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [kilometers, viewFrom, viewTo, plotWidth, width, f]);

  // The highest point, named on the drawing.
  const summit = shown.reduce(
    (best, p) => (p.ele > best.ele ? p : best),
    shown[0] ?? { km: 0, ele: 0, lat: 0, lon: 0 },
  );

  const percent = new Intl.NumberFormat(formatLocale, {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 0,
    // A slope that rounds to zero is « 0 % », whatever the sign it had (Firefox shows « -0 % »).
    signDisplay: "negative",
  });
  // A slope that rounds to zero is « 0 % », never « -0 % » (Firefox writes it, whatever signDisplay):
  // the number is rounded here, and `+ 0` makes a negative zero a zero.
  const pct = (slope: number) => percent.format(Math.sign(slope) * Math.round(Math.abs(slope)) + 0);
  const legend = SLOPE_ZONES.map((zone, i) => {
    const low = i === 0 ? undefined : SLOPE_STEPS[i - 1];
    const high = SLOPE_STEPS[i];
    const text =
      low === undefined
        ? `< ${percent.format(high ?? 0)}`
        : high === undefined
          ? `≥ ${percent.format(low)}`
          : percent.formatRange(low, high);
    return { zone, text };
  });

  // The portion in words: "Du km 12,4 au km 18,0".
  const oneDecimal = new Intl.NumberFormat(formatLocale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const rangeText = range
    ? t.route.profileRange(oneDecimal.format(range.from), oneDecimal.format(range.to))
    : "";
  // What the live region says: the portion, or that the whole profile is back. A pinch changes
  // it at every move of the fingers: it is said a few times a second at most.
  const spoken = useThrottled(range ? rangeText : wasReset ? t.route.profileWhole : "", SAY_MS);

  // The cursor: the distance, the altitude there, and the slope around it, read
  // as the bands are; its dot takes the colour of the band under it. It stays in the portion.
  const clamp = (km: number) => Math.min(view.to, Math.max(view.from, km));
  const reading = (at: number) => {
    const km = clamp(at);
    const ele = altitudeAt(all, km);
    const half = slopeHalf(all, km, span, !zoomed);
    const from = Math.max(0, km - half);
    const to = Math.min(lastKm, km + half);
    const slope = ((altitudeAt(all, to) - altitudeAt(all, from)) / ((to - from) * 1000)) * 100;
    const zone = runs.find((run) => km <= run.to)?.zone ?? slopeZone(slope);
    // A slope that rounds to nothing is 0: not "-0 %" (a gentle descent, or the
    // noise of the floats on the flat). `+ 0` turns -0 into 0.
    return { km, ele, slope: Number.isFinite(slope) ? Math.round(slope) + 0 : 0, zone };
  };
  const at = cursor === null ? null : reading(cursor);
  const said = at ?? reading(view.from);
  const saidKm = f.km(Math.round(said.km * 10) / 10);

  // The zone under the cursor, told before the page is painted: the mark of the
  // map takes its colour along with the dot of the profile.
  const cursorZone = at?.zone ?? null;
  useLayoutEffect(() => {
    onCursorZone?.(cursorZone);
  }, [onCursorZone, cursorZone]);

  // The cursor's range goes a little beyond both ends of the portion, as its box beyond the plot.
  const bleed = (CURSOR_BLEED / plotWidth) * span;
  /** The kilometer under a pointer, by its place on the cursor's range. */
  const kmUnder = (clientX: number, rect: DOMRect, shownRange: KmRange = view) => {
    const length = shownRange.to - shownRange.from;
    const margin = (CURSOR_BLEED / plotWidth) * length;
    return Math.min(
      shownRange.to,
      Math.max(
        shownRange.from,
        shownRange.from - margin + ((clientX - rect.left) / rect.width) * (length + 2 * margin),
      ),
    );
  };
  // A pointer that moves over the profile (without a button pressed, too) puts the cursor under it.
  const follow = (event: PointerEvent<HTMLInputElement>) => {
    setCursor(kmUnder(event.clientX, event.currentTarget.getBoundingClientRect()));
  };

  // Zooming: around the cursor when it is on the portion, around its middle otherwise.
  const zoomBy = (factor: number, around?: number) => {
    const centre = around ?? (cursor === null ? (view.from + view.to) / 2 : clamp(cursor));
    setRange(zoomAround(latest.current, centre, factor, lastKm));
  };
  const canZoomIn = span > MIN_SPAN_KM + 1e-9;

  // Ctrl or ⌘ + wheel zooms the profile around the pointer, by the step of the
  // buttons, as it does on the map; it never zooms the page, which is why the
  // listener is not passive. The wheel alone is the page's: it scrolls it. A
  // trackpad's pinch sends a stream of them: one step each WHEEL_STEP_MS at most.
  const onWheel = useRef<(event: WheelEvent) => void>(() => undefined);
  const lastWheel = useRef(-Infinity);
  useLayoutEffect(() => {
    onWheel.current = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      if (event.deltaY === 0 || event.timeStamp - lastWheel.current < WHEEL_STEP_MS) return;
      const zoomIn = event.deltaY < 0;
      if (zoomIn ? !canZoomIn : !zoomed) return;
      lastWheel.current = event.timeStamp;
      const rect = box.current?.querySelector(".profile-cursor")?.getBoundingClientRect();
      const around = rect
        ? kmUnder(event.clientX, rect, latest.current ?? { from: 0, to: lastKm })
        : undefined;
      zoomBy(zoomIn ? ZOOM_FACTOR : 1 / ZOOM_FACTOR, around);
    };
  });
  useEffect(() => {
    const element = box.current;
    if (!element) return undefined;
    const listener = (event: WheelEvent) => {
      onWheel.current(event);
    };
    element.addEventListener("wheel", listener, { passive: false });
    return () => {
      element.removeEventListener("wheel", listener);
    };
  }, [box]);

  // A drag with a mouse or a pen draws a band, which becomes the portion when
  // it is long enough; fingers: one moves the cursor, two spread to zoom.
  const [band, setBand] = useState<{ from: number; to: number } | null>(null);
  const drag = useRef<{ id: number; x: number; km: number } | null>(null);
  const fingers = useRef(new Map<number, { x: number }>());
  const spread = useRef<number | null>(null);
  const pressDown = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === "touch") {
      fingers.current.set(event.pointerId, { x: event.clientX });
      if (fingers.current.size === 2) {
        const [a, b] = [...fingers.current.values()];
        spread.current = Math.abs((a?.x ?? 0) - (b?.x ?? 0));
        return;
      }
    } else if (event.button === 0) {
      const km = kmUnder(event.clientX, rect);
      drag.current = { id: event.pointerId, x: event.clientX, km };
      setBand({ from: km, to: km });
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // No such pointer (a script's): the events still come while it is over the profile.
      }
    }
    follow(event);
  };
  const pressMove = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (event.pointerType === "touch" && fingers.current.has(event.pointerId)) {
      fingers.current.set(event.pointerId, { x: event.clientX });
      if (fingers.current.size >= 2 && spread.current !== null) {
        const [a, b] = [...fingers.current.values()];
        const now = Math.abs((a?.x ?? 0) - (b?.x ?? 0));
        if (now > 0 && spread.current > 0) {
          // Fingers that spread make the portion shorter: the ratio of the old gap to the new.
          const middle = ((a?.x ?? 0) + (b?.x ?? 0)) / 2;
          // Read in the latest portion, the one that the zoom starts from (a render may be behind).
          zoomBy(
            spread.current / now,
            kmUnder(middle, rect, latest.current ?? { from: 0, to: lastKm }),
          );
        }
        if (now > 0) spread.current = now;
        return;
      }
    }
    if (drag.current?.id === event.pointerId) {
      setBand({ from: drag.current.km, to: kmUnder(event.clientX, rect) });
    }
    follow(event);
  };
  // The focus is being given by a click, which has put the cursor where it was.
  const focusedByPointer = useRef(false);
  const pressUp = (event: PointerEvent<HTMLInputElement>) => {
    if (event.pointerType === "touch") {
      fingers.current.delete(event.pointerId);
      if (fingers.current.size < 2) spread.current = null;
    }
    // Safari does not give the focus to a range that is clicked, and takes it from the page on
    // the press: the arrows, Home and End would go nowhere. It is given once the press is over.
    if (event.type === "pointerup" && event.pointerType !== "touch") {
      focusedByPointer.current = true;
      event.currentTarget.focus({ preventScroll: true });
      focusedByPointer.current = false;
    }
    const started = drag.current;
    if (started?.id !== event.pointerId) return;
    drag.current = null;
    setBand(null);
    if (event.type === "pointercancel") return;
    const rect = event.currentTarget.getBoundingClientRect();
    const end = kmUnder(event.clientX, rect);
    const low = Math.min(started.km, end);
    const high = Math.max(started.km, end);
    if (Math.abs(event.clientX - started.x) >= MIN_DRAG_PX && high - low >= MIN_SPAN_KM) {
      const chosen = clampRange({ from: low, to: high }, lastKm);
      setRange(chosen.from <= 0 && chosen.to >= lastKm ? null : chosen);
    }
  };

  // The arrows, Page Up and Down, Home and End are the range's own; Escape puts
  // the cursor away; + and − zoom.
  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      if (canZoomIn) zoomBy(ZOOM_FACTOR);
    } else if (event.key === "-" || event.key === "−") {
      event.preventDefault();
      if (zoomed) zoomBy(1 / ZOOM_FACTOR);
    } else if (event.key === "Escape" && cursor !== null) {
      event.preventDefault();
      setCursor(null);
    }
  };

  const button = `${SECONDARY} inline-flex items-center justify-center aria-disabled:cursor-default aria-disabled:opacity-60`;
  const fine = !coarsePointer();

  return (
    <div className="elevation-profile flex flex-col gap-2.5">
      <div ref={box} className="profile-chart relative w-full">
        <svg
          // A drawing in SVG has no <img> to stand for it: role="img" makes it a picture.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="img"
          aria-label={rangeText === "" ? label : `${label}, ${rangeText}`}
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          className="block h-auto w-full"
        >
          <defs>
            <clipPath id={clipId}>
              <path d={area} />
            </clipPath>
          </defs>
          {/* The grid: one hairline for each graduation in meters, the lowest one is the baseline. */}
          {scale.ticks.map((ele, i) => (
            <line
              key={ele}
              x1={MARGIN.left}
              x2={MARGIN.left + plotWidth}
              y1={y(ele)}
              y2={y(ele)}
              className={
                i === 0 ? "profile-baseline stroke-neutral-400" : "profile-grid stroke-neutral-200"
              }
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
          ))}
          {/* The area under the line, in the zones of the slope. */}
          <g clipPath={`url(#${clipId})`}>
            {runs.map((run) => (
              <rect
                key={run.from}
                x={x(run.from)}
                y={MARGIN.top}
                width={Math.max(0.5, x(run.to) - x(run.from)) + 0.4}
                height={PLOT_HEIGHT}
                style={{ fill: SLOPE_FILLS[run.zone] }}
              />
            ))}
          </g>
          <path
            d={line}
            fill="none"
            className="profile-line stroke-relief"
            strokeWidth={1.75}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {scale.ticks.map((ele) => (
            <text
              key={ele}
              x={MARGIN.left - 8}
              y={y(ele)}
              dy="0.35em"
              textAnchor="end"
              fontSize={LABEL_FONT_SIZE}
              className="profile-label fill-neutral-600 tabular-nums forced-colors:fill-[CanvasText]"
            >
              {f.meters(ele)}
            </text>
          ))}
          {kmLabels.map(({ km, anchor, shown: visible }) => (
            <g key={km}>
              <line
                x1={x(km)}
                x2={x(km)}
                y1={bottom}
                y2={bottom + TICK_LENGTH}
                className="profile-tick stroke-neutral-400"
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              {visible && (
                <text
                  x={x(km)}
                  y={bottom + TICK_LENGTH + 4}
                  dy="0.8em"
                  textAnchor={anchor}
                  fontSize={LABEL_FONT_SIZE}
                  className="profile-label fill-neutral-600 tabular-nums forced-colors:fill-[CanvasText]"
                >
                  {f.km(km)}
                </text>
              )}
            </g>
          ))}
          {/* The summit: a dot with a ring of the card around it. */}
          <circle
            cx={x(summit.km)}
            cy={y(summit.ele)}
            r={4}
            className="profile-summit fill-relief stroke-card"
            strokeWidth={2}
          />
          {/* The band of a drag that chooses a portion: the colour of the theme, with an edge in the
              ink, which forced colours turn into the text's. */}
          {band && (
            <rect
              className="profile-selection stroke-relief"
              x={x(Math.min(band.from, band.to))}
              y={MARGIN.top}
              width={Math.abs(x(band.to) - x(band.from))}
              height={PLOT_HEIGHT}
              strokeWidth={1.5}
              strokeOpacity={0.7}
              pointerEvents="none"
            />
          )}
          {at && (
            <g>
              <line
                x1={x(at.km)}
                x2={x(at.km)}
                y1={MARGIN.top}
                y2={bottom}
                className="stroke-relief"
                strokeWidth={1}
                strokeOpacity={0.5}
              />
              <circle
                cx={x(at.km)}
                cy={y(at.ele)}
                r={5.5}
                style={{ fill: SLOPE_FILLS[at.zone] }}
                className="stroke-card"
                strokeWidth={2}
              />
            </g>
          )}
        </svg>
        {/* The cursor, a range over the plot with no thumb of its own: a little wider than the
            plot, so that its ends are easy to reach (what is beyond them is taken for them). */}
        <input
          type="range"
          aria-label={t.route.profileCursor}
          aria-describedby={helpId}
          aria-valuetext={t.route.profileReading(saidKm, f.meters(said.ele), pct(said.slope))}
          min={view.from - bleed}
          max={view.to + bleed}
          // No grid to snap to: an arrow moves the cursor by a hundredth of the range, Page Up and Down by a tenth.
          step="any"
          value={said.km}
          onChange={(event) => {
            setCursor(clamp(Number(event.currentTarget.value)));
          }}
          className="profile-cursor absolute top-0 m-0 cursor-crosshair touch-pan-y appearance-none rounded-xl bg-transparent focus-visible:outline-offset-0"
          style={{
            left: MARGIN.left - CURSOR_BLEED,
            width: plotWidth + 2 * CURSOR_BLEED,
            height: bottom + 4,
          }}
          onPointerMove={pressMove}
          onPointerDown={pressDown}
          onPointerUp={pressUp}
          onPointerCancel={pressUp}
          onPointerLeave={(event) => {
            // Away from a pointer, unless the keyboard is on it or a drag is going on.
            if (drag.current === null && document.activeElement !== event.currentTarget) {
              setCursor(null);
            }
          }}
          onKeyDown={press}
          onFocus={() => {
            // From the keyboard, the cursor shows at the start; a finger, a pointer or the map has already put it.
            if (cursor === null && !focusedByPointer.current) setCursor(view.from);
          }}
          onBlur={() => {
            setCursor(null);
          }}
        />
        {/* The highest altitude, over the summit; the cursor's figures in its place while it is there. */}
        <p
          aria-hidden="true"
          className="profile-reading pointer-events-none absolute -translate-x-1/2 -translate-y-full rounded-full bg-dawn-deep px-2 py-0.5 text-[0.75rem] font-semibold whitespace-nowrap text-dawn-deep-ink tabular-nums shadow-glow"
          style={{
            left: Math.min(
              Math.max(x(at ? at.km : summit.km), MARGIN.left + 44),
              MARGIN.left + plotWidth - 44,
            ),
            top: (at ? y(at.ele) : y(summit.ele)) - 9,
          }}
        >
          {at
            ? `${f.km(Math.round(at.km * 10) / 10)} · ${f.meters(at.ele)} · ${pct(at.slope)}`
            : f.meters(summit.ele)}
        </p>
      </div>
      {/* The zoom, for everyone and for the keyboard: a drag or a pinch is never the only way. */}
      <div className="profile-zoom flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          aria-label={t.route.zoomProfileInLabel}
          aria-disabled={canZoomIn ? undefined : true}
          onClick={() => {
            if (canZoomIn) zoomBy(ZOOM_FACTOR);
          }}
        >
          {t.route.zoomProfileIn}
        </button>
        <button
          type="button"
          className={button}
          aria-label={t.route.zoomProfileOutLabel}
          aria-disabled={zoomed ? undefined : true}
          onClick={() => {
            if (zoomed) zoomBy(1 / ZOOM_FACTOR);
          }}
        >
          {t.route.zoomProfileOut}
        </button>
        <button
          type="button"
          className={button}
          aria-label={t.route.zoomProfileAllLabel}
          aria-disabled={zoomed ? undefined : true}
          onClick={() => {
            if (zoomed) setRange(null);
          }}
        >
          {t.route.zoomProfileAll}
        </button>
        {/* The portion in words, said politely when it changes. */}
        <output className="profile-range text-sm text-neutral-700 tabular-nums">{spoken}</output>
      </div>
      <p id={helpId} className="profile-help text-sm text-neutral-600">
        {fine ? t.route.profileHelpFine : t.route.profileHelpCoarse}
      </p>
      {/* The legend of the zones of the slope: each colour with its words. */}
      <div
        aria-hidden="true"
        className="profile-legend flex flex-wrap items-center gap-x-3.5 gap-y-1.5 pl-1"
      >
        <span className="eyebrow">{t.route.slope}</span>
        {legend.map(({ zone, text }) => (
          <span
            key={zone}
            className="inline-flex items-center gap-1.5 text-[0.75rem] text-neutral-700 tabular-nums"
          >
            {/* Its colour stays in forced colours, where the system would wipe a background. */}
            <span
              className="inline-block h-2.5 w-4 rounded-full forced-color-adjust-none"
              style={{ backgroundColor: SLOPE_FILLS[zone] }}
            />
            {text}
          </span>
        ))}
      </div>
    </div>
  );
}
