import type { CSSProperties } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { useAmbient } from "../../lib/ambient";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../types";
import { DotFrance, IsoArch } from "./illustrations";

// The motifs of « Carnet »: a training logbook drawn like a technical sheet,
// in hairlines and dots. A fine grid of dots (the variant's sheet, drawn here
// in the sky and the heroes, with patches where it fades), a bib on a tile, the
// thin rule that ends in a cross, the dotted ring of a data point, dotted France
// and the isometric arch of a start line. They are decoration: hidden from
// screen readers, with no words in them.
//
// They move, slowly, as the variant's sheet did: its patches fade out and come
// back in, the orbits of the data turn (one ring the other way) and a dot
// pulses. The drawings that move are laid out and animated by motion.css, in
// `carnet-*` classes of the skin's own; it moves them inside a drawing that has
// `data-moving`, which it has while the person has the background on (« Animer
// le fond », lib/ambient.ts), and only for whoever has not asked their system for
// less motion (a media query of motion.css). Off, or with less motion asked for,
// the same drawings stand still.

/** The grid of dots of the sheet: a square of one pixel every 6, white, over a dark sky. */
const DOTS = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Crect x='2' y='2' width='1' height='1' fill='%23fff' fill-opacity='.22'/%3E%3C/svg%3E\")",
  backgroundSize: "6px 6px",
} as const;

/**
 * Patches of the ground over the dots, where the sheet fades: where, how big
 * (rem), how strongly they hide the dots at rest, and how they move (see
 * motion.css): how long a patch takes to go and come back (s), where it is in
 * that already (s, negative: they do not start together), how far it drifts (rem).
 */
const VEILS = [
  { left: "2%", top: "-20%", size: 11, opacity: 0.9, period: 17, delay: -4, drift: 2 },
  { left: "38%", top: "40%", size: 13, opacity: 0.75, period: 23, delay: -15, drift: -2.5 },
  { left: "66%", top: "-30%", size: 12, opacity: 0.9, period: 19, delay: -9, drift: 2.5 },
  { left: "86%", top: "35%", size: 10, opacity: 0.65, period: 13, delay: -2, drift: -2 },
] as const;

/** How little of the dots a patch hides when it has gone: the dots are almost all there. */
const VEIL_LEAST = 0.08;

/**
 * A patch of the ground over the dots, where the sheet fades: at `left` and
 * `top`, `width` by `height` big, hiding the dots as much as `opacity` at the
 * most; it goes out and comes back (`period` seconds, `delay` into it already,
 * negative) and drifts `drift` rem. See motion.css.
 */
function Veil(patch: {
  left: string;
  top: string;
  width: string;
  height: string;
  opacity: number;
  period: number;
  delay: number;
  drift: number;
}) {
  const { left, top, width, height, opacity, period, delay, drift } = patch;
  return (
    <span
      className="carnet-veil"
      style={
        {
          left,
          top,
          width,
          height,
          opacity,
          "--veil-max": opacity,
          "--veil-min": VEIL_LEAST,
          "--veil-period": `${period}s`,
          "--veil-delay": `${delay}s`,
          "--veil-drift": `${drift}rem`,
        } as CSSProperties
      }
    />
  );
}

/**
 * The sheet of dots, in its box, fading out towards `fade` (see motion.css), with
 * the patches of the ground over it where it fades out and in (`veils`), never
 * all of it: they move in a drawing that has `data-moving` (`.carnet-art`).
 */
function Dots({ fade, veils = false }: { fade?: "header" | "event" | "runner"; veils?: boolean }) {
  return (
    <span aria-hidden="true" data-fade={fade} className="carnet-dots">
      <span className="carnet-dots-sheet" style={DOTS} />
      {veils &&
        VEILS.map(({ left, top, size, ...pace }) => (
          <Veil
            key={left}
            left={left}
            top={top}
            width={`${size}rem`}
            height={`${size}rem`}
            {...pace}
          />
        ))}
    </span>
  );
}

/**
 * The sky behind the name. In the header of a page: the sheet of dots, with its
 * patches, and, on a page with no hero of its own, the orbits of the data in the
 * corner. On the pages to sign in: the sheet over the whole page, and under the
 * card the arch of a start line, in isometric hairlines, on a ground of dots.
 */
