import { useI18n } from "../../i18n/I18nProvider";

// The small marks of « Carnet » that its variants draw: a title in two voices,
// the square of a kind of race and the ring of dots of a countdown. They are
// decoration, or the same text drawn in two faces: what they mean is written
// beside them, never the colour alone. The colours are the palette's (indigo is
// `blush`, gold is `peach`, coral is `iris`, teal and the navy are the slope and
// the sky), read from custom properties.

/**
 * A headline in two voices: the bold sans, and its last word in an italic
 * serif (« Trail des *Crêtes* »). A single word stays all sans. The text read
 * out is the same text.
 */
export function Accent({ text }: { text: string }) {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu);
  const last = words?.at(-1);
  if (!words || words.length < 2 || last === undefined) return <>{text}</>;
  const at = text.lastIndexOf(last);
  return (
    <>
      {text.slice(0, at)}
      <span className="font-serif text-[1.14em] font-normal italic">{last}</span>
      {text.slice(at + last.length)}
    </>
  );
}

/** A label in lower case and without accents, to be compared. */
const plain = (label: string) =>
  label.toLocaleLowerCase("fr").normalize("NFD").replaceAll(/\p{M}/gu, "");

/**
 * The colour of a kind of race, for its square: road indigo, trail teal, ultra
 * navy, cross gold, backyard pale indigo, Hyrox amber, a kind the admin added a
 * grey. Its name is always written beside it.
 */
function kindColour(label: string): string {
  const kind = plain(label);
  if (kind.includes("backyard")) return "var(--color-blush-300)";
  if (kind.includes("ultra")) return "var(--dawn-sky-color)";
  if (kind.includes("trail")) return "var(--color-slope-2)";
  if (kind.includes("cross")) return "var(--color-peach-400)";
  if (kind.includes("hyrox")) return "var(--color-peach-500)";
  if (kind.includes("route") || kind.includes("road")) return "var(--color-blush-500)";
  return "var(--color-neutral-300)";
}

/** A small square of the colour of a kind of race, before its name. */
export function KindMark({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-2.5 shrink-0 rounded-[3px]"
      style={{ backgroundColor: kindColour(label) }}
    />
  );
}

/** The days a countdown ring counts down from: a training block of twelve weeks. */
const HORIZON_DAYS = 84;

/** Teal far away, indigo up to a week and a day, gold the last week. */
function countdownColour(days: number): string {
  if (days <= 7) return "var(--color-peach-500)";
  if (days <= 30) return "var(--color-blush-500)";
  return "var(--color-slope-2)";
}

/**
 * The days to a race, as a ring of dots that a line closes as the day comes
 * (full on the day, over twelve weeks), the days in the middle. `light` is for
 * the navy of a hero. The words (« dans 9 jours ») are for screen readers.
 */
export function DotRing({
  days,
  size = 44,
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
  const { f } = useI18n();
  const left = Math.max(0, days);
  const stroke = size >= 56 ? 2.5 : 2;
  const radius = size / 2 - stroke - 1;
  const length = 2 * Math.PI * radius;
  const fill = 1 - Math.min(left, HORIZON_DAYS) / HORIZON_DAYS;

  return (
    <span
      aria-hidden={silent ? "true" : undefined}
      className={`relative inline-flex shrink-0 items-center justify-center ${className}`}
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
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          className={light ? "stroke-white/50" : "stroke-neutral-400"}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray={`0.01 ${size >= 56 ? 4.5 : 3.6}`}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${Math.max(fill * length, 0.01)} ${length}`}
          style={{ stroke: light ? "var(--color-card)" : countdownColour(left) }}
        />
      </svg>
      <span
        aria-hidden="true"
        className={`relative font-semibold tracking-tight ${size >= 56 ? "text-xl" : "text-[0.8125rem]"}`}
      >
        {left}
      </span>
      {!silent && <span className="sr-only">{f.inDays(left)}</span>}
    </span>
  );
}
