import { FormatParts, type FormatMarks } from "../../features/events/FormatLine";
import { useI18n } from "../../i18n/I18nProvider";
import type { CountdownRingProps, FormatTitleProps, TrackFiguresProps, Variants } from "../types";

// « Marathon », depth full: the pieces whose markup the variant really changes,
// beyond those of mix.tsx. The title of a format is a kilometre marker (its
// measures are tags), the figures of a track are split times, and the days left
// are one big figure of the blue line, as on the board of a race. Each keeps
// every word of Crête's piece, in its order (the separators of the measures stay
// in the text, hidden from the eye), and a picture says nothing to a screen
// reader. What these import is only used while they render (see ../README.md).

const SEPARATOR = " · ";

/** The name of a format, and each of its measures as the tag of a kilometre marker. */
const MARKER: FormatMarks = {
  name: (name) => <span className="format-name mr-1">{name}</span>,
  measure: (measure) => (
    <span className="format-measures inline-flex min-h-6 items-center rounded-xs border-[1.5px] border-ink px-1.5 font-display text-xs font-extrabold tracking-[0.06em] uppercase">
      {measure}
    </span>
  ),
};

/**
 * The words of the title of a format on the page of an event: its name, then
 * each measure as the tag of a kilometre marker, « 15 KM », « 700 M D+ ». The
 * separators stay in the text, for a screen reader and a copy, and only the
 * tags show them.
 */
function MarkerTitle({ parts }: FormatTitleProps) {
  return (
    <span className="format-title flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-2">
      <FormatParts parts={parts} marks={MARKER} />
    </span>
  );
}

/**
 * The figures of a track over its map, set like split times: one line of heavy
 * tabular figures (« 12,6 km · 724 m D+ · 728 m D− »), the lowest and highest
 * points under it. The separators are in the text, where the tiles of Crête
 * hide them.
 */
function SplitTimes({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-display text-[1.375rem] leading-tight font-extrabold tracking-[-0.01em] text-ink tabular-nums">
        {figures.join(SEPARATOR)}
      </p>
      {altitude !== null && (
        <p className="route-altitude -mt-2 text-sm text-neutral-600">{altitude}</p>
      )}
    </>
  );
}

/**
 * The days left, as the board of a race has them: the number in heavy cobalt
 * figures (white on the sky of a hero) and its unit small beside it (« 9 j », as
 * the ring of Crête says it: a bare figure would not say what it counts). A
 * picture, hidden from a screen reader: the words beside it (`.days-left`) say
 * the days.
 */
function Figure({ days, tone = "color", className = "" }: CountdownRingProps) {
  const { formatLocale } = useI18n();
  const parts = new Intl.NumberFormat(formatLocale, {
    style: "unit",
    unit: "day",
    unitDisplay: "narrow",
  }).formatToParts(Math.max(0, days));
  const number = parts
    .filter((part) => part.type === "integer" || part.type === "group")
    .map((part) => part.value)
    .join("");
  const unit = parts.find((part) => part.type === "unit")?.value ?? "";

  return (
    <span
      aria-hidden="true"
      className={`countdown-ring inline-flex shrink-0 items-baseline gap-0.5 font-display text-[2.25rem] leading-[0.82] ${
        tone === "light" ? "text-white" : "text-iris-600"
      } ${className}`}
    >
      <span className="countdown-figure font-black tracking-[-0.06em] tabular-nums">{number}</span>
      <span className="countdown-unit text-sm leading-none font-extrabold tracking-[0.02em]">
        {unit}
      </span>
    </span>
  );
}

export const variants: Variants = {
  FormatTitle: MarkerTitle,
  TrackFigures: SplitTimes,
  CountdownRing: Figure,
};
