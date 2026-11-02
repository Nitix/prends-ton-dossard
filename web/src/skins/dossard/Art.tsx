import { useId } from "react";

import type { HeaderArtProps, HeroArtProps } from "../types";
import { BibHoles, SafetyPin } from "./Bib";

/**
 * The garland of pennants of a start village, along the top edge of its box:
 * coral, sun and sky, on a line. Drawn as a pattern, in the tokens of the
 * palette.
 */
function Garland() {
  const id = useId();

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className="pointer-events-none absolute inset-x-0 top-0 h-3 w-full"
    >
      <defs>
        <pattern id={id} width="48" height="12" patternUnits="userSpaceOnUse">
          <path
            d="M0 0.5h48"
            fill="none"
            style={{ stroke: "var(--color-neutral-50)" }}
            strokeOpacity="0.3"
          />
          <path d="M2 1h12l-6 10z" style={{ fill: "var(--color-peach-500)" }} />
          <path d="M18 1h12l-6 10z" style={{ fill: "var(--color-blush-200)" }} />
          <path d="M34 1h12l-6 10z" style={{ fill: "var(--color-iris-300)" }} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

/**
 * The art of the sky of the app: the garland along the top of the header of a
 * page, and of the pages to sign in, where the sky is the whole page.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 ${place === "header" ? "overflow-hidden" : ""}`}
    >
      <Garland />
    </span>
  );
}

/**
 * The art behind a hero, which is a bib: its four punched holes, and on the
 * hero of an event the two safety pins that hold it by its top corners.
 */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <BibHoles />
      {place === "event" && (
        <>
          <SafetyPin className="absolute top-1 left-1.5 w-14 -rotate-6" />
          <SafetyPin className="absolute top-1 right-1.5 w-14 -scale-x-100 rotate-6" />
        </>
      )}
    </span>
  );
}
