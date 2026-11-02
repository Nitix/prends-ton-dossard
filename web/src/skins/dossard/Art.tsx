import { useId } from "react";

import type { HeaderArtProps, HeroArtProps } from "../types";
import { BibHoles, SafetyPin } from "./Bib";
import { dot } from "./Marks";

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
      className="dossard:pointer-events-none dossard:absolute dossard:inset-x-0 dossard:top-0 dossard:h-3 dossard:w-full"
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

/** The confetti of a start village, scattered over the sky under the card: coral, sun and sky. */
const CONFETTI = [
  dot("8% 14%", "--color-peach-500", 5),
  dot("22% 46%", "--color-blush-200", 6),
  dot("37% 22%", "--color-iris-300", 4),
  dot("51% 62%", "--color-peach-500", 3.5),
  dot("64% 30%", "--color-blush-200", 4.5),
  dot("79% 56%", "--color-iris-300", 6),
  dot("92% 18%", "--color-peach-500", 4),
  dot("14% 78%", "--color-iris-300", 3.5),
  dot("44% 88%", "--color-blush-200", 4),
  dot("70% 84%", "--color-peach-500", 5),
  dot("88% 74%", "--color-blush-200", 3),
].join(", ");

/**
 * The art of the sky of the app: the garland along the top of the header of a
 * page. On the pages to sign in, where the sky is the whole page and the card
 * covers its middle, the art is around the card: the garland at the top, the
 * confetti of the start village under the card, and a second garland strung
 * along the foot of the page.
 */
export function HeaderArt({ place }: HeaderArtProps) {
  if (place === "header") {
    return (
      <span
        aria-hidden="true"
        className="dossard:pointer-events-none dossard:absolute dossard:inset-0 dossard:overflow-hidden"
      >
        <Garland />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="dossard:pointer-events-none dossard:absolute dossard:inset-0 dossard:overflow-hidden"
    >
      <Garland />
      <span
        className="dossard:absolute dossard:inset-x-0 dossard:bottom-6 dossard:h-[18rem] dossard:mask-[linear-gradient(to_bottom,transparent,#000_30%)]"
        style={{ backgroundImage: CONFETTI }}
      />
      <span className="dossard:absolute dossard:inset-x-0 dossard:bottom-0 dossard:block dossard:h-3 dossard:-scale-y-100">
        <Garland />
      </span>
    </span>
  );
}

/**
 * The art behind a hero, which is a bib: its four punched holes, and on the
 * hero of an event the two safety pins that hold it by its top corners.
 */
export function HeroArt({ place }: HeroArtProps) {
  return (
    <span
      aria-hidden="true"
      className="dossard:pointer-events-none dossard:absolute dossard:inset-0"
    >
      <BibHoles />
      {place === "event" && (
        <>
          <SafetyPin className="dossard:absolute dossard:top-1 dossard:left-1.5 dossard:w-14 dossard:-rotate-6" />
          <SafetyPin className="dossard:absolute dossard:top-1 dossard:right-1.5 dossard:w-14 dossard:-scale-x-100 dossard:rotate-6" />
        </>
      )}
    </span>
  );
}
