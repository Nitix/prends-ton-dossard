import type { DividerProps } from "../types";

/**
 * The mark before the title of a block: a short dash of lime, skewed like the
 * start of a lane, with its glow. Decoration only.
 */
export function SectionMarker() {
  return (
    <span
      aria-hidden="true"
      className="h-[0.3125rem] w-3.5 flex-none rounded-[1px]"
      style={{
        backgroundColor: "var(--color-iris-600)",
        transform: "skewX(-24deg)",
        boxShadow: "var(--dawn-marker-shadow)",
      }}
    />
  );
}

/** The dashes down the middle of a road, between two blocks of the home page. Decoration only. */
export function Divider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`flex h-8 w-full items-center ${className}`}>
      <span
        className="h-0.5 w-full rounded-[1px]"
        style={{
          backgroundImage:
            "repeating-linear-gradient(90deg, var(--color-neutral-300) 0 14px, transparent 14px 24px)",
        }}
      />
    </div>
  );
}
