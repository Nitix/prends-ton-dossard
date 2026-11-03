import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
} from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { simplify, type TrackPoint } from "./gpx";
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

type WithAltitude = TrackPoint & { ele: number };

/** The coordinates of a point of the path, to a tenth of a unit. */
const coordinates = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * Half the length over which a slope is read, in kilometers: 1 % of the track
 * (at least 75 m), a band and a half, so that the noise of the GPS does not
 * stripe the profile. It depends on the track only, never on the screen.
 */
const slopeHalf = (lastKm: number) => Math.max(lastKm / 100, 0.075);

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
 * Runs of the track in the same zone of slope: the track is cut in bands of
 * `BAND_PX`, the gradient of each band is worked out from the altitudes at its
 * two ends, and the neighbouring bands of the same zone are joined.
 */
function slopeRuns(
  points: WithAltitude[],
  lastKm: number,
): { from: number; to: number; zone: SlopeZone }[] {
  const count = RUNS;
  const band = lastKm / count;
  const half = slopeHalf(lastKm);
  const zones = Array.from({ length: count }, (_, i) => {
    const middle = band * (i + 0.5);
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
    if (previous && previous.zone === zone) previous.to = band * (i + 1);
    else runs.push({ from: band * i, to: band * (i + 1), zone });
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
 * Pass the whole track: it is reduced to 1 000 points here. `label` is the
 * accessible name of the drawing, which says the numbers.
 */
export function ElevationProfile({ points, ...profile }: ProfileProps & { points: TrackPoint[] }) {
  // The points that have an altitude, which are then at most 1 000.
  const drawn = useMemo(
    () => simplify(points.filter((p): p is WithAltitude => p.ele !== undefined)),
    [points],
  );
  const lastKm = drawn.at(-1)?.km ?? 0;
  if (drawn.length < 2 || !(lastKm > 0)) return null;
  return <Profile drawn={drawn} lastKm={lastKm} {...profile} />;
}

type ProfileProps = {
  label: string;
  cursorKm?: number | null;
  onCursorKm?: (km: number | null) => void;
  onCursorZone?: (zone: SlopeZone | null) => void;
};

/** The drawing of `ElevationProfile`, for a track that has one: two points with an altitude at least, and a length. */
function Profile({
  drawn,
  lastKm,
  label,
  cursorKm,
  onCursorKm,
  onCursorZone,
}: ProfileProps & { drawn: WithAltitude[]; lastKm: number }) {
  const { t, f, formatLocale } = useI18n();
  const [box, width] = useWidth<HTMLDivElement>();
  const [ownCursor, setOwnCursor] = useState<number | null>(null);
  const clipId = useId();

  // The cursor is the page's when it drives it, the profile's otherwise; the
  // page is told whenever the cursor moves on the profile.
  const cursor = cursorKm === undefined ? ownCursor : cursorKm;
  const setCursor = (km: number | null) => {
    setOwnCursor(km);
    onCursorKm?.(km);
  };

  const plotWidth = Math.max(120, width - MARGIN.left - MARGIN.right);
  const altitudes = drawn.map((p) => p.ele);
  const scale = altitudeScale(Math.min(...altitudes), Math.max(...altitudes));
  const kilometers = distanceTicks(lastKm);

  const x = (km: number) => MARGIN.left + (km / lastKm) * plotWidth;
  const y = (ele: number) =>
    MARGIN.top + (1 - (ele - scale.from) / (scale.to - scale.from)) * PLOT_HEIGHT;
  const bottom = MARGIN.top + PLOT_HEIGHT;

  const line = drawn
    .map((p, i) => `${i === 0 ? "M" : "L"}${coordinates(x(p.km), y(p.ele))}`)
    .join(" ");
  const first = drawn[0];
  const area = `${line} L${coordinates(x(lastKm), bottom)} L${coordinates(x(first?.km ?? 0), bottom)} Z`;
  const runs = slopeRuns(drawn, lastKm);

  // The labels of the kilometers stay in the drawing (the first starts at its
  // tick, one that would pass the right edge ends at it), and one that would
  // touch the label before it is left out: its tick stays.
  const kmLabels: { km: number; anchor: "start" | "middle" | "end"; shown: boolean }[] = [];
  for (const [i, km] of kilometers.entries()) {
    const wide = f.km(km).length * LABEL_FONT_SIZE * 0.6;
    const centre = x(km);
    const anchor = i === 0 ? "start" : centre + wide / 2 > width - 2 ? "end" : "middle";
    const left = anchor === "start" ? centre : anchor === "end" ? centre - wide : centre - wide / 2;
    const previous = kmLabels.findLast((mark) => mark.shown);
    const previousRight = previous
      ? labelRight(previous, x, f.km(previous.km).length * LABEL_FONT_SIZE * 0.6)
      : -Infinity;
    kmLabels.push({ km, anchor, shown: left > previousRight + 6 });
  }

  // The highest point, named on the drawing.
  const summit = drawn.reduce(
    (best, p) => (p.ele > best.ele ? p : best),
    drawn[0] ?? { km: 0, ele: 0, lat: 0, lon: 0 },
  );

  const percent = new Intl.NumberFormat(formatLocale, {
    style: "unit",
    unit: "percent",
    maximumFractionDigits: 0,
  });
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

  // The cursor: the distance, the altitude there, and the slope around it, read
  // as the bands are; its dot takes the colour of the band under it.
  const reading = (at: number) => {
    const km = Math.min(lastKm, Math.max(0, at));
    const ele = altitudeAt(drawn, km);
    const half = slopeHalf(lastKm);
    const from = Math.max(0, km - half);
    const to = Math.min(lastKm, km + half);
    const slope = ((altitudeAt(drawn, to) - altitudeAt(drawn, from)) / ((to - from) * 1000)) * 100;
    const zone = runs.find((run) => km <= run.to)?.zone ?? slopeZone(slope);
    // A slope that rounds to nothing is 0: not "-0 %" (a gentle descent, or the
    // noise of the floats on the flat). `+ 0` turns -0 into 0.
    return { km, ele, slope: Number.isFinite(slope) ? Math.round(slope) + 0 : 0, zone };
  };
  const at = cursor === null ? null : reading(cursor);
  const said = at ?? reading(0);
  const saidKm = f.km(Math.round(said.km * 10) / 10);

  // The zone under the cursor, told before the page is painted: the mark of the
  // map takes its colour along with the dot of the profile.
  const cursorZone = at?.zone ?? null;
  useLayoutEffect(() => {
    onCursorZone?.(cursorZone);
  }, [onCursorZone, cursorZone]);

  // The cursor's range goes a little beyond both ends of the track, as its box beyond the plot.
  const bleed = (CURSOR_BLEED / plotWidth) * lastKm;
  const clamp = (km: number) => Math.min(lastKm, Math.max(0, km));
  // A pointer that moves over the profile (without a button pressed, too) puts the cursor under it.
  const follow = (event: PointerEvent<HTMLInputElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientX - rect.left) / rect.width;
    setCursor(clamp(-bleed + ratio * (lastKm + 2 * bleed)));
  };
  // The arrows, Page Up and Down, Home and End are the range's own; Escape puts the cursor away.
  const press = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Escape" || cursor === null) return;
    event.preventDefault();
    setCursor(null);
  };

  return (
    <div className="elevation-profile flex flex-col gap-2.5">
      <div ref={box} className="profile-chart relative w-full">
        <svg
          // A drawing in SVG has no <img> to stand for it: role="img" makes it a picture.
          // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
          role="img"
          aria-label={label}
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
          {kmLabels.map(({ km, anchor, shown }) => (
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
              {shown && (
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
          aria-valuetext={t.route.profileReading(
            saidKm,
            f.meters(said.ele),
            percent.format(said.slope),
          )}
          min={-bleed}
          max={lastKm + bleed}
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
          onPointerMove={follow}
          onPointerDown={follow}
          onPointerLeave={(event) => {
            // Away from a pointer, unless the keyboard is on it.
            if (document.activeElement !== event.currentTarget) setCursor(null);
          }}
          onKeyDown={press}
          onFocus={() => {
            // From the keyboard, the cursor shows at the start; a finger, a pointer or the map has already put it.
            if (cursor === null) setCursor(0);
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
            ? `${f.km(Math.round(at.km * 10) / 10)} · ${f.meters(at.ele)} · ${percent.format(at.slope)}`
            : f.meters(summit.ele)}
        </p>
      </div>
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
