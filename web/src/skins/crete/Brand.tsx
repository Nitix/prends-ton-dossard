import { useId } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { Contours, NIGHT, Ridges } from "./Alpenglow";

/**
 * The name of the app in white on the sky, after its mark: a small white tile
 * with the sun rising behind two summits, and a trail on the crest.
 */
export function BrandMark({ size = "md" }: { size?: "md" | "lg" }) {
  const { t } = useI18n();
  const big = size === "lg";

  return (
    <span className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={`flex shrink-0 overflow-hidden rounded-xl bg-white shadow-[0_6px_18px_-6px_var(--motif-mark-shade)] ${
          big ? "size-11" : "size-9"
        }`}
      >
        <PeakGlyph className="size-full" />
      </span>
      <span
        className={`font-display leading-none font-extrabold tracking-tight text-white drop-shadow-[0_1px_8px_var(--motif-name-shade)] ${
          big ? "text-[1.75rem]" : "text-[1.3125rem]"
        }`}
      >
        {t.common.appName}
      </span>
    </span>
  );
}

/** The mark itself, in a 36 × 36 box: the sun in a col, a far summit, a near ridge and its trail. */
export function PeakGlyph({ className = "" }: { className?: string }) {
  const id = useId();
  const sun = `${id}-sun`;
  const near = `${id}-near`;

  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 36 36" className={className}>
      <defs>
        <linearGradient id={sun} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: "var(--motif-dawn-1)" }} />
          <stop offset="0.55" style={{ stopColor: "var(--motif-dawn-2)" }} />
          <stop offset="1" style={{ stopColor: "var(--motif-dawn-3)" }} />
        </linearGradient>
        <linearGradient id={near} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--motif-peak-near-from)" }} />
          <stop offset="1" style={{ stopColor: "var(--motif-peak-near-to)" }} />
        </linearGradient>
      </defs>
      <circle cx="23.5" cy="17.5" r="6.5" fill={`url(#${sun})`} />
      <path
        d="M-1 29 7 20.5l3.5 3L17 13l5.2 8.3 2.3-2.3L37 29v8H-1z"
        style={{ fill: "var(--motif-peak-far)" }}
      />
      <path d="M-1 31.5 6 27l4 2 7.5-6.2 5.5 4.6 4-2.6 9 5.7V37H-1z" fill={`url(#${near})`} />
      <path
        d="M4.5 33.2 10 29.6l3.6 1 4-3.3 4.4 2.7"
        fill="none"
        stroke="#fff"
        strokeWidth="1.3"
        className="route-dots"
        style={{ strokeDasharray: "0.1 2.6" }}
      />
    </svg>
  );
}

/**
 * What is in the sky behind the header: two soft glows (still: a blurred layer
 * that moved for ever would keep a phone at work), the contour lines of a map,
 * and at its foot, just
 * above the sheet of the page, the ridges, with the sun rising behind them
 * unless `sun` is false. The ridges are continued down behind the sheet, so
 * that its round corners show the night of the valley.
 */
export function DawnSky({ sun = true }: { sun?: boolean }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <span className="absolute -top-16 -left-20 size-64 rounded-full bg-iris-400/40 blur-3xl" />
      <span className="absolute -right-10 -bottom-24 size-72 rounded-full bg-peach-300/50 blur-3xl" />
      <Contours tiled className="opacity-[0.15]" />
      {/* On a phone the name is on the left: the low valley is under it, the summits and the sun on the right. */}
      <Ridges
        className="bottom-7 h-28 md:hidden"
        sun={sun ? 1500 : undefined}
        sunSize={24}
        steep={1.15}
      />
      <Ridges
        className="bottom-7 hidden h-[7.5rem] md:block"
        center={1720}
        sun={sun ? 1500 : undefined}
        sunSize={30}
        steep={1.15}
      />
      <span className="absolute inset-x-0 bottom-0 h-7" style={{ backgroundColor: NIGHT }} />
    </span>
  );
}
