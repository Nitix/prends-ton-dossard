import { RIDGE_DIVIDER_PATH } from "./motifPaths";

/** The skyline as a line, without its fill: the same path from (0, y) to (1200, y). */
const RIDGE_LINE_PATH = RIDGE_DIVIDER_PATH.replace(/^M0 120L/, "M").replace(/L1200 120Z$/, "");

/**
 * A divider drawn as a mountain skyline, with the sun just above a col: the one
 * of « Alpage », in the colours of the dawn. Decoration only, hidden from
 * screen readers.
 */
export function RidgeDivider({ className = "" }: { className?: string }) {
  return (
    <div aria-hidden="true" className={`relative h-8 w-full ${className}`}>
      <svg
        focusable="false"
        viewBox="0 0 1200 120"
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
      >
        <path
          d={RIDGE_LINE_PATH}
          fill="none"
          className="stroke-iris-300"
          strokeWidth={1.5}
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span className="absolute top-0.5 left-[68%] size-2.5 rounded-full bg-peach-400 shadow-[0_0_10px_2px_var(--motif-sun-glow)]" />
    </div>
  );
}
