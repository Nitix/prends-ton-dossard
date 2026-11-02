import type { CSSProperties } from "react";

import type { HeaderArtProps, HeroArtProps } from "../types";

// The art of « Nuit »: a strip of reflective tape as on a running vest, the dots
// of a pace line from a cyan start to a lime finish. Every colour is a token of
// the palette. Decoration only: nothing here is read out, taps or focus.

/** A strip of reflective tape: diagonal segments of lime that catch the light. */
const TAPE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-60deg, var(--color-iris-600) 0 7px, color-mix(in srgb, var(--color-iris-600) 35%, transparent) 7px 9px)",
  boxShadow: "0 0 14px -2px var(--dawn-glow-warm)",
};

/** The silver tape of the header, fading at both ends. */
const SILVER_TAPE: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(-60deg, color-mix(in srgb, var(--color-ink) 50%, transparent) 0 6px, color-mix(in srgb, var(--color-iris-600) 55%, transparent) 6px 8px, transparent 8px 12px)",
  maskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
  WebkitMaskImage: "linear-gradient(90deg, transparent, #000 18%, #000 82%, transparent)",
};

/** The dashes down the middle of a road. */
const ROAD_DASHES: CSSProperties = {
  backgroundImage:
    "repeating-linear-gradient(90deg, var(--color-neutral-300) 0 14px, transparent 14px 24px)",
};

/**
 * A route drawn as a dotted pace line, from a cyan start to a lime finish ring:
 * the art behind the sign-in pages and the hero of a runner.
 */
function RouteDoodle({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 120"
      fill="none"
      className={`pointer-events-none ${className}`}
    >
      <path
        d="M8 104c22-4 30-30 54-30s28 22 50 18 18-40 44-50 34 14 52 2 16-26 22-32"
        style={{ stroke: "var(--color-iris-600)" }}
        strokeOpacity={0.35}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray="0.5 7"
        vectorEffect="non-scaling-stroke"
      />
      <path
        d="M8 112c30-2 44-18 70-16s34 12 60 4 26-34 54-36 30-10 40-22"
        style={{ stroke: "var(--color-blush-500)" }}
        strokeOpacity={0.2}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="0.5 6"
        vectorEffect="non-scaling-stroke"
      />
      <circle
        cx="8"
        cy="104"
        r="3.5"
        style={{ fill: "var(--color-blush-500)" }}
        fillOpacity={0.7}
      />
      <circle
        cx="230"
        cy="12"
        r="5"
        style={{ fill: "var(--color-neutral-50)", stroke: "var(--color-iris-600)" }}
        strokeOpacity={0.8}
        strokeWidth={2.5}
      />
    </svg>
  );
}

/**
 * The art of the sky of the app. The headlamp is in the paint of the sky
 * itself. In the header, the silver tape runs along the foot of the sky, above
 * the sheet of the page; on the pages to sign in, a short road dash under the
 * name, and a route across the bottom of the night, behind the form.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <span className="absolute inset-x-0 bottom-9 h-[3px]" style={SILVER_TAPE} />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span
        className="absolute inset-x-0 top-[7.25rem] mx-auto h-0.5 w-24 rounded-[1px] opacity-80 md:top-36"
        style={ROAD_DASHES}
      />
      <RouteDoodle className="absolute inset-x-0 bottom-4 mx-auto h-[30vh] w-full max-w-3xl px-6 opacity-60" />
    </span>
  );
}

/**
 * The art behind a hero, which has the headlamp in its paint: a small patch of
 * reflective tape on its top edge, and on the hero of a runner the route, on
 * the right.
 */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute top-0 left-5 h-1 w-16 rounded-b-[2px] md:left-7" style={TAPE} />
      {place === "runner" && (
        <RouteDoodle className="absolute right-3 bottom-3 w-40 opacity-80 md:right-6 md:w-56" />
      )}
    </span>
  );
}
