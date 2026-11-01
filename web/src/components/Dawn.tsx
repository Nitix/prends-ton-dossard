import { useId } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { useToday } from "../lib/useToday";

/**
 * The pictures of « Aurore »: the sun that rises on the horizon, the day of an
 * event as a chip of sunrise, and the ring of the days left. All of them are
 * decoration: what they show is written in words beside them, or in a text for
 * screen readers.
 */

/**
 * The sun rising on the horizon, with its arcs of light and the dotted line of
 * a route that runs along the horizon. `tone` is "light" on the sky (white
 * strokes), "color" on white (strokes of sunrise).
 */
export function SunArc({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "color";
  className?: string;
}) {
  const id = useId();
  const sun = `${id}-sun`;
  const stroke = `${id}-stroke`;
  const light = tone === "light";
  const line = light ? "#ffffff" : `url(#${stroke})`;

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 240 120"
      fill="none"
      preserveAspectRatio="xMidYMax meet"
      className={className}
    >
      <defs>
        <radialGradient id={sun} cx="0.5" cy="1" r="1">
          <stop offset="0" stopColor={light ? "#fff7f0" : "#ffb38a"} />
          <stop offset="0.55" stopColor={light ? "#ffd2b8" : "#ff7eb3"} />
          <stop offset="1" stopColor={light ? "#ff9fc4" : "#8b7cff"} />
        </radialGradient>
        <linearGradient id={stroke} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#ffb38a" />
          <stop offset="0.55" stopColor="#ff7eb3" />
          <stop offset="1" stopColor="#8b7cff" />
        </linearGradient>
      </defs>
      {/* The arcs of light around the sun. */}
      <g stroke={line} strokeWidth="1.5" strokeLinecap="round">
        <path d="M86 108a54 54 0 0 1 108 0" opacity={light ? 0.45 : 0.55} />
        <path d="M68 108a72 72 0 0 1 144 0" opacity={light ? 0.28 : 0.35} />
        <path d="M50 108a90 90 0 0 1 180 0" opacity={light ? 0.16 : 0.2} />
      </g>
      {/* The sun, half risen. */}
      <path d="M106 108a34 34 0 0 1 68 0z" fill={`url(#${sun})`} opacity={light ? 0.95 : 1} />
      {/* The horizon, and a route that runs along it. */}
      <path d="M0 108h240" stroke={line} strokeWidth="1.5" opacity={light ? 0.5 : 0.6} />
      <path
        d="M4 118c28-6 46 2 70-2s38-8 62-4 50 6 70 2 22-4 30-4"
        stroke={line}
        strokeWidth="2.5"
        className="route-dots"
        opacity={light ? 0.75 : 0.8}
      />
    </svg>
  );
}

/**
 * The day of an event as a chip of sunrise: the weekday, the day in big, the
 * month (and the year when it is not this one). An event of several days shows
 * its first and last day. The date is said by `label`, in words, for screen
 * readers: the chip is hidden from them.
 */
export function DateChip({
  start,
  end,
  label,
  size = "md",
}: {
  start: Temporal.PlainDate;
  end?: Temporal.PlainDate;
  /** The date in words, read instead of the chip. */
  label: string;
  size?: "md" | "lg";
}) {
  const { f, formatLocale } = useI18n();
  const several = end !== undefined && !start.equals(end);
  const month = (d: Temporal.PlainDate) =>
    d.toLocaleString(formatLocale, { month: "short" }).replace(".", "");
  // Over two months, the months are above and under the days: « NOV 29–2 DÉC ».
  const twoMonths = several && end.month !== start.month;
  const thisYear = useToday().year;
  const big = size === "lg";

  return (
    <>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={`relative flex shrink-0 flex-col items-center justify-center self-start overflow-hidden rounded-2xl bg-dawn-deep text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_10px_24px_-10px_rgb(214_51_111/0.6)] ${
          big ? "w-[4.75rem] py-2.5" : "w-[3.75rem] py-2"
        }`}
      >
        <span className="relative font-display text-[0.625rem] leading-none font-bold tracking-[0.08em] uppercase">
          {twoMonths ? month(start) : f.weekday(start, "short").replace(".", "")}
        </span>
        <span
          className={`relative font-display leading-[1.05] font-extrabold tracking-tight tabular-nums ${
            big ? "text-[2rem]" : several ? "text-[1.125rem]" : "text-[1.625rem]"
          }`}
        >
          {several ? `${start.day}–${end.day}` : start.day}
        </span>
        <span className="relative font-display text-[0.625rem] leading-none font-bold tracking-[0.08em] uppercase">
          {month(several ? end : start)}
        </span>
        {start.year !== thisYear && (
          <span className="relative font-display text-[0.5625rem] leading-none font-semibold tracking-[0.1em] opacity-90">
            {start.year}
          </span>
        )}
      </span>
    </>
  );
}

/** How many days the ring counts down: further than this, it is empty. */
const HORIZON_DAYS = 30;
const RING_RADIUS = 22;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The days left before a race or a deadline, as a ring of sunrise that fills
 * as the day comes, with the number in it. It only shows: the days are said in
 * words beside it.
 */
export function CountdownRing({
  days,
  tone = "color",
  className = "",
}: {
  days: number;
  /** "color" on white, "light" (white) on the sky of a hero. */
  tone?: "color" | "light";
  className?: string;
}) {
  const light = tone === "light";
  const { formatLocale } = useI18n();
  const id = useId();
  const left = Math.max(0, days);
  // A dot of colour at least, even far away.
  const filled = Math.max(0.04, 1 - Math.min(left, HORIZON_DAYS) / HORIZON_DAYS);
  const parts = new Intl.NumberFormat(formatLocale, {
    style: "unit",
    unit: "day",
    unitDisplay: "narrow",
  }).formatToParts(left);
  const number = parts
    .filter((p) => p.type === "integer" || p.type === "group")
    .map((p) => p.value)
    .join("");
  const unit = parts.find((p) => p.type === "unit")?.value ?? "";

  return (
    <span aria-hidden="true" className={`relative inline-flex size-14 shrink-0 ${className}`}>
      <svg viewBox="0 0 56 56" className="size-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8b7cff" />
            <stop offset="0.5" stopColor="#ff7eb3" />
            <stop offset="1" stopColor="#ffb38a" />
          </linearGradient>
        </defs>
        <circle
          cx="28"
          cy="28"
          r={RING_RADIUS}
          fill={light ? "rgb(36 27 53 / 0.18)" : "none"}
          stroke={light ? "rgb(255 255 255 / 0.28)" : "#ece8ff"}
          strokeWidth="5"
        />
        <circle
          cx="28"
          cy="28"
          r={RING_RADIUS}
          fill="none"
          stroke={light ? "#ffffff" : `url(#${id})`}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={`${(filled * RING_LENGTH).toFixed(1)} ${RING_LENGTH.toFixed(1)}`}
          className="ring-draw"
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-baseline justify-center pt-[1.05rem] font-display ${
          light ? "text-white" : "text-ink"
        }`}
      >
        <span className="text-[1.0625rem] leading-none font-extrabold tabular-nums">{number}</span>
        <span
          className={`ml-px text-[0.6875rem] leading-none font-bold ${
            light ? "text-white/90" : "text-neutral-600"
          }`}
        >
          {unit}
        </span>
      </span>
    </span>
  );
}
