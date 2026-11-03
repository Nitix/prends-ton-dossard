import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Aurore » in the places of the app (see ../README.md): the sun
// that rises on the horizon, with its arcs of light and the dotted line of a
// route along it, over two soft glows in the sky; and the tile of the name of
// the app. They are decoration: hidden from screen readers, they never say what
// the words around them do not. Their colours are properties of the theme
// (`--motif-*`), which the palette of the skin sets. Crête's stand in for the
// block marker (the same small sun on the horizon) and for the divider.

/** The id of a gradient, in the characters that a `url(#…)` takes as they are. */
const safe = (id: string) => id.replace(/[^\w-]/g, "");

/**
 * The sun rising on the horizon, with its arcs of light and the dotted line of
 * a route that runs along the horizon. `tone` is "light" on the sky (white
 * strokes, the sun in pale peach and pink), "color" on white (strokes and sun
 * in the colours of the dawn).
 */
function SunArc({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "color";
  className?: string;
}) {
  const id = safe(useId());
  const sun = `sun${id}`;
  const stroke = `stroke${id}`;
  const light = tone === "light";
  const line = light ? "#ffffff" : `url(#${stroke})`;
  const [first, second, third] = light
    ? ["--motif-sun-core", "--motif-sun-mid", "--motif-sun-rim"]
    : ["--motif-dawn-1", "--motif-dawn-2", "--motif-dawn-3"];

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
        <radialGradient id={sun} cx="0.5" cy="1" r="1">
          <stop offset="0" style={{ stopColor: `var(${first})` }} />
          <stop offset="0.55" style={{ stopColor: `var(${second})` }} />
          <stop offset="1" style={{ stopColor: `var(${third})` }} />
        </radialGradient>
        <linearGradient id={stroke} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" style={{ stopColor: "var(--motif-dawn-1)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--motif-dawn-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--motif-dawn-3)" }} />
        </linearGradient>
      </defs>
      {/* The arcs of light around the sun. */}
      <g stroke={line} strokeWidth="1.5" strokeLinecap="round">
        <path d="M86 108a54 54 0 0 1 108 0" opacity={light ? 0.45 : 0.55} />
        <path d="M68 108a72 72 0 0 1 144 0" opacity={light ? 0.28 : 0.35} />
        <path d="M50 108a90 90 0 0 1 180 0" opacity={light ? 0.16 : 0.2} />
      </g>
      {/* The sun, half risen. */}
      <path d="M106 108a34 34 0 0 1 68 0z" fill={`url(#${sun})`} opacity={light ? 0.95 : 1} />
      {/* The horizon, and a route that runs along it. */}
      <path d="M0 108h240" stroke={line} strokeWidth="1.5" opacity={light ? 0.5 : 0.6} />
      <path
        d="M4 118c28-6 46 2 70-2s38-8 62-4 50 6 70 2 22-4 30-4"
        stroke={line}
        strokeWidth="2.5"
        className="route-dots"
        opacity={light ? 0.75 : 0.8}
      />
    </svg>
  );
}

/** The two soft glows of the sky: still (a blurred layer that moved for ever would keep a phone at work). */
function Glows() {
  return (
    <>
      <span className="aurore:absolute aurore:-top-16 aurore:-left-20 aurore:size-64 aurore:rounded-full aurore:bg-iris-400/40 aurore:blur-3xl" />
      <span className="aurore:absolute aurore:-right-10 aurore:-bottom-24 aurore:size-72 aurore:rounded-full aurore:bg-peach-300/50 aurore:blur-3xl" />
    </>
  );
}

/**
 * « Aurore »'s `HeaderArt`: what is in the sky behind the header: two soft
 * glows and, unless `sun` is false (a page with a hero has its own), the sun
 * that rises on the horizon, on the right on a phone, between the name and the
 * tabs on a large screen. On the pages to sign in, where the sky is the whole
 * page, the sun rises at its foot, behind the card.
 */
