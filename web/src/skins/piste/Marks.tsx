import type { DividerProps } from "../types";

/**
 * Lane lines between two blocks of the home page: three fine lines, as on the
 * track. Decoration only.
 */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`flex h-8 w-full items-center ${className}`}>
      <span
        className="h-[9px] w-full"
        style={{
          backgroundImage:
            "repeating-linear-gradient(to bottom, var(--color-rim) 0 1px, transparent 1px 4px)",
        }}
      />
    </div>
  );
}

/**
 * The art of an empty list: a finish-line checker over its words, in ink and
 * cream. Decoration only.
 */
export function EmptyArt() {
  return (
    <span
      aria-hidden="true"
      className="mb-2 h-3 w-20 rounded-[2px]"
      style={{
        backgroundColor: "var(--color-neutral-900)",
        backgroundImage:
          "repeating-conic-gradient(var(--color-neutral-50) 0 25%, transparent 0 50%)",
        backgroundSize: "10px 10px",
      }}
    />
  );
}
