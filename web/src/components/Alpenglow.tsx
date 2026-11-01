import { useId } from "react";

import { CONTOURS_PATH, RIDGE_BACK_PATH, RIDGE_MID_PATH, RIDGE_NEAR_PATH } from "./motifPaths";

/**
 * The motifs of « Crête »: the dawn over the mountains, drawn like a map. The
 * contour lines of a topographic map in the sky, three ridges in deepening
 * violet at its foot, and the sun rising behind them. They are decoration:
 * hidden from screen readers, they never say what the words around them do not.
 *
 * The long paths are in the page once (`MotifDefs`, which the root of the app
 * renders) and every drawing refers to them with `<use>`: a header, a hero and
 * an empty state add a few elements, not a few kilobytes of path each.
 */

const CONTOURS = "crete-contours";
const TOPO = "crete-topo";
/** The scale of the contour lines where they are tiled: a tile of the map is 864 × 432 px. */
const TOPO_SCALE = 0.45;
const BACK = "crete-back";
const MID = "crete-mid";
const NEAR = "crete-near";
const band = (id: string) => `${id}-band`;
const fill = (id: string) => `${id}-fill`;
const SUN = "crete-sun";
const HALO = "crete-halo";

/** The width of a band of ridges, and the height of the box of their crests. */
const WIDTH = 2400;
const BASE = 120;

/** The crest of a ridge, as the points of its path, without the two corners at its foot. */
function crest(path: string): [number, number][] {
  return path
    .replace(/^M0 120L/, "")
    .replace(/L2400 120Z$/, "")
    .split("L")
    .map((point) => {
      const [x = 0, y = BASE] = point.split(" ").map(Number);
      return [x, y];
    });
}

const CRESTS = [crest(RIDGE_BACK_PATH), crest(RIDGE_MID_PATH), crest(RIDGE_NEAR_PATH)];

/** The height of a crest at `x`, which may be on one of the mirrored bands on either side. */
function heightAt(points: [number, number][], x: number): number {
  let local = ((x % (2 * WIDTH)) + 2 * WIDTH) % (2 * WIDTH);
  if (local > WIDTH) local = 2 * WIDTH - local;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i] ?? [WIDTH, BASE];
    if (x1 >= local) {
      const [x0, y0] = points[i - 1] ?? [0, BASE];
      return y0 + ((y1 - y0) * (local - x0)) / (x1 - x0 || 1);
    }
  }
  return BASE;
}

/**
 * A ridge continued on both sides by its mirror image, which meets it at the
 * same height: a band three times as wide, for the widest screens.
 */
const mirrored = (id: string) => (
  <g id={band(id)}>
    <use href={`#${id}`} transform="matrix(-1 0 0 1 0 0)" />
    <use href={`#${id}`} />
    <use href={`#${id}`} transform={`matrix(-1 0 0 1 ${2 * WIDTH} 0)`} />
  </g>
);

/** The fill of a ridge, from its crest to its foot. */
const shade = (id: string, top: string, bottom: string) => (
  <linearGradient id={fill(id)} x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stopColor={top} />
    <stop offset="1" stopColor={bottom} />
  </linearGradient>
);

/**
 * The paths and the paints of the motifs, once in the page: an SVG of no size,
 * with only definitions. Not `display: none`, which would keep the gradients
 * from painting.
 */
export function MotifDefs() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="0"
      height="0"
      className="pointer-events-none absolute size-0 overflow-hidden"
    >
      <defs>
        <path
          id={CONTOURS}
          d={CONTOURS_PATH}
          fill="none"
          stroke="currentColor"
          vectorEffect="non-scaling-stroke"
        />
        <path id={BACK} d={RIDGE_BACK_PATH} vectorEffect="non-scaling-stroke" />
        <path id={MID} d={RIDGE_MID_PATH} />
        <path id={NEAR} d={RIDGE_NEAR_PATH} />
        {/* The map tiled, each tile the mirror of its neighbours, so that the lines meet at their edges. */}
        <pattern
          id={TOPO}
          patternUnits="userSpaceOnUse"
          width="1920"
          height="960"
          patternTransform={`scale(${TOPO_SCALE})`}
          color="#fff"
        >
          {/* The lines a pixel wide, whatever the scale of the tile. */}
          <g strokeWidth={1 / TOPO_SCALE}>
            <use href={`#${CONTOURS}`} />
            <use href={`#${CONTOURS}`} transform="matrix(-1 0 0 1 1920 0)" />
            <use href={`#${CONTOURS}`} transform="matrix(1 0 0 -1 0 960)" />
            <use href={`#${CONTOURS}`} transform="matrix(-1 0 0 -1 1920 960)" />
          </g>
        </pattern>
        {mirrored(BACK)}
        {mirrored(MID)}
        {mirrored(NEAR)}
        {/* Back to front, the ridges deepen: the far crests catch the pink of the dawn, the near hills are still in the night. */}
        {shade(BACK, "#e46aa6", "#a54cb6")}
        {shade(MID, "#7d43b8", "#5b3aa8")}
        {shade(NEAR, "#3b2b8a", "#2a2070")}
        <radialGradient id={SUN} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fff7f0" />
          <stop offset="0.6" stopColor="#ffd2b8" />
          <stop offset="1" stopColor="#ff9fc4" />
        </radialGradient>
        <radialGradient id={HALO} cx="0.5" cy="0.5" r="0.5">
          <stop offset="0.25" stopColor="#ffd5bc" stopOpacity="0.75" />
          <stop offset="1" stopColor="#ffb38a" stopOpacity="0" />
        </radialGradient>
      </defs>
    </svg>
  );
}

