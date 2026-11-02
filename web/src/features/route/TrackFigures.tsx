import { Figure } from "../../components/Figure";
import { skinnable } from "../../skins/components";
import type { TrackFiguresProps } from "../../skins/types";

const SEPARATOR = " · ";

/**
 * The figures of a track, over its map and its profile: its length, its gain
 * and its loss as tiles (`.stat-tile`), then its lowest and highest points.
 * The separators stay in the text, for a screen reader, and so does the space
 * before "D+" (at the start of its line in the tile, the space does not show).
 * A skin's variant may set them as one line of split times, or on a picture of
 * where the track starts (`start`), keeping every figure and the altitude.
 */
export function TrackFiguresBase({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures flex gap-2">
        {figures.map((part, i) => {
          const [, value, suffix] = /^(.*?)( D[+−-])?$/u.exec(part) ?? [part, part, undefined];
          return (
            <span
              key={part}
              className="stat-tile flex min-w-0 flex-1 flex-col items-center justify-center rounded-2xl bg-neutral-50 px-2 py-2.5 text-center ring-1 ring-neutral-100"
            >
              {i > 0 && <span className="sr-only">{SEPARATOR}</span>}
              <Figure className="font-display text-[1.0625rem] leading-tight font-extrabold tracking-tight text-ink">
                {value ?? part}
              </Figure>
              {suffix !== undefined && (
                <span className="text-xs font-bold text-iris-700">{suffix}</span>
              )}
            </span>
          );
        })}
      </p>
      {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
    </>
  );
}

/** The figures of a track, as the skin of the page draws them at the depth of the build (Crête's tiles above, by default). */
export const TrackFigures = skinnable("TrackFigures", TrackFiguresBase);
