import type { HeaderArtProps } from "../types";
import { Contours, Ridges } from "./Alpenglow";
import { DawnSky } from "./Brand";

/**
 * Crête's `HeaderArt`: the sky of the dawn behind the name of the app. In the
 * header of a page, its map, its glows and its ridges (`DawnSky`); on the pages
 * to sign in, where the sky is the whole page, a taller dawn over the ridges,
 * the sun rising behind them.
 */
export function HeaderArt({ place, sun = true }: HeaderArtProps) {
  if (place === "header") return <DawnSky sun={sun} />;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0">
      <span className="absolute -top-16 -left-20 size-72 rounded-full bg-iris-400/40 blur-3xl" />
      <Contours className="text-white opacity-[0.16]" />
      <Ridges
        className="h-[15.75rem] md:hidden"
        center={1330}
        sun={1500}
        sunSize={30}
        steep={2.2}
        sky={300}
      />
      <Ridges
        className="hidden h-[24rem] md:block"
        center={1560}
        sun={1500}
        sunSize={34}
        steep={2.2}
        sky={300}
      />
    </span>
  );
}
