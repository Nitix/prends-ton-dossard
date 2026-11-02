import type { DividerProps } from "../types";

/** The mark before the title of a block: a small square, tilted. */
export function ExampleMarker() {
  return <span aria-hidden="true" className="example-marker" />;
}

/** A divider: a plain zigzag. */
export function ExampleDivider({ className = "" }: DividerProps) {
  return (
    <div aria-hidden="true" className={`h-8 w-full ${className}`}>
      <svg focusable="false" viewBox="0 0 120 12" preserveAspectRatio="none" className="size-full">
        <path
          d="M0 6 10 1l10 10 10-10 10 10 10-10 10 10 10-10 10 10 10-10 10 10 10-10 10 5"
          fill="none"
          className="stroke-iris-300"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
