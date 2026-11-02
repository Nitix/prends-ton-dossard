import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Rétro »: the three stripes of an old track suit (burnt
// orange, mustard, teal) and the sun that sets behind them, as on the patch of
// a running club of the seventies. The stripes are Crête's three ranges by what
// the skin makes of them: orange is `blush`, mustard is `peach`, teal is `iris`
// (see palette.css). They are decoration: hidden from screen readers, with no
// words in them (the seal of the login page had « club de course » round it:
// that waits for a deeper skin). Nothing moves.

/** The classes that fill a stripe, from the top: on the paper, and on the brown sky where teal is lighter. */
const ON_PAPER = ["fill-blush-500", "fill-peach-400", "fill-iris-500"] as const;
const ON_SKY = ["fill-blush-500", "fill-peach-400", "fill-iris-400"] as const;

/**
 * The three stripes with a gap of the page between them, as wide as their
 * parent, each `band` tall and `gap` apart (in pixels).
 */
function Stripes({
  band,
  gap,
  sky = false,
  className = "",
}: {
  band: number;
  gap: number;
  sky?: boolean;
  className?: string;
}) {
  const height = 3 * band + 2 * gap;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="100%"
      height={height}
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className={`pointer-events-none block ${className}`}
    >
      {(sky ? ON_SKY : ON_PAPER).map((fill, i) => (
        <rect key={fill} x="0" y={i * (band + gap)} width="100" height={band} className={fill} />
      ))}
    </svg>
  );
}

/** The point of the ray at `degrees`, on a circle of 100 round the sun. */
function point(degrees: number): string {
  const angle = (degrees * Math.PI) / 180;
  return `${(100 * Math.cos(angle)).toFixed(2)} ${(100 * Math.sin(angle)).toFixed(2)}`;
}

/** The rays of a sun over a part of the sky, as one path from its centre: a ray of 7.5° every 15°. */
function rays(from: number, to: number): string {
  const wedges: string[] = [];
  for (let start = from; start < to; start += 15) {
    wedges.push(`M0 0L${point(start)}L${point(start + 7.5)}Z`);
  }
  return wedges.join("");
}

/** The sun all round, and the half of it that rises over a horizon. */
const SUNBURST = rays(0, 360);
const HALF_SUNBURST = rays(180, 360);

/** Rays that fade as they go: a round sunburst, in mustard, that a box may hold in a corner. */
function Sunburst({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-100 -100 200 200"
      className={`pointer-events-none block mask-[radial-gradient(closest-side,#000_30%,transparent)] ${className}`}
    >
      <path d={SUNBURST} className="fill-peach-400" />
    </svg>
  );
}

/**
 * The sky behind the name. In the header of a page: the stripes along its foot,
 * just over the sheet of the page, and where the sun is rising, rays in its
 * corner. On the pages to sign in: the sun going down behind the stripes at the
 * foot of the page, its rays over the whole sky, under the card.
 */
export function HeaderArt({ place, sun = true }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        {sun && <Sunburst className="absolute -top-24 -right-16 size-72 opacity-[0.2]" />}
        <Stripes band={4} gap={2} sky className="absolute inset-x-0 bottom-7 w-full" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="-100 -100 200 100"
        className="absolute bottom-14 left-1/2 block h-[30rem] w-[60rem] max-w-none -translate-x-1/2 mask-[radial-gradient(ellipse_50%_100%_at_50%_100%,#000_25%,transparent)] opacity-[0.2]"
      >
        <path d={HALF_SUNBURST} className="fill-peach-400" />
      </svg>
      <span className="absolute bottom-14 left-1/2 h-24 w-48 -translate-x-1/2 rounded-t-full bg-peach-400 md:h-28 md:w-56" />
      <Stripes band={14} gap={7} sky className="absolute inset-x-0 bottom-0 w-full" />
    </span>
  );
}

/**
 * The sign of the club: a sun going down behind three stripes, in a ring of
 * paper, as on a seventies patch, and the name of the app beside it.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const clip = useId();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-3">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 40 40"
        className={`shrink-0 ${big ? "size-11" : "size-9"}`}
      >
        <defs>
          <clipPath id={clip}>
            <circle cx="20" cy="20" r="16.5" />
          </clipPath>
        </defs>
        <circle cx="20" cy="20" r="19" className="fill-card" />
        <circle cx="20" cy="20" r="16.5" className="fill-ink" />
        <g clipPath={`url(#${clip})`}>
          <circle cx="20" cy="23" r="10.5" className="fill-peach-400" />
          <rect x="0" y="23" width="40" height="3.6" className="fill-blush-500" />
          <rect x="0" y="27.6" width="40" height="3.6" className="fill-peach-400" />
          <rect x="0" y="32.2" width="40" height="8" className="fill-iris-400" />
        </g>
      </svg>
      <span
        className={`font-display leading-none font-extrabold tracking-tight text-white ${
          big ? "text-[1.75rem]" : "text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/** The poster of an event or of a runner: rays of the sun in a corner of the hero, the stripes along its foot. */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Sunburst
        className={
          place === "event"
            ? "absolute -top-20 -right-16 size-80 opacity-[0.22]"
            : "absolute -top-16 -right-12 size-64 opacity-[0.22]"
        }
      />
      <Stripes
        band={place === "event" ? 5 : 4}
        gap={2}
        sky
        className="absolute inset-x-0 bottom-0 w-full"
      />
    </span>
  );
}

/** Between two blocks of the home page: thin stripes, fading at each end. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`flex h-8 w-full items-center ${className}`}>
      <Stripes
        band={2}
        gap={1.5}
        className="w-full mask-[linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]"
      />
    </div>
  );
}

/** Before the title of a block: three small stripes, like a club badge. */
export function SectionMarker() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width="18"
      height="11"
      viewBox="0 0 18 11"
      className="flex-none"
    >
      <rect x="0" y="0" width="18" height="3" rx="1" className="fill-blush-500" />
      <rect x="0" y="4" width="18" height="3" rx="1" className="fill-peach-400" />
      <rect x="0" y="8" width="18" height="3" rx="1" className="fill-iris-500" />
    </svg>
  );
}

/** A small sun with its rays over a line of stripes: the picture of a list with nothing in it. */
export function EmptyArt() {
  const clip = useId();
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 96 56"
      className="mb-2 h-14 w-24 shrink-0"
    >
      <defs>
        <clipPath id={clip}>
          <rect x="0" y="0" width="96" height="36" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        {Array.from({ length: 9 }, (_, i) => {
          const angle = (Math.PI * (i + 0.5)) / 9;
          return (
            <line
              key={i}
              x1={48 - Math.cos(angle) * 22}
              y1={36 - Math.sin(angle) * 22}
              x2={48 - Math.cos(angle) * 44}
              y2={36 - Math.sin(angle) * 44}
              className="stroke-peach-400"
              strokeWidth="4"
              strokeLinecap="round"
            />
          );
        })}
        <circle cx="48" cy="36" r="17" className="fill-peach-400 stroke-ink" strokeWidth="2.5" />
      </g>
      <rect x="4" y="38" width="88" height="4" rx="2" className="fill-blush-500" />
      <rect x="12" y="44.5" width="72" height="4" rx="2" className="fill-peach-400" />
      <rect x="20" y="51" width="56" height="4" rx="2" className="fill-iris-500" />
    </svg>
  );
}