export function HeaderArt({ place, sun = true }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span
        aria-hidden="true"
        className="aurore:pointer-events-none aurore:absolute aurore:inset-0 aurore:overflow-hidden"
      >
        <Glows />
        {sun && (
          <span className="aurore:absolute aurore:right-[-2.5rem] aurore:bottom-8 aurore:w-[15rem] aurore:animate-rise aurore:md:right-auto aurore:md:left-[calc(50%-17rem)] aurore:md:w-[17rem]">
            <SunArc className="aurore:block aurore:w-full" />
          </span>
        )}
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="aurore:pointer-events-none aurore:absolute aurore:inset-0 aurore:overflow-hidden"
    >
      <Glows />
      <span className="aurore:absolute aurore:bottom-6 aurore:left-1/2 aurore:w-[min(34rem,140%)] aurore:-translate-x-1/2 aurore:animate-rise">
        <SunArc className="aurore:block aurore:w-full" />
      </span>
    </span>
  );
}

/**
 * « Aurore »'s `BrandMark`: the name of the app in white on the sky, after a
 * small white tile with the sun rising on its horizon and a dotted route.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const gradient = `brand${safe(useId())}`;
  const big = size === "lg";

  return (
    <span className="aurore:flex aurore:items-center aurore:gap-3">
      <span
        aria-hidden="true"
        className={`aurore:flex aurore:shrink-0 aurore:items-end aurore:justify-center aurore:overflow-hidden aurore:rounded-xl aurore:bg-white aurore:shadow-[0_6px_18px_-6px_var(--motif-mark-shade)] ${
          big ? "aurore:size-11" : "aurore:size-9"
        }`}
      >
        <svg viewBox="0 0 36 36" focusable="false" className="aurore:size-full">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" style={{ stopColor: "var(--motif-dawn-1)" }} />
              <stop offset="0.55" style={{ stopColor: "var(--motif-dawn-2)" }} />
              <stop offset="1" style={{ stopColor: "var(--motif-dawn-3)" }} />
            </linearGradient>
          </defs>
          <path d="M8 25a10 10 0 0 1 20 0z" fill={`url(#${gradient})`} />
          <path
            d="M4.5 25a13.5 13.5 0 0 1 27 0"
            fill="none"
            stroke={`url(#${gradient})`}
            strokeWidth="1.6"
            opacity="0.55"
          />
          <path
            d="M4 25h28"
            style={{ stroke: "var(--color-ink)" }}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M7 29.5h4M14 29.5h8M25 29.5h4"
            style={{ stroke: "var(--color-iris-600)" }}
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      <span
        className={`aurore:font-display aurore:leading-none aurore:font-extrabold aurore:tracking-tight aurore:text-white aurore:drop-shadow-[0_1px_8px_var(--motif-name-shade)] ${
          big ? "aurore:text-[1.75rem]" : "aurore:text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/**
 * « Aurore »'s `HeroArt`: behind the hero of an event or of a runner, a glow in
 * its corner and the sun rising on the horizon at its foot, on the right.
 */
export function HeroArt({ place }: HeroArtProps) {
  if (place === "event") {
    return (
      <span
        aria-hidden="true"
        className="aurore:pointer-events-none aurore:absolute aurore:inset-0"
      >
        <span className="aurore:absolute aurore:-top-20 aurore:-left-16 aurore:size-56 aurore:rounded-full aurore:bg-iris-400/35 aurore:blur-3xl" />
        <span className="aurore:absolute aurore:right-[-2.5rem] aurore:bottom-0 aurore:w-[13rem] aurore:animate-rise aurore:md:right-4 aurore:md:w-[16rem]">
          <SunArc className="aurore:block aurore:w-full" />
        </span>
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="aurore:pointer-events-none aurore:absolute aurore:inset-0">
      <span className="aurore:absolute aurore:-top-16 aurore:-left-12 aurore:size-48 aurore:rounded-full aurore:bg-iris-400/35 aurore:blur-3xl" />
      <span className="aurore:absolute aurore:right-[-3rem] aurore:bottom-0 aurore:w-[12rem] aurore:animate-rise aurore:md:right-4 aurore:md:w-[15rem]">
        <SunArc className="aurore:block aurore:w-full" />
      </span>
    </span>
  );
}

/**
 * « Aurore »'s `EmptyArt`: the sun rising on the horizon, in the colours of the
 * dawn, over the words of an empty list.
 */
export function EmptyArt() {
  return <SunArc tone="color" className="aurore:mb-2 aurore:w-44" />;
}
