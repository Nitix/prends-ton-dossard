import { useId } from "react";

import { RIDGE_DIVIDER_PATH as RIDGE_FAR_PATH } from "../crete/motifPaths";
import { RIDGE_NEAR_PATH } from "./ridge";

// The pieces of « Sentier »'s art: two ridges, the sun that rises behind them,
// the patch of a trail race, a summit, and the blaze before a title. « Alpage » draws with them too. The
// contour lines are Crête's (`Contours`, which draws the same map: it is in the
// page once). They are decoration: hidden from screen readers, they never say
// what the words around them do not. Their colours are properties of the theme
// (`--motif-*`, `--color-*`), which the palette of the skin sets.

/**
 * Two ridges, the far one and the near one, in a 1200 × 120 box stretched to
 * its parent: `far` and `near` are their fills (a colour, or a `var()`). The
 * place and the size are the caller's (`className`).
 */
export function Ridges({
  far,
  near,
  className = "",
}: {
  far: string;
  near: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 1200 120"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute ${className}`}
    >
      <path d={RIDGE_FAR_PATH} style={{ fill: far }} />
      <path d={RIDGE_NEAR_PATH} style={{ fill: near }} />
    </svg>
  );
}

/** The sun rising behind the ridges: a round of sunrise with its halo, placed by `className`. */
export function Sun({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute rounded-full ${className}`}
      style={{
        backgroundImage:
          "linear-gradient(to bottom, var(--motif-sun-core), var(--motif-sun-mid), var(--motif-sun-rim))",
        boxShadow: "0 0 32px 8px color-mix(in srgb, var(--motif-halo-from) 40%, transparent)",
      }}
    />
  );
}

/**
 * The mark of the app: a round patch, like the badge of a trail race, with the
 * sun rising behind two summits and a path that climbs to the top.
 */
export function TrailPatch({ className = "size-9" }: { className?: string }) {
  const clip = `patch${useId().replace(/[^\w-]/g, "")}`;
  const ring = { fill: "var(--color-card)" };
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 32 32" className={className}>
      <defs>
        <clipPath id={clip}>
          <circle cx="16" cy="16" r="14" />
        </clipPath>
      </defs>
      <circle cx="16" cy="16" r="15.25" style={ring} />
      <g clipPath={`url(#${clip})`}>
        <circle cx="16" cy="16" r="14" style={{ fill: "var(--color-peach-100)" }} />
        <circle cx="21" cy="13" r="4.2" style={{ fill: "var(--motif-dawn-2)" }} />
        <path
          d="M1 25 9.5 13.5l4 4.8L18 12l13 13.5V31H1Z"
          style={{ fill: "var(--motif-peak-far)" }}
        />
        <path
          d="M1 31V24.5l6.5-5 4.5 3.2 5.5-4.7L31 27v4Z"
          style={{ fill: "var(--motif-peak-near-from)" }}
        />
        <path
          d="M10 30.5c1.8-1.6 4.6-2.2 5.2-3.8.5-1.4-1.2-2.1-.2-3.4.8-1 2.3-1.3 3-2.3"
          fill="none"
          style={{ stroke: "var(--color-card)" }}
          strokeWidth="1.1"
          strokeLinecap="round"
          strokeDasharray="1.6 1.4"
        />
      </g>
      <circle
        cx="16"
        cy="16"
        r="14.6"
        fill="none"
        style={{ stroke: "var(--color-card)" }}
        strokeWidth="1.3"
      />
    </svg>
  );
}

/** A summit and its path, in a 24 grid. */
export function SummitIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      <path d="m2.5 19.5 6.5-11 4 6.5 2.5-3.5 6 8Z" />
      <path d="m7.4 11.2 1.6 1.3 1.4-1.4" />
    </svg>
  );
}

/**
 * The blaze: the painted mark that shows the way on a tree or a rock, two
 * bands, sunrise over pine, a little tilted. It goes before the title of a block.
 */
export function Blaze() {
  return (
    <span
      aria-hidden="true"
      className="h-2.5 w-3.5 flex-none -rotate-4 rounded-[2px]"
      style={{
        backgroundImage:
          "linear-gradient(var(--color-peach-400) 0 50%, var(--color-iris-600) 50% 100%)",
      }}
    />
  );
}
