import { PinIcon } from "../../components/icons";
import { FormatParts, type FormatMarks } from "../../features/events/FormatLine";
import { RegisterLink } from "../../features/events/RegisterLink";
import { deadlineText, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import type { EventHeroProps, FormatTitleProps, TrackFiguresProps, Variants } from "../types";

// « Rétro », depth full: the pieces whose markup the variant really changes,
// beyond the ticket of mix.tsx. The top of the page of an event is a poster on
// the paper (a card in an ink outline, the stamp of its day tilted in a corner,
// the date limit as a mustard pill); the title of a format has the printed
// tags of the tickets; the figures of a track are one line in the display
// face; and the ring of the days left draws nothing, the words beside it are
// the mustard tag (`.days-left`, full.css). Each keeps every word of Crête's
// piece, in its order. What these import is only used while they render (see
// ../README.md).

const SEPARATOR = " · ";

/** A measure of a format as a printed tag, like the numbers of a ticket. */
const TAGS: FormatMarks = {
  measure: (measure) => (
    <span className="ml-[0.4em] inline-block rounded-full border-[1.5px] border-neutral-300 bg-card px-[0.55em] py-[0.05em] align-[0.12em] font-sans text-[0.78em] leading-normal font-semibold whitespace-nowrap text-neutral-800">
      {measure}
    </span>
  ),
};

/** The words of the title of a format: its name, then its measures as printed tags. */
function PrintedTitle({ parts }: FormatTitleProps) {
  return (
    <span className="format-title min-w-0">
      <FormatParts parts={parts} marks={TAGS} />
    </span>
  );
}

/** The figures of a track, one line in the display face; the lowest and highest points under it. */
function PrintedFigures({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-display text-xl font-bold tracking-tight">
        {figures.join(SEPARATOR)}
      </p>
      {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
    </>
  );
}

/**
 * The top of the page of an event, a poster on the paper: its name (the title
 * of the page), above it the date in capitals, its place, where the
 * registration stands as a mustard pill (the days left after it in the last
 * week), the notes and the link to register, an orange button. The stamp of its
 * day is tilted in a corner from `sm`, a picture (the date is written in
 * words). The rays of its sun and the three stripes along its foot are the
 * skin's sheet (full.css).
 */
function Poster({ view, heading }: EventHeroProps) {
  const { t, f, formatLocale } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const several = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);

  return (
    <header className="event-hero relative isolate overflow-hidden bg-card text-ink">
      <div className="event-hero-body flex items-start gap-4 p-4 pb-9 sm:p-6 sm:pb-10">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <h1
            {...heading}
            className="event-hero-title font-display text-[2.1rem] leading-[1.02] font-extrabold display-title tracking-tight [overflow-wrap:anywhere] sm:text-5xl"
          >
            {event.name}
          </h1>
          {/* Above the name, as on a poster; read after it. */}
          <p className="event-hero-date order-first text-xs font-bold tracking-[0.08em] text-blush-700 uppercase">
            {several ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
          </p>
          <p className="event-hero-place flex items-center gap-1.5 text-lg font-semibold text-neutral-800">
            <PinIcon className="size-[1.125rem] shrink-0 text-blush-600" />
            {event.location}
          </p>
          {deadline && (
            <p
              data-kind={deadline.kind}
              className={`event-hero-deadline mt-1 self-start rounded-lg border-2 border-ink px-2.5 py-1 text-sm font-semibold text-ink ${
                deadline.kind === "open" ? "bg-peach-400" : "bg-neutral-100"
              }`}
            >
              {deadlineText(deadline, f, t)}
            </p>
          )}
          {event.notes && (
            <p className="event-hero-notes mt-2 whitespace-pre-line">{event.notes}</p>
          )}
          {registration && <RegisterLink href={registration} className="mt-3" />}
        </div>
        <span
          aria-hidden="true"
          className="date-chip hidden w-24 shrink-0 -rotate-3 flex-col items-center justify-center py-3 leading-none uppercase sm:flex"
        >
          <span className="date-chip-top text-sm font-bold tracking-wider">
            {f.weekday(start, "short").replace(".", "")}
          </span>
          <span className="date-chip-day my-0.5 font-display text-5xl font-extrabold tracking-tight">
            {start.day}
          </span>
          <span className="date-chip-bottom text-sm font-bold tracking-wider">
            {start.toLocaleString(formatLocale, { month: "short" }).replace(".", "")}
          </span>
        </span>
      </div>
    </header>
  );
}

/**
 * The days left draw nothing: the words beside the ring (the tag of `.days-left`)
 * say them. An empty element stands where the ring was, hidden (the shared test
 * of the pieces draws each variant and waits for something in its box).
 */
function NoRing() {
  return <span aria-hidden="true" className="countdown-ring hidden" />;
}

export const variants: Variants = {
  EventHero: Poster,
  FormatTitle: PrintedTitle,
  TrackFigures: PrintedFigures,
  CountdownRing: NoRing,
};
