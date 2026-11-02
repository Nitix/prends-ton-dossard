// The drawings of « Carnet », in hairlines and dots: a dotted France for an
// empty list, and the isometric start arch of the pages to sign in. They are
// decoration: hidden from screen readers, with no words in them. Nothing moves.

// ── A dotted France ─────────────────────────────────────────────────────────

type LonLat = readonly [number, number];

/** The outline of mainland France, by hand, in degrees (longitude, latitude). */
const MAINLAND: LonLat[] = [
  [2.37, 51.05],
  [2.9, 50.72],
  [3.6, 50.48],
  [4.2, 50.1],
  [4.83, 50.15],
  [5.0, 49.8],
  [5.8, 49.55],
  [6.37, 49.47],
  [6.73, 49.17],
  [7.4, 49.17],
  [8.2, 48.98],
  [7.8, 48.6],
  [7.55, 48.0],
  [7.58, 47.58],
  [7.0, 47.45],
  [6.45, 46.95],
  [6.1, 46.55],
  [6.12, 46.2],
  [6.8, 46.39],
  [7.0, 45.95],
  [7.1, 45.45],
  [6.63, 45.12],
  [7.0, 44.75],
  [6.9, 44.4],
  [7.7, 44.15],
  [7.5, 43.79],
  [7.25, 43.68],
  [6.9, 43.45],
  [6.6, 43.17],
  [6.15, 43.05],
  [5.4, 43.2],
  [4.85, 43.35],
  [4.3, 43.45],
  [3.9, 43.52],
  [3.3, 43.25],
  [3.05, 42.95],
  [3.17, 42.43],
  [2.6, 42.35],
  [1.75, 42.5],
  [0.7, 42.8],
  [-0.3, 42.8],
  [-0.75, 42.95],
  [-1.45, 43.05],
  [-1.78, 43.37],
  [-1.5, 43.55],
  [-1.25, 44.4],
  [-1.25, 44.65],
  [-1.15, 45.5],
  [-1.2, 46.2],
  [-1.9, 46.7],
  [-2.15, 47.0],
  [-2.5, 47.3],
  [-3.15, 47.5],
  [-3.6, 47.75],
  [-4.35, 47.8],
  [-4.75, 48.1],
  [-4.78, 48.36],
  [-4.5, 48.62],
  [-3.6, 48.78],
  [-2.8, 48.55],
  [-2.0, 48.65],
  [-1.55, 48.65],
  [-1.6, 49.2],
  [-1.95, 49.72],
  [-1.3, 49.7],
  [-1.15, 49.38],
  [-0.6, 49.35],
  [0.1, 49.45],
  [0.2, 49.7],
  [1.1, 49.95],
  [1.6, 50.2],
  [1.58, 50.7],
  [1.85, 50.95],
];

const CORSICA: LonLat[] = [
  [9.45, 43.0],
  [9.55, 42.6],
  [9.4, 41.95],
  [9.25, 41.4],
  [8.85, 41.55],
  [8.6, 41.9],
  [8.65, 42.35],
  [9.0, 42.65],
];

const WEST = -4.9;
const EAST = 9.6;
const NORTH = 51.15;
const SOUTH = 41.3;
/** Longitudes are narrower than latitudes here: the cosine of the middle latitude. */
const SQUEEZE = Math.cos((46.5 * Math.PI) / 180);

function inside(point: LonLat, polygon: LonLat[]): boolean {
  const [x, y] = point;
  let within = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i] ?? [0, 0];
    const [xj, yj] = polygon[j] ?? [0, 0];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) within = !within;
  }
  return within;
}

/** The space between two dots, in degrees of latitude: the one of the variant on a list with nothing in it. */
const STEP = 0.36;

let franceDots: { x: number; y: number }[] | undefined;

/** The dots of France on a grid of `STEP` degrees of latitude, in its own units (degrees of latitude), made once. */
function dotsOfFrance(): { x: number; y: number }[] {
  if (franceDots) return franceDots;
  const dots: { x: number; y: number }[] = [];
  for (let y = STEP / 2; y < NORTH - SOUTH; y += STEP) {
    for (let x = STEP / 2; x < (EAST - WEST) * SQUEEZE; x += STEP) {
      const point: LonLat = [WEST + x / SQUEEZE, NORTH - y];
      if (inside(point, MAINLAND) || inside(point, CORSICA)) dots.push({ x, y });
    }
  }
  franceDots = dots;
  return dots;
}

