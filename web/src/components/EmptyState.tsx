import { useId, type ReactNode } from "react";

import { Contours } from "./Alpenglow";

/**
 * What a list says when it has nothing: its words in a white card, over the
 * faint contour lines of a blank map, under a small dawn on the summits. The
 * words say it all; the drawing is decoration.
 */
export function EmptyState({ title, hint }: { title: ReactNode; hint: ReactNode }) {
  return (
    <div className="card relative isolate flex flex-col items-center gap-1 overflow-hidden px-6 pt-5 pb-6 text-center">
      <Contours className="-z-10 text-iris-800 opacity-[0.09]" />
      <SummitDawn className="mb-2 w-40 mask-[linear-gradient(to_bottom,#000_72%,transparent)]" />
      <p className="card-title">{title}</p>
      <p className="text-sm text-neutral-600">{hint}</p>
    </div>
  );
}

/** The sun rising in a col between two summits, with its arcs, and a trail on the near ridge. */
function SummitDawn({ className = "" }: { className?: string }) {
  const id = useId();
  const sun = `${id}-sun`;
  const arc = `${id}-arc`;
  const near = `${id}-near`;

  return (
    <svg
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 160 76"
      fill="none"
      className={className}
    >
      <defs>
        <radialGradient id={sun} cx="0.5" cy="0.9" r="0.9">
          <stop offset="0" stopColor="#ffb38a" />
          <stop offset="0.6" stopColor="#ff7eb3" />
          <stop offset="1" stopColor="#8b7cff" />
        </radialGradient>
        <linearGradient id={arc} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffb38a" />
          <stop offset="0.55" stopColor="#ff7eb3" />
          <stop offset="1" stopColor="#8b7cff" />
        </linearGradient>
        <linearGradient id={near} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7462f7" />
          <stop offset="1" stopColor="#3a2b99" />
        </linearGradient>
      </defs>
      <g stroke={`url(#${arc})`} strokeWidth="1.5" strokeLinecap="round">
        <path d="M70 50a24 24 0 0 1 48 0" opacity="0.55" />
        <path d="M60 50a34 34 0 0 1 68 0" opacity="0.35" />
        <path d="M50 50a44 44 0 0 1 88 0" opacity="0.2" />
      </g>
      <circle cx="94" cy="50" r="15" fill={`url(#${sun})`} />
      <path
        d="M0 76V58l14-7 9 4 17-19 11 10 8-5 14 14 8-3 12 6 14-20 10 9 7-4 13 10 9-2 14 9v24z"
        className="fill-iris-200"
      />
      <path
        d="M0 76V66l18-6 12 3 17-9 13 7 14-2 14 5 13-7 15 8 13-4 31 9v6z"
        fill={`url(#${near})`}
      />
      <path
        d="M10 69.5 26 64l10 2.5 14-7 11 6"
        stroke="#fff"
        strokeWidth="1.6"
        className="route-dots"
        style={{ strokeDasharray: "0.1 4" }}
      />
    </svg>
  );
}
