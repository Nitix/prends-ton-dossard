import { useI18n } from "../../i18n/I18nProvider";
import { simplify, type TrackPoint } from "./gpx";
import { altitudeScale, distanceTicks } from "./ticks";

// The size of the drawing, in the units of its viewBox, and the room around the
// plot for the labels of the graduations. It is shown at the width of its
// container, up to `max-w-md`, which is about 1 to 1 on a phone.
const WIDTH = 360;
const HEIGHT = 180;
const MARGIN = { top: 10, right: 20, bottom: 28, left: 54 };
const PLOT_WIDTH = WIDTH - MARGIN.left - MARGIN.right;
const PLOT_HEIGHT = HEIGHT - MARGIN.top - MARGIN.bottom;
const TICK_LENGTH = 4;
const LABEL_FONT_SIZE = 11;

type WithAltitude = TrackPoint & { ele: number };

/** The coordinates of a point of the path, to a tenth of a unit. */
const coordinates = (x: number, y: number): string => `${x.toFixed(1)} ${y.toFixed(1)}`;

/**
 * The elevation profile of a track, drawn in SVG: the altitude along the
 * distance, as a line over an area, with the graduations in kilometers (4 to 6)
 * and in meters (3 to 5) at round numbers. Nothing when there is nothing to
 * draw: no point has an altitude (a track without them has no profile), or the
 * track has no length. The scale of the altitudes does not start at 0: it
 * frames the track, and its graduations say where it is.
 *
 * Pass the whole track: it is reduced to 1 000 points here. `label` is the
 * accessible name of the drawing, which says the numbers. The line, the area and
 * the labels take the colours of a neutral theme and mean nothing by them.
 */
export function ElevationProfile({ points, label }: { points: TrackPoint[]; label: string }) {
  const { f } = useI18n();

  // The points that have an altitude, which are then at most 1 000.
  const drawn = simplify(points.filter((p): p is WithAltitude => p.ele !== undefined));
  const lastKm = drawn.at(-1)?.km ?? 0;
  if (drawn.length < 2 || !(lastKm > 0)) return null;

  const altitudes = drawn.map((p) => p.ele);
  const scale = altitudeScale(Math.min(...altitudes), Math.max(...altitudes));
  const kilometers = distanceTicks(lastKm);

  const x = (km: number) => MARGIN.left + (km / lastKm) * PLOT_WIDTH;
  const y = (ele: number) =>
    MARGIN.top + (1 - (ele - scale.from) / (scale.to - scale.from)) * PLOT_HEIGHT;
  const bottom = MARGIN.top + PLOT_HEIGHT;

  const line = drawn
    .map((p, i) => `${i === 0 ? "M" : "L"}${coordinates(x(p.km), y(p.ele))}`)
    .join(" ");
  const first = drawn[0];
  const area = `${line} L${coordinates(x(lastKm), bottom)} L${coordinates(x(first?.km ?? 0), bottom)} Z`;

  return (
    <svg
      // A drawing in SVG has no <img> to stand for it: role="img" makes it a picture.
      // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="block h-auto w-full max-w-md text-neutral-800"
    >
      {/* The grid: one hairline for each graduation in meters, the lowest one is the baseline. */}
      {scale.ticks.map((ele, i) => (
        <line
          key={ele}
          x1={MARGIN.left}
          x2={MARGIN.left + PLOT_WIDTH}
          y1={y(ele)}
          y2={y(ele)}
          className={i === 0 ? "stroke-neutral-500" : "stroke-neutral-200"}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      <path d={area} fill="currentColor" fillOpacity={0.1} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      {scale.ticks.map((ele) => (
        <text
          key={ele}
          x={MARGIN.left - 6}
          y={y(ele)}
          dy="0.35em"
          textAnchor="end"
          fontSize={LABEL_FONT_SIZE}
          className="fill-neutral-600"
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
            className="stroke-neutral-500"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <text
            x={x(km)}
            y={bottom + TICK_LENGTH + 4}
            dy="0.8em"
            textAnchor="middle"
            fontSize={LABEL_FONT_SIZE}
            className="fill-neutral-600"
          >
            {f.km(km)}
          </text>
        </g>
      ))}
    </svg>
  );
}