/**
 * France in dots: the picture of a list with nothing in it, and, given a point
 * (`at`, the first point of a track), the mark of coral of where it starts.
 */
export function DotFrance({
  className = "w-28",
  at,
}: {
  className?: string;
  at?: { lat: number; lon: number };
}) {
  const width = (EAST - WEST) * SQUEEZE;
  const height = NORTH - SOUTH;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`0 0 ${width} ${height}`}
      className={`block h-auto ${className}`}
    >
      {dotsOfFrance().map(({ x, y }) => (
        <circle
          key={`${x.toFixed(2)}:${y.toFixed(2)}`}
          cx={x}
          cy={y}
          r={STEP * 0.24}
          className="fill-neutral-400"
        />
      ))}
      {at && (
        <>
          <circle
            cx={(at.lon - WEST) * SQUEEZE}
            cy={NORTH - at.lat}
            r={STEP * 1.5}
            fill="none"
            strokeWidth={STEP * 0.3}
            className="stroke-iris-600"
          />
          <circle
            data-start=""
            cx={(at.lon - WEST) * SQUEEZE}
            cy={NORTH - at.lat}
            r={STEP * 0.75}
            className="fill-iris-600"
          />
        </>
      )}
    </svg>
  );
}

// ── An isometric start arch ────────────────────────────────────────────────

type P3 = readonly [number, number, number];

const COS30 = Math.cos(Math.PI / 6);
const SCALE = 14;

/** A point of the world on the drawing: x goes down to the right, y down to the left, z up. */
function iso([x, y, z]: P3): [number, number] {
  return [(x - y) * COS30 * SCALE, ((x + y) / 2 - z) * SCALE];
}

const path = (points: P3[]) =>
  `M${points
    .map((p) =>
      iso(p)
        .map((n) => n.toFixed(1))
        .join(" "),
    )
    .join("L")}Z`;

/** The three faces of a box that show: the top, the one towards y, the one towards x. */
function Box({
  from,
  to,
  top = "fill-white/15",
  left = "fill-white/5",
  right = "fill-white/10",
}: {
  from: P3;
  to: P3;
  top?: string;
  left?: string;
  right?: string;
}) {
  const [x0, y0, z0] = from;
  const [x1, y1, z1] = to;
  return (
    <g className="stroke-white/60" strokeWidth={0.9} strokeLinejoin="round">
      <path
        className={top}
        d={path([
          [x0, y0, z1],
          [x1, y0, z1],
          [x1, y1, z1],
          [x0, y1, z1],
        ])}
      />
      <path
        className={left}
        d={path([
          [x0, y1, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x0, y1, z1],
        ])}
      />
      <path
        className={right}
        d={path([
          [x1, y0, z0],
          [x1, y1, z0],
          [x1, y1, z1],
          [x1, y0, z1],
        ])}
      />
    </g>
  );
}

/**
 * A start and finish arch in isometric hairlines: two posts, a banner with a
 * chequered face and a coral edge, a pennant, the road that runs under it with
 * its lanes and its chequered line, on a dotted ground.
 */
