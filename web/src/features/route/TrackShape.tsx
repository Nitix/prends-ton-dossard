import { useI18n } from "../../i18n/I18nProvider";
import { simplify, type TrackPoint } from "./gpx";

// The size of the drawing, in the units of its viewBox. It is shown at the width
// of its container, up to `max-w-md`, which is about 1 to 1 on a phone.
const WIDTH = 360;
const HEIGHT = 240;
const PADDING = 20;

/** The marks of the start (a dot) and of the finish (a ring around it, if the track loops back). */
const START_RADIUS = 4.5;
const FINISH_RADIUS = 8;

const RADIANS_PER_DEGREE = Math.PI / 180;

type Spot = { x: number; y: number };

/**
 * The points of the track on the drawing: a flat projection that keeps the
 * proportions on the ground (a degree of longitude is `cos(latitude)` of a
 * degree of latitude, at the mean latitude of the track), the north up, the
 * whole track fitted in the frame and centred. A track with no extent (one
 * point, or all at the same place) is a point at the centre.
 */
function project(points: TrackPoint[]): Spot[] {
  if (points.length === 0) return [];
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length;
  const stretch = Math.cos(meanLat * RADIANS_PER_DEGREE);
  // East is to the right, north is up: the screen counts y downwards.
  const flat = points.map((p) => ({ x: p.lon * stretch, y: -p.lat }));

  const xs = flat.map((p) => p.x);
  const ys = flat.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const spanX = Math.max(...xs) - minX;
  const spanY = Math.max(...ys) - minY;

  const room = { x: WIDTH - 2 * PADDING, y: HEIGHT - 2 * PADDING };
  const scale =
    spanX === 0 && spanY === 0
      ? 0
      : Math.min(spanX > 0 ? room.x / spanX : Infinity, spanY > 0 ? room.y / spanY : Infinity);
  const left = PADDING + (room.x - spanX * scale) / 2;
  const top = PADDING + (room.y - spanY * scale) / 2;

  return flat.map((p) => ({ x: left + (p.x - minX) * scale, y: top + (p.y - minY) * scale }));
}

/** The path through the spots. A single spot is a zero-length line, which a round cap draws as a dot. */
function pathOf(spots: Spot[]): string {
  const coordinates = spots.map((s) => `${s.x.toFixed(1)} ${s.y.toFixed(1)}`);
  const [first] = coordinates;
  if (first === undefined) return "";
  const lines = coordinates.length > 1 ? coordinates.slice(1) : [first];
  return `M${first} ${lines.map((c) => `L${c}`).join(" ")}`;
}

/**
 * The shape of a track seen from above, drawn in SVG: one line, the north up,
 * with its start and its finish marked. Pass the whole track: it is reduced to
 * 1 000 points here. `label` is its accessible name, which says the numbers (the
 * drawing has none of its own).
 *
 * Nothing is told by the colour alone: the start is a dot and the finish a ring,
 * and both are named under the drawing. The colours are those of the text (the
 * line, the dot and the ring follow `currentColor`) so a theme changes them in
 * one place.
 */
export function TrackShape({ points, label }: { points: TrackPoint[]; label: string }) {
  const { t } = useI18n();
  const spots = project(simplify(points));
  const start = spots[0];
  const finish = spots.at(-1);

  return (
    <div className="flex flex-col gap-1">
      <svg
        // A drawing in SVG has no <img> to stand for it: role="img" makes it a picture.
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="img"
        aria-label={label}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="block h-auto w-full max-w-md text-neutral-800"
      >
        <path
          d={pathOf(spots)}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        {finish && (
          <circle
            cx={finish.x}
            cy={finish.y}
            r={FINISH_RADIUS}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {start && (
          // The ring of the colour of the card keeps the dot readable where it crosses the line.
          <circle
            cx={start.x}
            cy={start.y}
            r={START_RADIUS}
            fill="currentColor"
            className="stroke-white"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>
      <ul className="flex gap-4 text-sm text-neutral-700">
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 text-neutral-800">
            <circle cx={8} cy={8} r={START_RADIUS} fill="currentColor" />
          </svg>
          {t.route.start}
        </li>
        <li className="flex items-center gap-1.5">
          <svg aria-hidden="true" viewBox="0 0 16 16" className="size-4 text-neutral-800">
            <circle
              cx={8}
              cy={8}
              r={FINISH_RADIUS - 1}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
            />
          </svg>
          {t.route.finish}
        </li>
      </ul>
    </div>
  );
}
