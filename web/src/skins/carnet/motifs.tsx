import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../types";
import { DotFrance, IsoArch } from "./illustrations";

// The motifs of « Carnet »: a training logbook drawn like a technical sheet,
// in hairlines and dots. A fine grid of dots (the variant's sheet, drawn here
// in the sky and the heroes, with patches where it fades), a bib on a tile, the
// thin rule that ends in a cross, the dotted ring of a data point, dotted France
// and the isometric arch of a start line. They are decoration: hidden from
// screen readers, with no words in them.
//
// Nothing moves. The variant's sheet was alive (its patches faded out and in
// for ever, its orbits turned): the app has no animation that never ends (see
// src/motion.test.ts: it keeps a phone at work), so the patches stand still, as
// they would for whoever asked for less motion.

/** The grid of dots of the sheet: a square of one pixel every 6, white, over a dark sky. */
const DOTS = {
  backgroundImage:
    "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='6'%3E%3Crect x='2' y='2' width='1' height='1' fill='%23fff' fill-opacity='.22'/%3E%3C/svg%3E\")",
  backgroundSize: "6px 6px",
} as const;

/** Patches of the sky over the dots, where the sheet fades: where, how big (rem), how strongly. */
const VEILS = [
  { left: "2%", top: "-20%", size: 11, opacity: 0.9 },
  { left: "38%", top: "40%", size: 13, opacity: 0.75 },
  { left: "66%", top: "-30%", size: 12, opacity: 0.9 },
  { left: "86%", top: "35%", size: 10, opacity: 0.65 },
] as const;

/** The sheet of dots, in its box. Over it, with `veils`, patches of the sky where it fades, never all of it. */
function Dots({ className = "", veils = false }: { className?: string; veils?: boolean }) {
  return (
    <span aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      <span className="absolute inset-0" style={DOTS} />
      {veils &&
        VEILS.map(({ left, top, size, opacity }) => (
          <span
            key={left}
            className="absolute rounded-full bg-[radial-gradient(closest-side,var(--dawn-sky-color)_45%,transparent)]"
            style={{ left, top, width: `${size}rem`, height: `${size}rem`, opacity }}
          />
        ))}
    </span>
  );
}

/**
 * The sky behind the name. In the header of a page: the sheet of dots, with its
 * patches. On the pages to sign in: the same over the whole page, and under the
 * card the arch of a start line, in isometric hairlines, on a ground of dots.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return <Dots veils className="mask-[linear-gradient(to_bottom,#000_55%,transparent)]" />;
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Dots veils />
      <IsoArch className="absolute bottom-0 left-1/2 w-96 max-w-none -translate-x-1/2 mask-[radial-gradient(ellipse_65%_85%_at_50%_58%,#000_55%,transparent)] md:w-[34rem]" />
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
    <span className="flex items-center gap-3">
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 32 32"
        className={`shrink-0 ${big ? "size-11" : "size-9"}`}
      >
        <rect
          x="0.5"
          y="0.5"
          width="31"
          height="31"
          rx="8"
          className="fill-card stroke-neutral-300"
        />
        <rect
          x="6.5"
          y="8.5"
          width="19"
          height="15"
          rx="2.5"
          fill="none"
          className="stroke-ink"
          strokeWidth="1.4"
        />
        <circle cx="9.3" cy="11.3" r="0.95" className="fill-ink" />
        <circle cx="22.7" cy="11.3" r="0.95" className="fill-ink" />
        <circle cx="9.3" cy="20.7" r="0.95" className="fill-ink" />
        <circle cx="22.7" cy="20.7" r="0.95" className="fill-ink" />
        <path
          d="M12.5 14.6h7"
          className="stroke-iris-600"
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <path d="M13.5 18.6h5" className="stroke-ink" strokeWidth="1.1" strokeLinecap="round" />
      </svg>
      <span
        className={`leading-none font-semibold tracking-[-0.02em] text-white ${
          big ? "text-[1.625rem]" : "text-[1.25rem]"
        }`}
      >
        {name ? (
          <>
            {name[0]}{" "}
            <span className="font-serif text-[1.14em] leading-[0.9] font-normal tracking-[-0.01em] italic">
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
 * The orbits of a runner: a thin circle, a dotted one with three dots of data on
 * it, round a corner of the hero. In white over the navy,
 * the data in teal, gold and indigo.
 */
function Orbit({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="-120 -120 240 240"
      className={`pointer-events-none block ${className}`}
    >
      <circle r="110" fill="none" stroke="#fff" strokeOpacity="0.1" />
      <circle r="84" fill="none" stroke="#fff" strokeOpacity="0.16" />
      <g>
        <circle
          r="60"
          fill="none"
          stroke="#fff"
          strokeOpacity="0.3"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeDasharray="0.01 5"
        />
        <circle
          cx="84"
          cy="0"
          r="4"
          className="stroke-white"
          strokeWidth="2"
          style={{ fill: "var(--dawn-ring-from)" }}
        />
        <circle cx="-42" cy="-72.7" r="4" className="fill-peach-400" />
        <circle cx="-5" cy="59.8" r="4" className="fill-blush-400" />
      </g>
    </svg>
  );
}

/** The poster of an event or of a runner: the sheet of dots fading towards the foot, and the orbits in a corner. */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Dots
        className={
          place === "event"
            ? "mask-[linear-gradient(to_bottom,rgb(0_0_0/0.3),#000_85%)]"
            : "mask-[linear-gradient(to_left,#000,transparent_85%)]"
        }
      />
      <Orbit
        className={
          place === "event"
            ? "absolute -top-20 -right-20 size-72 opacity-80"
            : "absolute -top-16 -right-16 size-60 opacity-80"
        }
      />
    </span>
  );
}

/** A cross where two rules meet, as on a drafting sheet. */
function Cross() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 9 9" className="size-[9px] flex-none">
      <path d="M4.5 0v9M0 4.5h9" className="stroke-neutral-400" strokeWidth="1" />
    </svg>
  );
}

/** Between two blocks of the home page: a hairline, and a small cross at each end. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`flex h-8 w-full items-center gap-1 ${className}`}>
      <Cross />
      <span className="h-px flex-1 bg-neutral-300" />
      <Cross />
    </div>
  );
}

/** Before the title of a block: a ring of dots, and a node of data on it. */
export function SectionMarker() {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 16 16" className="size-4 flex-none">
      <circle
        cx="8"
        cy="8"
        r="5.6"
        fill="none"
        className="stroke-neutral-600"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="0.01 2.7"
      />
      <circle cx="12.1" cy="3.9" r="2.3" className="fill-blush-500" />
    </svg>
  );
}

/** France in dots, over the words of a list with nothing in it. */
export function EmptyArt() {
  return <DotFrance className="mb-3 w-28" />;
}
