import { useI18n } from "../../i18n/I18nProvider";
import { Contours } from "../crete/Alpenglow";
import type { BrandMarkProps, HeaderArtProps, HeroArtProps } from "../types";
import { Ridges, Sun, SummitIcon, TrailPatch } from "./motifs";

// The motifs of « Sentier » in the places of the app (see ../README.md): the
// sky of the header and of the sign-in pages, the mark of the app, the heroes
// and the empty lists. The blaze before a title (`Blaze`) is in ./motifs.tsx.
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
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <Contours tiled className="opacity-[0.14]" />
        {sun && (
          <Sun className="header-sun right-[21%] bottom-[2.8rem] size-9 animate-rise md:right-auto md:bottom-[3.6rem] md:left-[44%] md:size-12" />
        )}
        <Ridges
          far={FAR}
          near={PAGE}
          className="header-ridges inset-x-0 bottom-7 h-12 w-full md:h-[4.5rem]"
        />
        {/* What continues the near ridge under the ridges, behind the round corners of the sheet. */}
        <span
          className="header-foot absolute inset-x-0 bottom-0 h-7"
          style={{ backgroundColor: PAGE }}
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Contours className="text-white opacity-[0.15]" />
      <Sun className="right-[19%] bottom-12 size-12 animate-rise md:right-[22%] md:bottom-[4.4rem] md:size-20" />
      <Ridges far={FAR} near={PAGE} className="inset-x-0 bottom-0 h-24 w-full md:h-36" />
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
    <span className="flex items-center gap-3">
      <TrailPatch
        className={`shrink-0 drop-shadow-[0_1px_2px_var(--motif-mark-shade)] ${big ? "size-12" : "size-9"}`}
      />
      <span
        className={`font-display leading-none font-bold tracking-tight text-white ${
          big ? "text-[1.75rem]" : "text-[1.3125rem]"
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
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <Contours className="mask-[linear-gradient(to_bottom,transparent,rgb(0_0_0/0.4)_40%,#000_85%)] text-white opacity-[0.14]" />
        <Sun className="right-[17%] bottom-5 size-12 animate-rise md:bottom-7 md:size-16" />
        <Ridges far={FAR} near={DEEP} className="inset-x-0 bottom-0 h-14 w-full md:h-20" />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <Contours className="mask-[linear-gradient(to_bottom,rgb(0_0_0/0.35),#000_80%)] text-white opacity-[0.14]" />
      <Ridges far={FAR} near={DEEP} className="inset-x-0 bottom-0 h-8 w-full md:h-12" />
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
      <Contours className="-z-10 text-iris-700 opacity-[0.09]" />
      <span
        aria-hidden="true"
        className="mb-2 flex size-10 shrink-0 items-center justify-center rounded-full bg-card text-iris-600 shadow-card ring-1 ring-neutral-300"
      >
        <SummitIcon className="size-5" />
      </span>
    </>
  );
}