export function IsoArch({ className = "w-64" }: { className?: string }) {
  // The ground: a dotted plane, a little wider along the road.
  const ground: P3[] = [];
  for (let x = -4; x <= 12; x += 1) for (let y = -6; y <= 9; y += 1) ground.push([x, y, 0]);
  const post = { width: 1, depth: 1, height: 4.8 };
  const left = { x0: -1, x1: -1 + post.width };
  const right = { x0: 8, x1: 8 + post.width };
  const beam = { x0: -1.5, x1: 9.5, y0: 0.08, y1: 0.92, z0: post.height, z1: post.height + 1.7 };

  // The chequered face of the banner: two rows of squares between its ends.
  const checker: string[] = [];
  const cells = 16;
  const cell = (beam.x1 - beam.x0 - 1.4) / cells;
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 === 1) continue;
      const u0 = beam.x0 + 0.7 + cell * i;
      const v0 = beam.z0 + 0.4 + 0.45 * j;
      checker.push(
        path([
          [u0, beam.y1, v0],
          [u0 + cell, beam.y1, v0],
          [u0 + cell, beam.y1, v0 + 0.45],
          [u0, beam.y1, v0 + 0.45],
        ]),
      );
    }
  }
  // The chequered line on the road, right under the banner.
  const line: string[] = [];
  const road = { x0: 0.5, x1: 7.5 };
  const squares = 14;
  const square = (road.x1 - road.x0) / squares;
  for (let i = 0; i < squares; i++) {
    for (let j = 0; j < 2; j++) {
      if ((i + j) % 2 === 1) continue;
      const x0 = road.x0 + square * i;
      const y0 = 0.1 + 0.4 * j;
      line.push(
        path([
          [x0, y0, 0],
          [x0 + square, y0, 0],
          [x0 + square, y0 + 0.4, 0],
          [x0, y0 + 0.4, 0],
        ]),
      );
    }
  }
  const segment = (from: P3, to: P3) => `M${iso(from).join(" ")}L${iso(to).join(" ")}`;

  // The frame of the drawing: the corners of the ground, and the top of the pennant.
  const corners = (
    [
      [-4, -6, 0],
      [12, -6, 0],
      [-4, 9, 0],
      [12, 9, 0],
      [beam.x1, 0.5, beam.z1 + 1.8],
      [beam.x0, 0, beam.z1],
    ] as P3[]
  ).map(iso);
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const minX = Math.min(...xs) - 4;
  const minY = Math.min(...ys) - 4;
  const width = Math.max(...xs) + 4 - minX;
  const height = Math.max(...ys) + 4 - minY;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox={`${minX.toFixed(1)} ${minY.toFixed(1)} ${width.toFixed(1)} ${height.toFixed(1)}`}
      className={`block h-auto ${className}`}
    >
      {ground.map((p) => {
        const [x, y] = iso(p);
        const near = Math.abs(p[0] - 4) < 7 && Math.abs(p[1]) < 7;
        return (
          <circle
            key={p.join(",")}
            cx={x}
            cy={y}
            r={near ? 1 : 0.8}
            className={near ? "fill-white/45" : "fill-white/25"}
          />
        );
      })}
      {/* The road, its two edges and its middle line. */}
      <g fill="none" strokeWidth={0.9}>
        <path d={segment([road.x0, -6, 0], [road.x0, 9, 0])} className="stroke-white/55" />
        <path d={segment([road.x1, -6, 0], [road.x1, 9, 0])} className="stroke-white/55" />
        <path
          d={segment([4, -6, 0], [4, -0.4, 0])}
          strokeDasharray="6 6"
          className="stroke-white/30"
        />
        <path
          d={segment([4, 1.4, 0], [4, 9, 0])}
          strokeDasharray="6 6"
          className="stroke-white/30"
        />
      </g>
      <g className="fill-white/70">
        {line.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <Box from={[left.x0, 0, 0]} to={[left.x1, post.depth, post.height]} />
      <Box from={[right.x0, 0, 0]} to={[right.x1, post.depth, post.height]} />
      <Box from={[beam.x0, beam.y0, beam.z0]} to={[beam.x1, beam.y1, beam.z1]} />
      <g className="fill-white/85">
        {checker.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      {/* The coral edge under the banner. */}
      <path
        d={segment([beam.x0, beam.y1, beam.z0], [beam.x1, beam.y1, beam.z0])}
        className="stroke-iris-400"
        strokeWidth={2.2}
        strokeLinecap="round"
      />
      {/* A pennant over the right end of the banner. */}
      <path
        d={segment([beam.x1 - 0.5, 0.5, beam.z1], [beam.x1 - 0.5, 0.5, beam.z1 + 1.8])}
        className="stroke-white/70"
        strokeWidth={0.9}
      />
      <path
        d={path([
          [beam.x1 - 0.5, 0.5, beam.z1 + 1.8],
          [beam.x1 + 1.1, 0.5, beam.z1 + 1.4],
          [beam.x1 - 0.5, 0.5, beam.z1 + 1.0],
        ])}
        className="fill-iris-400 stroke-iris-200"
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </svg>
  );
}
