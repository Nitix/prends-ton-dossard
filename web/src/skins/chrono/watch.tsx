import { useI18n } from "../../i18n/I18nProvider";

// What « Chrono » draws with its five zones, the heart-rate zones of a watch:
// a mark of a zone (a bar before a word), and the ring of a countdown. The
// zones are the five steps of the slope (`--color-slope-1…5`, palette.css): the
// colours stay in the palette. A mark is decoration: the words beside it say
// what it means, never the colour alone.

export type Zone = 1 | 2 | 3 | 4 | 5;

/** The colour of a mark of a zone; grey for a mark with no zone. */
const zoneColour = (zone: Zone | null) =>
  zone === null ? "var(--color-neutral-300)" : `var(--color-slope-${zone})`;

/** The days a countdown ring counts down from: a training block of twelve weeks. */
const HORIZON_DAYS = 84;

/** How soon a day is, as a zone: far away is the first zone, a week or less the fifth. */
export function countdownZone(days: number): Zone {
  if (days <= 7) return 5;
  if (days <= 14) return 4;
  if (days <= 30) return 3;
  if (days <= 60) return 2;
  return 1;
}

/** How full a countdown ring is: it closes as the day comes, and is full on the day. */
function countdownFill(days: number): number {
  const left = Math.min(Math.max(days, 0), HORIZON_DAYS);
  return 1 - left / HORIZON_DAYS;
}

/** A label in lower case and without accents, to be compared. */
const plain = (label: string) =>
  label.toLocaleLowerCase("fr").normalize("NFD").replaceAll(/\p{M}/gu, "");

/**
 * The zone a kind of race is run in, as a runner's heart knows it: a backyard in
 * the first, an ultra in the second, a trail in the third, a road race or a
 * Hyrox in the fourth, a cross in the fifth. A kind the admin added that is none
 * of these has no zone (a grey mark): its name is always written.
 */
export function raceTypeZone(label: string): Zone | null {
  const kind = plain(label);
  if (kind.includes("backyard")) return 1;
  if (kind.includes("ultra")) return 2;
  if (kind.includes("trail")) return 3;
  if (kind.includes("cross")) return 5;
  if (kind.includes("hyrox") || kind.includes("route") || kind.includes("road")) return 4;
  return null;
}

/** The small bar of a zone, before the words it goes with: a kind of race, a deadline. */
export function ZoneBar({
  zone,
  className = "h-3.5 w-1",
}: {
  zone: Zone | null;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={`inline-block shrink-0 rounded-full ${className}`}
      style={{ backgroundColor: zoneColour(zone) }}
    />
  );
}

/**
 * The days to a race on a ring of its zone, as the ring of a watch: the ring
 * closes as the day comes, and the days are in the middle. `light` is for the
 * ink of a hero. The words (« dans 9 jours ») are for screen readers.
 */
export function WatchRing({
  days,
  size = 48,
  light = false,
  silent = false,
  className = "",
}: {
  days: number;
  size?: number;
  light?: boolean;
  /** A picture that says nothing: the words beside it say the days (a screen reader has none of the ring). */
  silent?: boolean;
  className?: string;
}) {
  const { f, formatLocale } = useI18n();
  const left = Math.max(0, days);
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const centre = size / 2;
  const written = new Intl.NumberFormat(formatLocale, {
    style: "unit",
    unit: "day",
    unitDisplay: "narrow",
  }).format(left);

  return (
    <span
      aria-hidden={silent ? "true" : undefined}
      className={`relative inline-grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size }}
    >
      <svg
        aria-hidden="true"
        focusable="false"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
      >
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          className={light ? "stroke-white/20" : "stroke-neutral-100"}
        />
        <circle
          cx={centre}
          cy={centre}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          pathLength={100}
          strokeDasharray={`${(countdownFill(left) * 100).toFixed(1)} 100`}
          style={{ stroke: zoneColour(countdownZone(left)) }}
        />
      </svg>
      <span
        aria-hidden="true"
        className={`relative font-mono leading-none font-semibold tracking-tight ${
          left >= 100 ? "text-[0.6875rem]" : "text-[0.8125rem]"
        }`}
      >
        {written}
      </span>
      {!silent && <span className="sr-only">{f.inDays(left)}</span>}
    </span>
  );
}
