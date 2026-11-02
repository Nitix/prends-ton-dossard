import { useId } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { useToday } from "../lib/useToday";
import { skinnable } from "../skins/components";
import type { CountdownRingProps, DateChipProps } from "../skins/types";

/**
 * The pictures of the dawn: the day of an event as a chip of sunrise, and the
 * ring of the days left (the sun and the mountains are in Alpenglow.tsx). Both
 * are decoration: what they show is written in words beside them, or in a text
 * for screen readers.
 */

/**
 * The day of an event as a chip of sunrise: the weekday, the day in big, the
 * month (and the year when it is not this one). An event of several days shows
 * its first and last day. The date is said by `label`, in words, for screen
 * readers: the chip is hidden from them.
 */
export function DateChipBase({ start, end, label, size = "md" }: DateChipProps) {
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
        className={`date-chip relative flex shrink-0 flex-col items-center justify-center self-start overflow-hidden rounded-2xl bg-dawn-deep text-dawn-deep-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.3),0_10px_24px_-10px_var(--dawn-chip-glow)] ${
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

/** The day of an event, as the skin of the page draws it at the depth of the build (Crête's chip above, by default). */
export const DateChip = skinnable("DateChip", DateChipBase);

/** How many days the ring counts down: further than this, it is empty. */
const HORIZON_DAYS = 30;
const RING_RADIUS = 22;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/**
 * The days left before a race or a deadline, as a ring of sunrise that fills
 * as the day comes, with the number in it. It only shows: the days are said in
 * words beside it. `tone` is "color" on white, "light" (white) on the sky of a
 * hero.
 */
export function CountdownRingBase({ days, tone = "color", className = "" }: CountdownRingProps) {
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
    <span
      aria-hidden="true"
      className={`countdown-ring relative inline-flex size-14 shrink-0 ${className}`}
    >
      <svg viewBox="0 0 56 56" className="size-full -rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" style={{ stopColor: "var(--dawn-ring-from)" }} />
            <stop offset="0.5" style={{ stopColor: "var(--dawn-ring-via)" }} />
            <stop offset="1" style={{ stopColor: "var(--dawn-ring-to)" }} />
          </linearGradient>
        </defs>
        <circle
          cx="28"
          cy="28"
          r={RING_RADIUS}
          fill={light ? undefined : "none"}
          // On the sky, the veil of a hero (`--hero-veil`), a little lighter.
          style={
            light ? { fill: "color-mix(in srgb, var(--hero-veil) 90%, transparent)" } : undefined
          }
          // The track: faint white on the sky, the soft violet of the theme on a card.
          stroke={light ? "rgb(255 255 255 / 0.28)" : undefined}
          className={light ? undefined : "stroke-iris-100"}
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

/** The days left, as the skin of the page draws them at the depth of the build (Crête's ring above, by default). */
export const CountdownRing = skinnable("CountdownRing", CountdownRingBase);
