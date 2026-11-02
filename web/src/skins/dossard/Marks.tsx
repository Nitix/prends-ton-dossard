import type { DividerProps } from "../types";

/**
 * A tear-off line between two blocks of the home page, dashed as the one of a
 * bib. Decoration only.
 */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div
      aria-hidden="true"
      className={`dossard:flex dossard:h-8 dossard:w-full dossard:items-center ${className}`}
    >
      <span
        className="dossard:h-0.5 dossard:w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, var(--color-neutral-300) 0 8px, transparent 8px 14px)",
        }}
      />
    </div>
  );
}

/** A dot of confetti in the colour of a token, at a place of the box. */
export const dot = (at: string, colour: string, size: number) =>
  `radial-gradient(circle at ${at}, var(${colour}) 0 ${size}px, transparent ${size + 0.5}px)`;

/** Confetti over the words of an empty list: coral, sun and sky, scattered. Decoration only. */
export function EmptyArt() {
  return (
    <span
      aria-hidden="true"
      className="dossard:mb-1 dossard:h-12 dossard:w-full"
      style={{
        backgroundImage: [
          dot("12% 30%", "--color-peach-500", 3),
          dot("28% 75%", "--color-blush-200", 4),
          dot("46% 20%", "--color-iris-300", 2.5),
          dot("63% 64%", "--color-peach-500", 2),
          dot("78% 26%", "--color-blush-200", 3),
          dot("90% 70%", "--color-iris-300", 4),
        ].join(", "),
      }}
    />
  );
}
