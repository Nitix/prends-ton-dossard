import { useI18n } from "../../i18n/I18nProvider";
import { Contours } from "../crete/Alpenglow";
import { Ridges, Sun, SummitIcon, TrailPatch } from "../shared/trail";
import type { BrandMarkProps, HeaderArtProps, HeroArtProps } from "../types";

// The motifs of « Sentier » in the places of the app (see ../README.md): the
// sky of the header and of the sign-in pages, the mark of the app, the heroes
// and the empty lists. The blaze before a title (`Blaze`) is in ../shared/trail.tsx.
// Crête's stand in for the divider.

/** The far ridge, and the near one, which is the colour of the page (the sheet rises out of it). */
const FAR = "var(--motif-ridge-far-from)";
const PAGE = "var(--motif-ridge-near-from)";
/** The near ridge of a hero, which is deeper than the pine behind it. */
const DEEP = "var(--motif-ridge-mid-from)";

/**
 * « Sentier »'s `HeaderArt`: the sky of the header is pine, with the contour
 * lines of a map, the sun rising behind a far ridge, and a near ridge of sand,
 * which is the colour of the sheet of the page: it rises out of the mountains.
 * On the pages to sign in, where the sky is the whole page, the ridges and the
 * sun are at its foot.
 */
export function HeaderArt({ place, sun = true }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span
        aria-hidden="true"
        className="sentier:pointer-events-none sentier:absolute sentier:inset-0 sentier:overflow-hidden"
      >
        <Contours tiled className="sentier:opacity-[0.14]" />
        {sun && (
          <Sun className="header-sun sentier:right-[21%] sentier:bottom-[2.8rem] sentier:size-9 sentier:animate-rise sentier:md:right-auto sentier:md:bottom-[3.6rem] sentier:md:left-[44%] sentier:md:size-12" />
        )}
        <Ridges
          far={FAR}
          near={PAGE}
          className="header-ridges sentier:inset-x-0 sentier:bottom-7 sentier:h-12 sentier:w-full sentier:md:h-[4.5rem]"
        />
        {/* What continues the near ridge under the ridges, behind the round corners of the sheet. */}
        <span
          className="header-foot sentier:absolute sentier:inset-x-0 sentier:bottom-0 sentier:h-7"
          style={{ backgroundColor: PAGE }}
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="sentier:pointer-events-none sentier:absolute sentier:inset-0"
    >
      <Contours className="sentier:text-white sentier:opacity-[0.15]" />
      <Sun className="sentier:right-[19%] sentier:bottom-12 sentier:size-12 sentier:animate-rise sentier:md:right-[22%] sentier:md:bottom-[4.4rem] sentier:md:size-20" />
      <Ridges
        far={FAR}
        near={PAGE}
        className="sentier:inset-x-0 sentier:bottom-0 sentier:h-24 sentier:w-full sentier:md:h-36"
      />
    </span>
  );
}

/**
 * « Sentier »'s `BrandMark`: the name of the app in white on the pine, after the
 * patch of a trail race, the sun rising behind two summits.
 */
export function BrandMark({ size = "md" }: BrandMarkProps) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="sentier:flex sentier:items-center sentier:gap-3">
      <TrailPatch
        className={`sentier:shrink-0 sentier:drop-shadow-[0_1px_2px_var(--motif-mark-shade)] ${big ? "sentier:size-12" : "sentier:size-9"}`}
      />
      <span
        className={`sentier:font-display sentier:leading-none sentier:font-bold sentier:tracking-tight sentier:text-white ${
          big ? "sentier:text-[1.75rem]" : "sentier:text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/**
 * « Sentier »'s `HeroArt`: the pine of the hero with the contour lines of a map,
 * faint where the words are and clearer down by the mountains, the sun rising
 * behind the far ridge on the page of an event; the page of a runner has the
 * ridges only.
 */
export function HeroArt({ place }: HeroArtProps) {
  if (place === "event") {
    return (
      <span
        aria-hidden="true"
        className="sentier:pointer-events-none sentier:absolute sentier:inset-0"
      >
        <Contours className="sentier:mask-[linear-gradient(to_bottom,transparent,rgb(0_0_0/0.4)_40%,#000_85%)] sentier:text-white sentier:opacity-[0.14]" />
        <Sun className="sentier:right-[17%] sentier:bottom-5 sentier:size-12 sentier:animate-rise sentier:md:bottom-7 sentier:md:size-16" />
        <Ridges
          far={FAR}
          near={DEEP}
          className="sentier:inset-x-0 sentier:bottom-0 sentier:h-14 sentier:w-full sentier:md:h-20"
        />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="sentier:pointer-events-none sentier:absolute sentier:inset-0"
    >
      <Contours className="sentier:mask-[linear-gradient(to_bottom,rgb(0_0_0/0.35),#000_80%)] sentier:text-white sentier:opacity-[0.14]" />
      <Ridges
        far={FAR}
        near={DEEP}
        className="sentier:inset-x-0 sentier:bottom-0 sentier:h-8 sentier:w-full sentier:md:h-12"
      />
    </span>
  );
}

/**
 * « Sentier »'s `EmptyArt`: the faint contour lines of a blank page of a map
 * behind the words of an empty list, over a round badge with a summit in it.
 */
export function EmptyArt() {
  return (
    <>
      <Contours className="sentier:-z-10 sentier:text-iris-700 sentier:opacity-[0.09]" />
      <span
        aria-hidden="true"
        className="sentier:mb-2 sentier:flex sentier:size-10 sentier:shrink-0 sentier:items-center sentier:justify-center sentier:rounded-full sentier:bg-card sentier:text-iris-600 sentier:shadow-card sentier:ring-1 sentier:ring-neutral-300"
      >
        <SummitIcon className="sentier:size-5" />
      </span>
    </>
  );
}
