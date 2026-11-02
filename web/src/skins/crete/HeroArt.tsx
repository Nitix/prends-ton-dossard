import type { HeroArtProps } from "../types";
import { Contours, Ridges } from "./Alpenglow";

/**
 * Crête's `HeroArt`: the sky of the dawn drawn like a map behind a hero, a glow
 * at its top, and the sun rising behind the ridges at its foot. The map is
 * faint where the words are and clearer down by the mountains; the hero of an
 * event is taller than the one of a runner, and its mountains with it.
 */
export function HeroArt({ place }: HeroArtProps) {
  if (place === "event") {
    return (
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <span className="absolute -top-20 -left-16 size-56 rounded-full bg-iris-400/35 blur-3xl" />
        <Contours className="mask-[linear-gradient(to_bottom,transparent,rgb(0_0_0/0.4)_40%,#000_85%)] text-white opacity-[0.14]" />
        <Ridges className="h-28 md:hidden" center={1560} sun={1870} sunSize={28} steep={1.2} />
        <Ridges
          className="hidden h-36 md:block"
          center={1300}
          sun={1500}
          sunSize={30}
          steep={1.25}
        />
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute -top-16 -left-12 size-48 rounded-full bg-iris-400/35 blur-3xl" />
      <Contours className="mask-[linear-gradient(to_bottom,rgb(0_0_0/0.35),#000_80%)] text-white opacity-[0.14]" />
      <Ridges className="h-24 md:hidden" center={1560} sun={1870} sunSize={24} steep={1.1} />
      <Ridges className="hidden h-28 md:block" center={1300} sun={1500} sunSize={26} steep={1.15} />
    </span>
  );
}