/**
 * Contour lines that cover their positioned parent, as on a map. They take the
 * colour of the text, which is given with a low opacity by `className`
 * (`text-white opacity-[0.14]`); a mask there can fade them where words are.
 * The map is stretched to cover the box; `tiled` repeats it at a fixed scale
 * instead, in white, for a wide and short box (the sky of the header).
 */
export function Contours({
  className = "",
  tiled = false,
}: {
  className?: string;
  tiled?: boolean;
}) {
  if (tiled) {
    return (
      <svg
        aria-hidden="true"
        focusable="false"
        className={`pointer-events-none absolute inset-0 size-full ${className}`}
      >
        <rect width="100%" height="100%" fill={`url(#${TOPO})`} />
      </svg>
    );
  }
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 960 480"
      preserveAspectRatio="xMidYMid slice"
      className={`pointer-events-none absolute inset-0 size-full ${className}`}
    >
      <use href={`#${CONTOURS}`} strokeWidth={1} />
    </svg>
  );
}

/** The near ridge's darkest colour, for what continues it under the ridges (behind a sheet). */
export const NIGHT = "#2a2070";

/**
 * The three ridges at the bottom of their positioned parent, with the sun
 * rising behind them. The band of the ridges is 120 units high, and `sky` more
 * units are above it, for the peaks that `steep` raises and the arcs of light
 * around the sun: the height that `className` gives the drawing is (120 + sky)
 * units, which sets the scale (with the default sky, twice the band).
 *
 * The drawing keeps its proportions: a wider box shows more mountains, not
 * wider ones. `center` is the point of the band (0 to 2400) at the middle of
 * the box, `sun` where the sun rises (none when it is not given): it is put
 * behind the crests there, whatever their height. `steep` makes the mountains
 * taller without making them wider.
 */
export function Ridges({
  className = "",
  center = 1200,
  sun,
  sunSize = 26,
  steep = 1,
  sky = BASE,
}: {
  className?: string;
  center?: number;
  sun?: number;
  sunSize?: number;
  steep?: number;
  sky?: number;
}) {
  const clip = useId();
  // The highest crest where the sun rises: its centre is a little under it, so a cap shows.
  const crestY =
    sun === undefined
      ? 0
      : BASE - (BASE - Math.min(...CRESTS.map((points) => heightAt(points, sun)))) * steep;
  const sunY = crestY + sunSize * 0.35;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`${center - WIDTH} ${-sky} ${2 * WIDTH} ${sky + BASE}`}
      preserveAspectRatio="xMidYMax slice"
      className={`pointer-events-none absolute inset-x-0 bottom-0 w-full ${className}`}
    >
      {sun !== undefined && (
        <g className="animate-rise">
          <circle cx={sun} cy={sunY} r={sunSize * 3} fill={`url(#${HALO})`} />
          <g fill="none" stroke="#fff" strokeWidth={1.5} clipPath={`url(#${clip})`}>
            <circle
              cx={sun}
              cy={sunY}
              r={sunSize * 1.6}
              opacity={0.45}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={sun}
              cy={sunY}
              r={sunSize * 2.2}
              opacity={0.28}
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={sun}
              cy={sunY}
              r={sunSize * 2.8}
              opacity={0.16}
              vectorEffect="non-scaling-stroke"
            />
          </g>
          <clipPath id={clip}>
            <rect x={sun - sunSize * 3} y={-sky} width={sunSize * 6} height={sunY + sky} />
          </clipPath>
          <circle cx={sun} cy={sunY} r={sunSize} fill={`url(#${SUN})`} />
        </g>
      )}
      <g transform={`translate(0 ${BASE}) scale(1 ${steep}) translate(0 ${-BASE})`}>
        {/* A thin line of light on the far crests: the alpenglow. */}
        <use
          href={`#${band(BACK)}`}
          fill={`url(#${fill(BACK)})`}
          stroke="#ffd5bc"
          strokeOpacity={0.6}
          strokeWidth={1.25}
        />
        <use href={`#${band(MID)}`} fill={`url(#${fill(MID)})`} />
        <use href={`#${band(NEAR)}`} fill={`url(#${fill(NEAR)})`} />
      </g>
    </svg>
  );
}
