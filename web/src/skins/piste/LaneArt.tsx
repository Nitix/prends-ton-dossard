import type { HeaderArtProps, HeroArtProps } from "../types";

// The art of « Piste »: the bend of a running track, seen from above, in the
// corner of a dark band. The colours are the tokens of the palette (the track
// red is the accent, the lane lines the cream of the page). Decoration only.

// The lanes of the bend: seven lines, from the inner one, 11 units apart.
const LANES = [0, 1, 2, 3, 4, 5, 6];
const INNER = 70;
const STEP = 11;
const OUTER = INNER + STEP * (LANES.length - 1);

/** A quarter circle of radius `r`, around the bottom right corner of the drawing. */
const arc = (r: number) => `M ${260 - r} 150 A ${r} ${r} 0 0 1 260 ${150 - r}`;

/**
 * The bend: the terracotta of the track under its lane lines, in the bottom
 * right corner of the box it is given (`className` says where and how big).
 */
function LaneArt({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 260 150"
      preserveAspectRatio="xMaxYMax slice"
      className={`pointer-events-none absolute right-0 ${className}`}
    >
      <path
        d={arc((INNER + OUTER) / 2)}
        fill="none"
        style={{ stroke: "var(--color-iris-500)" }}
        strokeOpacity={0.42}
        strokeWidth={OUTER - INNER}
      />
      {LANES.map((lane) => (
        <path
          key={lane}
          d={arc(INNER + lane * STEP)}
          fill="none"
          style={{ stroke: "var(--color-neutral-50)" }}
          strokeOpacity={lane === 0 || lane === LANES.length - 1 ? 0.5 : 0.28}
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/**
 * The art of the sky of the app: the bend in the right corner of the band of
 * the header. On the pages to sign in, where the sky is the whole page and the
 * card covers its middle, the art is around the card: a small bend in the
 * corner at the top, beside the name, a finish-line checker under the name,
 * and under the card the bend of the track, wide, coming in from the bottom of
 * the page.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <LaneArt className="inset-y-0 h-full w-[17rem] opacity-90 md:opacity-60" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <LaneArt className="top-0 h-28 w-[13rem] opacity-70" />
      <LaneArt className="bottom-0 h-[22rem] w-full max-w-[40rem] opacity-90" />
      <span
        className="absolute inset-x-0 top-[7.25rem] mx-auto h-2.5 w-24 rounded-[2px] opacity-80 md:top-36"
        style={{
          backgroundColor: "var(--color-neutral-900)",
          backgroundImage:
            "repeating-conic-gradient(var(--color-neutral-50) 0 25%, transparent 0 50%)",
          backgroundSize: "10px 10px",
        }}
      />
    </span>
  );
}

/** The art behind a hero: the same bend, in the corner of the band. */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <LaneArt
        className={`inset-y-0 h-full opacity-80 ${place === "event" ? "w-[17rem]" : "w-[14rem]"}`}
      />
    </span>
  );
}