export function HeaderArt({ place, sun }: HeaderArtProps) {
  const [moving] = useAmbient();
  return (
    <span aria-hidden="true" data-moving={moving ? "" : undefined} className="carnet-art">
      {place === "header" ? (
        <>
          <Dots veils fade="header" />
          {sun && (
            <span className="carnet-column">
              <Orbit className="carnet-header-orbit" />
            </span>
          )}
        </>
      ) : (
        <>
          <Dots veils />
          <IsoArch className="carnet:absolute carnet:bottom-0 carnet:left-1/2 carnet:w-96 carnet:max-w-none carnet:-translate-x-1/2 carnet:mask-[radial-gradient(ellipse_65%_85%_at_50%_58%,#000_55%,transparent)] carnet:md:w-[34rem]" />
        </>
      )}
    </span>
  );
}

/** The last word of a text, if it has more than one, and what comes before it. */
function split(text: string): [head: string, last: string] | null {
  const at = text.trimEnd().lastIndexOf(" ");
  return at > 0 ? [text.slice(0, at), text.slice(at + 1)] : null;
}

/**
 * The logo: a bib drawn in hairlines on a white tile, its four pins, and a coral
 * line where the number goes; and the name of the app in two voices, the sans
 * and, for its last word, the italic serif that answers it.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";
  const name = split(t.common.appName);

  return (
    <span className="carnet:flex carnet:items-center carnet:gap-3">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 32 32"
        className={`carnet:shrink-0 ${big ? "carnet:size-11" : "carnet:size-9"}`}
      >
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="8"
          className="carnet:fill-card carnet:stroke-neutral-300"
        />
        <rect
          x="6.5"
          y="8.5"
          width="19"
          height="15"
          rx="2.5"
          fill="none"
          className="carnet:stroke-ink"
          strokeWidth="1.4"
        />
        <circle cx="9.3" cy="11.3" r="0.95" className="carnet:fill-ink" />
        <circle cx="22.7" cy="11.3" r="0.95" className="carnet:fill-ink" />
        <circle cx="9.3" cy="20.7" r="0.95" className="carnet:fill-ink" />
        <circle cx="22.7" cy="20.7" r="0.95" className="carnet:fill-ink" />
        <path
          d="M12.5 14.6h7"
          className="carnet:stroke-iris-600"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path
          d="M13.5 18.6h5"
          className="carnet:stroke-ink"
          strokeWidth="1.1"
          strokeLinecap="round"
        />
      </svg>
      <span
        className={`carnet:leading-none carnet:font-semibold carnet:tracking-[-0.02em] carnet:text-white ${
          big ? "carnet:text-[1.625rem]" : "carnet:text-[1.25rem]"
        }`}
      >
        {name ? (
          <>
            {name[0]}{" "}
            <span className="carnet:font-serif carnet:text-[1.14em] carnet:leading-[0.9] carnet:font-normal carnet:tracking-[-0.01em] carnet:italic">
              {name[1]}
            </span>
          </>
        ) : (
          t.common.appName
        )}
      </span>
    </span>
  );
}

/**
 * The orbits of a runner: a thin circle, a dotted one that turns with a dot of
 * data on it, and a ring that turns the other way with two more, one of which
 * pulses; round a corner of the hero or of the header. In white over the navy,
 * the data in teal, gold and indigo. They turn (160 s a turn) and pulse in a
 * drawing that moves (`data-moving` on it, see motion.css). A group turns about
 * the middle of its box, so each has a circle that fills it, drawn in nothing:
 * the box is then centred on the ring.
 */
function Orbit({ className }: { className: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-120 -120 240 240"
      className={`carnet-orbits ${className}`}
    >
      <circle r="110" fill="none" stroke="#fff" strokeOpacity="0.1" />
      {/* The ring that turns back, with its two dots of data: the teal one gives off a pulse. */}
      <g className="carnet-orbit-back">
        <circle r="88" fill="none" />
        <circle r="84" fill="none" stroke="#fff" strokeOpacity="0.16" />
        <circle
          className="carnet-pulse"
          cx="84"
          cy="0"
          r="4"
          style={{ fill: "var(--dawn-ring-from)" }}
        />
        <circle
          cx="84"
          cy="0"
          r="4"
          className="carnet:stroke-white"
          strokeWidth="2"
          style={{ fill: "var(--dawn-ring-from)" }}
        />
        <circle cx="-42" cy="-72.7" r="4" className="carnet:fill-peach-400" />
      </g>
      <g className="carnet-orbit">
        <circle r="64" fill="none" />
        <circle
          r="60"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.3"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="0.01 5"
        />
        <circle cx="-5" cy="59.8" r="4" className="carnet:fill-blush-400" />
      </g>
    </svg>
  );
}

