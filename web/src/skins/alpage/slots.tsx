import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { Contours } from "../crete/Alpenglow";
import { Ridges, Sun, TrailPatch } from "../sentier/motifs";
import type { BrandMarkProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Alpage » in the places of the app (see ../README.md): the sky
// of the forest at sunrise, the name of the app after the patch of a trail
// race, the heroes, and the sun between two ridges of an empty list. They are
// « Sentier »'s pieces (its ridges, its sun, its patch, its blaze before a
// title: ../sentier/motifs.tsx) in the dark greens of the forest. Crête's stand
// in for the divider (the same skyline).

/** The far ridge of the header, the deeper one of a hero, and the near one, which is the deepest. */
const FAR = "var(--motif-ridge-far-from)";
const HERO_FAR = "var(--motif-ridge-mid-from)";
const NEAR = "var(--motif-ridge-near-from)";
/** The meadow, as a faint glow in the sky. */
const MEADOW = "color-mix(in srgb, var(--motif-ridge-light) 30%, transparent)";

/**
 * « Alpage »'s `HeaderArt`: what is in the sky of the forest behind the header:
 * faint contour lines, two soft glows, the sun coming up behind the ridges, and
 * the ridges in silhouette against the light, which go down under the sheet of
 * the page that rises over them. On the pages to sign in, where the sky is the
 * whole page, the sun and the ridges are at its foot (wider than the screen on
 * a phone, so that the summits are not squeezed).
 */
export function HeaderArt({ place, sun = true }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <Contours tiled className="opacity-[0.09]" />
        <span className="absolute -top-20 -left-16 size-64 rounded-full bg-iris-400/30 blur-3xl" />
        <span
          className="absolute -right-16 -bottom-28 size-72 rounded-full blur-3xl"
          style={{ backgroundColor: MEADOW }}
        />
        {sun && (
          <Sun className="right-[7%] bottom-[2.25rem] size-11 animate-rise md:right-auto md:bottom-[1.6rem] md:left-[calc(50%-8rem)] md:size-14" />
        )}
        <Ridges
          far={FAR}
          near={NEAR}
          className="inset-x-0 bottom-0 h-[4.75rem] w-full md:h-[5.25rem]"
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <Contours className="text-white opacity-[0.09]" />
      <span className="absolute -top-20 -left-16 size-64 rounded-full bg-iris-400/30 blur-3xl" />
      <span
        className="absolute -right-16 -bottom-28 size-72 rounded-full blur-3xl"
        style={{ backgroundColor: MEADOW }}
      />
      <span className="absolute inset-x-0 bottom-0 h-[34%] min-h-44 overflow-hidden">
        <Sun className="right-[14%] bottom-[46%] size-16 animate-rise md:right-[24%] md:bottom-[56%] md:size-32" />
        <Ridges far={FAR} near={NEAR} className="bottom-0 left-0 h-full w-[240%] md:w-full" />
      </span>
    </span>
  );
}

/**
 * « Alpage »'s `BrandMark`: the name of the app in white on the sky, after the
 * round patch of a trail race, the sun rising behind two summits.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-3">
      <TrailPatch
        className={`shrink-0 drop-shadow-[0_6px_14px_rgb(10_33_27/0.45)] ${big ? "size-12" : "size-10"}`}
      />
      <span
        className={`font-display leading-none font-bold tracking-tight text-white drop-shadow-[0_1px_8px_rgb(10_33_27/0.45)] ${
          big ? "text-[1.875rem]" : "text-[1.375rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/**
 * « Alpage »'s `HeroArt`: the forest at sunrise behind the hero of an event or
 * of a runner: faint contour lines, a glow, the sun rising behind the ridges at
 * its foot, which are deeper than the ones of the header.
 */
export function HeroArt({ place }: HeroArtProps) {
  if (place === "event") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <Contours className="text-white opacity-[0.08]" />
        <span className="absolute -top-20 -left-16 size-56 rounded-full bg-iris-400/30 blur-3xl" />
        <Sun className="right-[7%] bottom-[1.6rem] size-14 animate-rise md:right-[12%] md:bottom-[2.1rem] md:size-20" />
        <Ridges far={HERO_FAR} near={NEAR} className="inset-x-0 bottom-0 h-16 w-full md:h-20" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Contours className="text-white opacity-[0.08]" />
      <span className="absolute -top-16 -left-12 size-48 rounded-full bg-iris-400/30 blur-3xl" />
      <Sun className="right-[10%] bottom-[1.1rem] size-12 animate-rise md:bottom-[1.5rem] md:size-16" />
      <Ridges far={HERO_FAR} near={NEAR} className="inset-x-0 bottom-0 h-12 w-full md:h-16" />
    </span>
  );
}

/**
 * « Alpage »'s `EmptyArt`: the sun rising between two ridges, in colour, over
 * the words of an empty list.
 */
export function EmptyArt() {
  return <SunRidge className="mb-2 w-44" />;
}

/**
 * The sun rising behind two ridges, with the dotted line of a trail that
 * climbs the near one.
 */
function SunRidge({ className = "" }: { className?: string }) {
  const sun = `sun${useId().replace(/[^\w-]/g, "")}`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 120"
      fill="none"
      preserveAspectRatio="xMidYMax meet"
      className={className}
    >
      <defs>
        <radialGradient id={sun} cx="0.5" cy="0.35" r="0.75">
          <stop offset="0" style={{ stopColor: "var(--motif-sun-core)" }} />
          <stop offset="0.5" style={{ stopColor: "var(--motif-sun-mid)" }} />
          <stop offset="1" style={{ stopColor: "var(--motif-sun-rim)" }} />
        </radialGradient>
      </defs>
      {/* The halo of the sun, then the sun, half risen behind the far ridge. */}
      <circle cx="154" cy="70" r="40" style={{ fill: "var(--motif-halo-from)" }} opacity={0.18} />
      <circle cx="154" cy="70" r="24" fill={`url(#${sun})`} />
      {/* The far ridge, then the near one. */}
      <path
        d="M0 120V82l16-6 14 4 20-16 12 8 22-22 14 12 12-6 22 18 14-4 18-20 16 10 20 12 14-6 16 10 10-4V120Z"
        style={{ fill: "var(--motif-ridge-light)" }}
        opacity={0.85}
      />
      <path
        d="M0 120V100l24-6 22 4 30-14 24 10 22-6 26 8 30-12 24 8 20-4 18 6V120Z"
        style={{ fill: "var(--motif-hill-near-from)" }}
      />
      {/* A trail that climbs the near ridge. */}
      <path
        d="M58 120c8-6 20-8 26-14s10-12 20-14 16 2 24-2 12-8 18-10"
        style={{ stroke: "var(--color-peach-50)" }}
        strokeWidth="2.5"
        className="route-dots"
      />
    </svg>
  );
}
