import { Figure } from "../../components/Figure";

const SEPARATOR = " · ";

/**
 * The figures of a track, over its map and its profile: its length, its gain
 * and its loss as tiles (`.stat-tile`), then its lowest and highest points.
 * The separators stay in the text, for a screen reader, and so does the space
 * before "D+" (at the start of its line in the tile, the space does not show).
 */
export function TrackFigures({
  figures,
  altitude,
}: {
  /**
   * Its figures in words, in order: its length, then its gain and its loss
   * when it has altitudes (« 12,6 km », « 724 m D+ », « 728 m D− »).
   */
  figures: readonly string[];
  /** Its lowest and highest points in words (« altitude 450 m à 1 157 m »), or null without altitudes. */
  altitude: string | null;
}) {
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
