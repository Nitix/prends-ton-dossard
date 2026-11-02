import type { CSSProperties } from "react";

// The motifs of a race bib, drawn in CSS and inline SVG, in the tokens of the
// palette (coral is `peach`, the sun `blush`, the sky `iris`). Decoration only:
// hidden from screen readers, they never say what the words around them do not.

/** A punched hole of a bib: the sand of the page through the paper, with a shade at its top. */
const HOLE: CSSProperties = {
  backgroundColor: "var(--color-neutral-50)",
  boxShadow: "inset 0 1px 1.5px color-mix(in srgb, var(--color-ink) 35%, transparent)",
};

/** The steel of a safety pin, a cool grey: the navy of the ink, a quarter of the white of the card in it. */
const STEEL = "color-mix(in srgb, var(--color-neutral-600) 75%, var(--color-card))";

/**
 * The four punched holes of a bib, in the corners of the box around it, which
 * must be positioned (a hero is). `top` is how far down the top two are when
 * they must sit in the middle of a band (0.625rem otherwise).
 */
export function BibHoles({ top }: { top?: string } = {}) {
  const hole = "absolute size-2 rounded-full";
  // A given `top` is set inline, over the class that says 0.625rem.
  const upper = top === undefined ? HOLE : { ...HOLE, top };
  return (
    <>
      <span className={`${hole} top-2.5 left-2.5`} style={upper} />
      <span className={`${hole} top-2.5 right-2.5`} style={upper} />
      <span className={`${hole} bottom-2.5 left-2.5`} style={HOLE} />
      <span className={`${hole} right-2.5 bottom-2.5`} style={HOLE} />
    </>
  );
}

/** A safety pin, the kind that holds a bib on a shirt: its coil at the left, its head at the right. */
export function SafetyPin({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 72 24"
      fill="none"
      className={className}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* The coil, the two legs of wire, and the head that closes them. */}
      <circle cx="10" cy="12" r="6" style={{ stroke: STEEL }} strokeWidth="3" />
      <path d="M15 7.5 L 58 6.5 M 15 16.5 L 57 9.5" style={{ stroke: STEEL }} strokeWidth="3" />
      <path d="M16 7.5 L 56 6.6" stroke="#fff" strokeOpacity="0.75" strokeWidth="1" />
      <rect x="53" y="3" width="16" height="9.5" rx="4.75" style={{ fill: "var(--color-ink)" }} />
      <rect x="56" y="4.8" width="8" height="2" rx="1" fill="#fff" fillOpacity="0.35" />
    </svg>
  );
}

/**
 * A little bib, the mark of the app: a coral band, four holes and the number
 * 42, drawn as lines so that the mark holds no text. Sharp at any size.
 */
export function BibMark({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 40 32" className={className}>
      <rect
        x="1"
        y="1"
        width="38"
        height="30"
        rx="6"
        style={{ fill: "var(--color-card)", stroke: "var(--color-ink)" }}
        strokeWidth="2"
      />
      <path
        d="M2 7 a 5 5 0 0 1 5 -5 h 26 a 5 5 0 0 1 5 5 v 3 H 2 z"
        style={{ fill: "var(--color-peach-500)" }}
      />
      <circle cx="6.5" cy="6" r="1.4" style={{ fill: "var(--color-neutral-50)" }} />
      <circle cx="33.5" cy="6" r="1.4" style={{ fill: "var(--color-neutral-50)" }} />
      <circle cx="6.5" cy="26.5" r="1.4" style={{ fill: "var(--color-neutral-200)" }} />
      <circle cx="33.5" cy="26.5" r="1.4" style={{ fill: "var(--color-neutral-200)" }} />
      <g
        fill="none"
        style={{ stroke: "var(--color-ink)" }}
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* A 4: its slanted stroke, its bar, its stem. */}
        <path d="M17.5 15.8 L12.2 22.4 H20.6 M17.5 15.8 V25.5" />
        {/* A 2: its bowl, its foot. */}
        <path d="M22.4 18 C22.4 14.8 29 14.8 29 18.4 C29 21.5 23 22.8 22.4 25.2 H29.2" />
      </g>
    </svg>
  );
}
