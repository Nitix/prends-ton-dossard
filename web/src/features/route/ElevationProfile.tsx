import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { simplify, type TrackPoint } from "./gpx";
import { altitudeScale, distanceTicks } from "./ticks";

// The size of the drawing, in the units of its viewBox, and the room around the
// plot for the labels of the graduations. Its width follows the width of its
// container (a unit is a pixel), so the labels keep their size on a phone and
// on a large screen; before it is measured, it is about the width of a phone.
const DEFAULT_WIDTH = 360;
const HEIGHT = 180;
const MARGIN = { top: 12, right: 16, bottom: 28, left: 54 };
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TICK_LENGTH = 4;
const LABEL_FONT_SIZE = 11;

type WithAltitude = TrackPoint & { ele: number };

/** The coordinates of a point of the path, to a tenth of a unit. */
const coordinates = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/** The width of an element, in pixels, kept up to date as it changes. */
function useWidth<T extends Element>(): [RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const measured = Math.round(entry?.contentRect.width ?? 0);
      if (measured > 0) setWidth(measured);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * The elevation profile of a track, drawn in SVG: the altitude along the
 * distance, as a line in the colours of the dawn over a light wash of them,
 * with the graduations in kilometers (4 to 6) and in meters (3 to 5) at round
 * numbers. Nothing when there is nothing to draw: no point has an altitude (a
 * track without them has no profile), or the track has no length. The scale of
 * the altitudes does not start at 0: it frames the track, and its graduations
 * say where it is.
 *
 * Pass the whole track: it is reduced to 1 000 points here. `label` is the
 * accessible name of the drawing, which says the numbers. The colours of the
 * line and of the wash mean nothing by themselves: it is one series.
 */
export function ElevationProfile({ points, label }: { points: TrackPoint[]; label: string }) {
  const { f } = useI18n();
  const id = useId();
  const [box, width] = useWidth<HTMLDivElement>();

  // The points that have an altitude, which are then at most 1 000.
  const drawn = simplify(points.filter((p): p is WithAltitude => p.ele !== undefined));
  const lastKm = drawn.at(-1)?.km ?? 0;
  if (drawn.length < 2 || !(lastKm > 0)) return null;

  const plotWidth = width - MARGIN.left - MARGIN.right;
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
  const stroke = `${id}-stroke`;
  const wash = `${id}-wash`;

  return (
    <div ref={box} className="w-full">
      <svg
        // A drawing in SVG has no <img> to stand for it: role="img" makes it a picture.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={label}
        viewBox={`0 0 ${width} ${HEIGHT}`}
        className="block h-auto w-full"
      >
        <defs>
          {/* Along the distance: the dawn, from peach to violet (each step 3:1 at least on white). */}
          <linearGradient
            id={stroke}
            gradientUnits="userSpaceOnUse"
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1="0"
            y2="0"
          >
            <stop offset="0" stopColor="#e5622f" />
            <stop offset="0.5" stopColor="#d6336f" />
            <stop offset="1" stopColor="#5e4ae3" />
          </linearGradient>
          {/* Under the line, a wash that fades to nothing at the bottom. */}
          <linearGradient id={wash} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#ff7eb3" stopOpacity="0.28" />
            <stop offset="0.6" stopColor="#8b7cff" stopOpacity="0.1" />
            <stop offset="1" stopColor="#8b7cff" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {/* The grid: one hairline for each graduation in meters, the lowest one is the baseline. */}
        {scale.ticks.map((ele, i) => (
          <line
            key={ele}
            x1={MARGIN.left}
            x2={MARGIN.left + plotWidth}
            y1={y(ele)}
            y2={y(ele)}
            className={i === 0 ? "stroke-neutral-400" : "stroke-neutral-200"}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        <path d={area} fill={`url(#${wash})`} />
        <path
          d={line}
          fill="none"
          stroke={`url(#${stroke})`}
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {scale.ticks.map((ele) => (
          <text
            key={ele}
            x={MARGIN.left - 8}
            y={y(ele)}
            dy="0.35em"
            textAnchor="end"
            fontSize={LABEL_FONT_SIZE}
            className="fill-neutral-600 tabular-nums"
          >
            {f.meters(ele)}
          </text>
        ))}
        {kilometers.map((km) => (
          <g key={km}>
            <line
              x1={x(km)}
              x2={x(km)}
              y1={bottom}
              y2={bottom + TICK_LENGTH}
              className="stroke-neutral-400"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={x(km)}
              y={bottom + TICK_LENGTH + 4}
              dy="0.8em"
              textAnchor="middle"
              fontSize={LABEL_FONT_SIZE}
              className="fill-neutral-600 tabular-nums"
            >
              {f.km(km)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}
