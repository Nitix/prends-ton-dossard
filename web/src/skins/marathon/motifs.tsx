import { useI18n } from "../../i18n/I18nProvider";
import type { BrandMarkProps, DividerProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Marathon »: la ligne bleue, the line painted on the road to
// guide the runners along the course, in the cobalt of the skin (`iris-600`).
// A start dot, a gentle bend, on to the edge of the page as if the course went
// on. They are decoration: hidden from screen readers, with no words in them
// (the variant wrote « KM 0 » beside the line: that waits for a deeper skin).
// Nothing moves: the variant drew the line in once, a still page has it drawn.

/** The ring that is a station of the course: white inside, cobalt around. */
const STATION = "marathon:rounded-full marathon:border-iris-600 marathon:bg-white";

/** The course, in a box 400 wide and 40 high that stretches to the width of its parent. */
const COURSE = "M0 30 C 70 30, 90 8, 160 10 S 260 34, 320 24 S 380 14, 400 14";

/**
 * The blue line as tall as its box, from the start dot (`start` from the left,
 * on the flat beginning of the line) on to the right edge: a line 3 px thick
 * whatever the width of the page.
 */
function BlueLine({ className = "", start = "0.25rem" }: { className?: string; start?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`marathon:pointer-events-none marathon:absolute marathon:block ${className}`}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox="0 0 400 40"
        preserveAspectRatio="none"
        className="marathon:absolute marathon:inset-0 marathon:block marathon:size-full marathon:overflow-visible"
      >
        <path
          d={COURSE}
          fill="none"
          className="marathon:stroke-iris-600"
          strokeWidth={3}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className={`marathon:absolute marathon:top-[75%] marathon:size-3.5 marathon:-translate-y-1/2 marathon:border-[3px] ${STATION}`}
        style={{ left: start }}
      />
    </span>
  );
}

/** A long course across the foot of the pages to sign in, with a mark every few steps, like the kilometres of a road. */
const POSTER = "M-10 150 C 50 150, 90 70, 170 82 S 270 170, 330 140 S 380 60, 420 52";

/**
 * The sky behind the name. In the header of a page: the blue line along its
 * foot, just over the sheet of the page. On the pages to sign in: the poster,
 * the course across the foot of the page, under the card.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span
        aria-hidden="true"
        className="marathon:pointer-events-none marathon:absolute marathon:inset-0"
      >
        <BlueLine className="marathon:inset-x-0 marathon:bottom-9 marathon:h-10" start="1.125rem" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="marathon:pointer-events-none marathon:absolute marathon:inset-0"
    >
      <span className="marathon:absolute marathon:inset-x-0 marathon:bottom-0 marathon:block marathon:h-56 marathon:md:h-64">
        <svg
          aria-hidden="true"
          focusable="false"
          viewBox="0 0 400 200"
          preserveAspectRatio="none"
          className="marathon:absolute marathon:inset-0 marathon:block marathon:size-full marathon:overflow-visible"
        >
          <path
            d={POSTER}
            fill="none"
            className="marathon:stroke-iris-600"
            strokeWidth={3}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          <path
            d={POSTER}
            fill="none"
            className="marathon:stroke-white"
            strokeOpacity={0.45}
            strokeWidth={9}
            strokeDasharray="1.5 38"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        <span
          className={`marathon:absolute marathon:top-3/4 marathon:left-5 marathon:size-3.5 marathon:-translate-y-1/2 marathon:border-[3px] ${STATION}`}
        />
      </span>
    </span>
  );
}

/** A start dot before the name of the app, on the sky: the beginning of the course. */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="marathon:flex marathon:items-center marathon:gap-3">
      <span
        aria-hidden="true"
        className={`marathon:shrink-0 ${STATION} ${big ? "marathon:size-5 marathon:border-[5px]" : "marathon:size-4 marathon:border-4"}`}
      />
      <span
        className={`marathon:font-display marathon:leading-[0.92] marathon:font-black marathon:tracking-[-0.02em] marathon:text-balance marathon:text-white marathon:uppercase marathon:[word-spacing:0.06em] ${
          big ? "marathon:text-[1.875rem]" : "marathon:text-[1.375rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/** The poster of an event or of a runner: the blue line along the foot of the hero, bleeding to its edge. */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span
      aria-hidden="true"
      className="marathon:pointer-events-none marathon:absolute marathon:inset-0"
    >
      <BlueLine
        className={
          place === "event"
            ? "marathon:inset-x-0 marathon:bottom-5 marathon:h-10"
            : "marathon:inset-x-0 marathon:bottom-2 marathon:h-8"
        }
        start="1.25rem"
      />
    </span>
  );
}

/** Between two blocks of the home page: the course goes on. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div
      aria-hidden="true"
      className={`course-divider marathon:relative marathon:h-8 marathon:w-full ${className}`}
    >
      <BlueLine className="marathon:inset-0" start="0rem" />
    </div>
  );
}

/** Before the title of a block: a station on the course, a white dot ringed with cobalt. */
export function SectionMarker() {
  return (
    <span
      aria-hidden="true"
      className={`marathon:size-3 marathon:flex-none marathon:border-[3px] ${STATION}`}
    />
  );
}

/** A course with nobody on it yet, from its start dot to the ink dot of the finish, over the words of an empty list. */
export function EmptyArt() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 240 32"
      className="marathon:mb-3 marathon:h-8 marathon:w-48 marathon:max-w-full"
    >
      <path
        d="M6 22 C 50 22, 60 6, 110 8 S 170 28, 234 12"
        fill="none"
        className="marathon:stroke-iris-600"
        strokeWidth={3}
        strokeLinecap="round"
      />
      <circle
        cx="6"
        cy="22"
        r="5"
        strokeWidth={3}
        className="marathon:fill-white marathon:stroke-iris-600"
      />
      <circle cx="234" cy="12" r="5" className="marathon:fill-ink" />
    </svg>
  );
}