/**
 * The poster of an event or of a runner: the sheet of dots fading towards the
 * foot (the left, for a runner), with the patches where it fades out and in, and
 * the orbits in a corner.
 */
export function HeroArt({ place }: HeroArtProps) {
  const [moving] = useAmbient();
  return (
    <span
      aria-hidden="true"
      data-moving={moving ? "" : undefined}
      data-ground="hero"
      className="carnet-art"
    >
      <Dots veils fade={place} />
      <Orbit className={`carnet-hero-orbit carnet-hero-orbit-${place}`} />
    </span>
  );
}

/** A cross where two rules meet, as on a drafting sheet. */
function Cross() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 9 9"
      className="carnet:size-[9px] carnet:flex-none"
    >
      <path d="M4.5 0v9M0 4.5h9" className="carnet:stroke-neutral-400" strokeWidth="1" />
    </svg>
  );
}

/** Between two blocks of the home page: a hairline, and a small cross at each end. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div
      aria-hidden="true"
      className={`carnet:flex carnet:h-8 carnet:w-full carnet:items-center carnet:gap-1 ${className}`}
    >
      <Cross />
      <span className="carnet:h-px carnet:flex-1 carnet:bg-neutral-300" />
      <Cross />
    </div>
  );
}

/** Before the title of a block: a ring of dots, and a node of data on it. */
export function SectionMarker() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 16 16"
      className="ring-marker carnet:size-4 carnet:flex-none"
    >
      <circle
        cx="8"
        cy="8"
        r="5.6"
        fill="none"
        className="carnet:stroke-neutral-600"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="0.01 2.7"
      />
      <circle cx="12.1" cy="3.9" r="2.3" className="carnet:fill-blush-500" />
    </svg>
  );
}

/** France in dots, over the words of a list with nothing in it. */
export function EmptyArt() {
  return <DotFrance className="carnet:mb-3 carnet:w-28" />;
}

/**
 * The patches of the sheet of the page, over the dots: scattered over the
 * screen (two low-discrepancy sequences, so that they are even without being in
 * rows), each of its own size (6 to 11 rem, at most: they shrink on a small
 * screen), and each at its own pace (11 to 24 s, none the same, and not in step).
 * Never all of the dots at once: the v4's sheet faded out and in by patches.
 */
const PAGE_PATCHES = Array.from({ length: 14 }, (_, at) => {
  const period = 11 + ((at * 5) % 14);
  return {
    left: ((at * 0.6180339887) % 1) * 100,
    top: ((at * 0.7548776662) % 1) * 100,
    size: 6 + ((at * 5) % 6),
    period,
    delay: -((at * 3.7) % period),
    drift: at % 2 === 0 ? 1.5 : -1.5,
  };
});

/**
 * The v4's living background: behind the page, on its sheet, a fine grid of
 * dots, one pixel every four, with patches where the dots fade out and come back
 * in. It is as tall as the screen and stays under the eyes while the page
 * scrolls (`position: sticky`, in a box as tall as the sheet that clips it); the
 * foot of the sheet fades it out. The dots are a pale mark of the palette's grey,
 * laid over the paper so that the words on it keep 4.5:1 on a dot too
 * (skins/pageArt.test.tsx); the patches are the colour of the paper. It moves
 * and obeys « Animer le fond » as the other drawings do (see motion.css).
 */
export function PageArt() {
  const [moving] = useAmbient();
  return (
    <span
      aria-hidden="true"
      data-moving={moving ? "" : undefined}
      data-ground="paper"
      className="carnet-art carnet-page"
    >
      <span className="carnet-page-sheet">
        <span className="carnet-page-dots" />
        {PAGE_PATCHES.map(({ left, top, size, ...pace }) => (
          <Veil
            key={left}
            left={`${left.toFixed(1)}%`}
            top={`${top.toFixed(1)}%`}
            width={`min(${size}rem, ${(size * 3.4).toFixed(1)}vmin)`}
            height={`min(${size}rem, ${(size * 3.4).toFixed(1)}vmin)`}
            opacity={0.95}
            {...pace}
          />
        ))}
      </span>
    </span>
  );
}
