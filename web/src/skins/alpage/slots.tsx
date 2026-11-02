import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { Contours } from "../crete/Alpenglow";
import { Ridges, Sun, TrailPatch } from "../shared/trail";
import type { BrandMarkProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Alpage » in the places of the app (see ../README.md): the sky
// of the forest at sunrise, the name of the app after the patch of a trail
// race, the heroes, and the sun between two ridges of an empty list. They are
// « Sentier »'s pieces (its ridges, its sun, its patch, its blaze before a
// title: ../shared/trail.tsx) in the dark greens of the forest. Crête's stand
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
      <span
        aria-hidden="true"
        className="alpage:pointer-events-none alpage:absolute alpage:inset-0 alpage:overflow-hidden"
      >
        <Contours tiled className="alpage:opacity-[0.09]" />
        <span className="alpage:absolute alpage:-top-20 alpage:-left-16 alpage:size-64 alpage:rounded-full alpage:bg-iris-400/30 alpage:blur-3xl" />
        <span
          className="alpage:absolute alpage:-right-16 alpage:-bottom-28 alpage:size-72 alpage:rounded-full alpage:blur-3xl"
          style={{ backgroundColor: MEADOW }}
        />
        {sun && (
          <Sun className="alpage:right-[7%] alpage:bottom-[2.25rem] alpage:size-11 alpage:animate-rise alpage:md:right-auto alpage:md:bottom-[1.6rem] alpage:md:left-[calc(50%-8rem)] alpage:md:size-14" />
        )}
        <Ridges
          far={FAR}
          near={NEAR}
          className="alpage:inset-x-0 alpage:bottom-0 alpage:h-[4.75rem] alpage:w-full alpage:md:h-[5.25rem]"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="alpage:pointer-events-none alpage:absolute alpage:inset-0 alpage:overflow-hidden"
    >
      <Contours className="alpage:text-white alpage:opacity-[0.09]" />
      <span className="alpage:absolute alpage:-top-20 alpage:-left-16 alpage:size-64 alpage:rounded-full alpage:bg-iris-400/30 alpage:blur-3xl" />
      <span
        className="alpage:absolute alpage:-right-16 alpage:-bottom-28 alpage:size-72 alpage:rounded-full alpage:blur-3xl"
        style={{ backgroundColor: MEADOW }}
      />
      <span className="alpage:absolute alpage:inset-x-0 alpage:bottom-0 alpage:h-[34%] alpage:min-h-44 alpage:overflow-hidden">
        <Sun className="alpage:right-[14%] alpage:bottom-[46%] alpage:size-16 alpage:animate-rise alpage:md:right-[24%] alpage:md:bottom-[56%] alpage:md:size-32" />
        <Ridges
          far={FAR}
          near={NEAR}
          className="alpage:bottom-0 alpage:left-0 alpage:h-full alpage:w-[240%] alpage:md:w-full"
        />
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
    <span className="alpage:flex alpage:items-center alpage:gap-3">
      <TrailPatch
        className={`alpage:shrink-0 alpage:drop-shadow-[0_6px_14px_var(--motif-mark-shade)] ${big ? "alpage:size-12" : "alpage:size-10"}`}
      />
      <span
        className={`alpage:font-display alpage:leading-none alpage:font-bold alpage:tracking-tight alpage:text-white alpage:drop-shadow-[0_1px_8px_var(--motif-name-shade)] ${
          big ? "alpage:text-[1.875rem]" : "alpage:text-[1.375rem]"
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
      <span
        aria-hidden="true"
        className="alpage:pointer-events-none alpage:absolute alpage:inset-0"
      >
        <Contours className="alpage:text-white alpage:opacity-[0.08]" />
        <span className="alpage:absolute alpage:-top-20 alpage:-left-16 alpage:size-56 alpage:rounded-full alpage:bg-iris-400/30 alpage:blur-3xl" />
        <Sun className="alpage:right-[7%] alpage:bottom-[1.6rem] alpage:size-14 alpage:animate-rise alpage:md:right-[12%] alpage:md:bottom-[2.1rem] alpage:md:size-20" />
        <Ridges
          far={HERO_FAR}
          near={NEAR}
          className="alpage:inset-x-0 alpage:bottom-0 alpage:h-16 alpage:w-full alpage:md:h-20"
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="alpage:pointer-events-none alpage:absolute alpage:inset-0">
      <Contours className="alpage:text-white alpage:opacity-[0.08]" />
      <span className="alpage:absolute alpage:-top-16 alpage:-left-12 alpage:size-48 alpage:rounded-full alpage:bg-iris-400/30 alpage:blur-3xl" />
      <Sun className="alpage:right-[10%] alpage:bottom-[1.1rem] alpage:size-12 alpage:animate-rise alpage:md:bottom-[1.5rem] alpage:md:size-16" />
      <Ridges
        far={HERO_FAR}
        near={NEAR}
        className="alpage:inset-x-0 alpage:bottom-0 alpage:h-12 alpage:w-full alpage:md:h-16"
      />
    </span>
  );
}

/**
 * « Alpage »'s `EmptyArt`: the sun rising between two ridges, in colour, over
 * the words of an empty list.
 */
export function EmptyArt() {
  return <SunRidge className="alpage:mb-2 alpage:w-44" />;
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
