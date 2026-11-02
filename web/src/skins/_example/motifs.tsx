import type { DividerProps } from "../types";

// The two motifs of « Exemple (dev) ». They are styled inline, with the colours
// of the theme: the folders of the skins of development are not scanned by
// Tailwind (styles.css), so that nothing of them reaches the CSS of a build.

/** The mark before the title of a block: a small square, tilted, in yellow. */
export function ExampleMarker() {
  return (
    <span
      aria-hidden="true"
      data-example-marker
      style={{
        flex: "none",
        width: "0.6rem",
        height: "0.6rem",
        rotate: "45deg",
        backgroundColor: "#e3b505",
      }}
    />
  );
}

/** A divider: a plain zigzag. */
export function ExampleDivider({ className }: DividerProps) {
  return (
    <div aria-hidden="true" className={className} style={{ height: "2rem", width: "100%" }}>
      <svg
        focusable="false"
        viewBox="0 0 120 12"
        preserveAspectRatio="none"
        style={{ width: "100%", height: "100%" }}
      >
        <path
          d="M0 6 10 1l10 10 10-10 10 10 10-10 10 10 10-10 10 10 10-10 10 10 10-10 10 5"
          fill="none"
          style={{ stroke: "var(--color-iris-300)" }}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
