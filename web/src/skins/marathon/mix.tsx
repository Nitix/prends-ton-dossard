import { Link } from "@tanstack/react-router";

import { CountdownRing, DateChip } from "../../components/Dawn";
import { Divider } from "../../components/Slots";
import { FormatLine, type FormatMarks } from "../../features/events/FormatLine";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { RegisterLink } from "../../features/events/RegisterLink";
import {
  deadlineText,
  registrationLabel,
  registrationState,
} from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import type { DateChipProps, EventCardProps, EventHeroProps, Variants } from "../types";

// « Marathon », depth mix: the poster and the programme of a big-city race.
// The day of an event is the number of a bib, the card of an event is a ruled
// programme (a black rule on top, then a thin one between its parts, the
// measures of a format as the tags of a kilometre marker), and the top of its
// page is the poster, as the variant has it: ink on the paper, the day in heavy
// figures, the name, the blue line under it, what to know between two thin
// rules. Each keeps what Crête's piece shows, and the words are the same: only
// the markup differs (the figures are pictures, the date is said in words for
// a screen reader). What these import is only used while they render (see
// ../README.md).

/**
 * The day of an event as the number of a bib: the day of the month in heavy
 * figures, under it the weekday and the month in small capitals (the two
 * months for days over two months, and the year when it is not this one). A picture,
 * hidden from screen readers, which read `label`.
 */
function BibDay({ start, end, label, size = "md" }: DateChipProps) {
  const { f, formatLocale } = useI18n();
  const thisYear = useToday().year;
  const several = end !== undefined && !start.equals(end);
  const month = (day: Temporal.PlainDate) =>
    day.toLocaleString(formatLocale, { month: "short" }).replace(".", "");
  const big = size === "lg";
  const caption =
    several && end.month !== start.month
      ? `${month(start)}–${month(end)}`
      : `${f.weekday(start, "short").replace(".", "")} ${month(start)}`;

  return (
    <>
      <span className="sr-only">{label}</span>
      <span
        aria-hidden="true"
        className={`date-chip flex shrink-0 flex-col items-start gap-1.5 self-start text-ink ${
          big ? "w-24" : "w-16"
        }`}
      >
        <span
          className={`date-chip-day font-display leading-[0.82] font-black tracking-[-0.06em] whitespace-nowrap tabular-nums ${
            big ? "text-[5rem]" : several ? "text-[1.625rem]" : "text-[3.5rem]"
          }`}
        >
          {several ? `${start.day}–${end.day}` : start.day}
        </span>
        <span className="date-chip-bottom font-display text-[0.625rem] leading-[1.15] font-extrabold tracking-[0.07em] text-iris-700 uppercase">
          {caption}
          {start.year !== thisYear && ` ${start.year}`}
        </span>
      </span>
    </>
  );
}

/**
 * How a format of a card is marked: its name, then each of its measures as a
 * tag, like the kilometre markers of a course (« 15 KM », « 700 M D+ »,
 * « 30 € »). `FormatLine` keeps the separators in the text, for a screen reader
 * and a copy, and the tags are all that shows of them.
 */
const TAGS: FormatMarks = {
  name: (name) => <span className="format-name mr-1">{name}</span>,
  measure: (measure) => (
    <span className="inline-flex min-h-5 items-center rounded-xs border border-ink px-1 font-display text-[0.625rem] font-extrabold tracking-[0.06em] uppercase">
      {measure}
    </span>
  ),
};

/** The line of a format of a card: its name and its tags, in the lines of a programme. */
const FORMAT_LINE = "flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-semibold text-ink";

/** A part of the card under its head: the interested, a format, the supporters. */
const PART = "flex flex-col gap-2 border-t border-neutral-200 px-4 py-3";

/**
 * An event in a list, as a line of a programme: the number of its day, its name
 * (the link to its page, a bar tall enough to tap), its place and where its
 * registration stands, then thin rules between what is left to choose, each
 * format with its runners, and the supporters.
 */
function ProgrammeCard({ view }: EventCardProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, today);

  return (
    <article className="event-card card card-lift flex h-full flex-col">
      <div className="event-card-head flex gap-3 px-4 pt-3 pb-3">
        <DateChip
          start={start}
          end={end}
          label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="event-card-title font-display text-[1.3125rem] leading-[1.15] font-extrabold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center decoration-iris-600 decoration-[3px] underline-offset-[5px] hover:text-ink hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="event-card-place text-sm font-medium text-neutral-700">{event.location}</p>
          {registration && (
            <p
              data-kind={registration.kind}
              className="event-card-deadline mt-0.5 text-sm font-semibold text-neutral-700"
            >
              {registrationLabel(registration, f, t)}
            </p>
          )}
        </div>
      </div>
      {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
      {interested.length > 0 && (
        <div data-kind="interested" className={`event-card-people ${PART}`}>
          <p className="text-sm font-semibold">{t.event.formatToChoose}</p>
          <ParticipantChips participations={interested} label={t.event.interestedTitle} />
        </div>
      )}
      {formats.length > 0 && (
        <ul className="event-card-formats flex flex-col">
          {formats.map((formatView) => (
            <li key={formatView.format.id} className={`event-card-format ${PART}`}>
              <FormatLine
                formatView={formatView}
                showDate={severalDays}
                marks={TAGS}
                className={FORMAT_LINE}
              />
              <ParticipantChips participations={starters(formatView.participations)} />
            </li>
          ))}
        </ul>
      )}
      {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
      {view.supporters.length > 0 && (
        <div data-kind="supporters" className={`event-card-people ${PART}`}>
          <p className="text-sm font-semibold">{t.event.supportersTitle}</p>
          <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
        </div>
      )}
    </article>
  );
}

/** A fact of the poster, between its rules: stacked on a phone, in columns from `md`. */
const FACT =
  "py-2.5 text-[0.9375rem] not-first:border-t not-first:border-neutral-300 md:px-4 md:not-first:border-t-0 md:not-first:border-l md:first:pl-0";

/**
 * The top of the page of an event, as the poster of a race, in ink on the paper
 * as the variant has it: the day in heavy figures (a picture), the name in
 * heavy type with the days left, the blue line under it, then the date, the
 * place and where the registration stands between two thin rules, the notes
 * and the link to register, the blue rectangle of the main button. Its words
 * are in the ink of the page (4.5:1 and more), none on the sky.
 */
function PosterHero({ view, heading }: EventHeroProps) {
  const { t, f, formatLocale } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const several = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);
  const month = (day: Temporal.PlainDate) =>
    day.toLocaleString(formatLocale, { month: "short" }).replaceAll(".", "");
  const longMonth = start.toLocaleString(formatLocale, { month: "long" });
  // Over two months, both: « juin – juil ».
  const months = end.month === start.month ? month(start) : `${month(start)} – ${month(end)}`;

  return (
    <header className="event-hero relative flex flex-col">
      <div aria-hidden="true" className="flex items-end gap-3 md:gap-4">
        <span
          className={`font-display leading-[0.82] font-black tracking-[-0.06em] whitespace-nowrap text-ink tabular-nums ${
            several ? "text-[5rem] md:text-[8rem]" : "text-[7.5rem] md:text-[10rem]"
          }`}
        >
          {several ? `${start.day}–${end.day}` : start.day}
        </span>
        <span className="flex flex-col gap-1.5 pb-2 font-display text-xs leading-none font-extrabold tracking-[0.07em] uppercase md:pb-3">
          {!several && <span className="text-iris-700">{f.weekday(start, "long")}</span>}
          <span className="text-ink">{several ? months : longMonth}</span>
          <span className="text-neutral-600">{start.year}</span>
        </span>
      </div>
      <div className="mt-3 flex items-start justify-between gap-4">
        <h1
          {...heading}
          className="event-hero-title min-w-0 font-display text-[clamp(2.25rem,11vw,4.5rem)] leading-[0.95] font-black display-title tracking-[-0.045em] text-balance break-words text-ink"
        >
          {event.name}
        </h1>
        {daysToGo > 0 && <CountdownRing days={daysToGo} className="mt-1" />}
      </div>
      {/* The line goes on to the edge of the page: its box reaches the edge of the sheet. */}
      <div className="my-3 -mr-4 md:-mr-5">
        <Divider />
      </div>
      <div className="event-hero-facts grid border-y-2 border-ink md:grid-cols-3">
        <p className={FACT}>
          {several ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </p>
        <p className={FACT}>{event.location}</p>
        {deadline && (
          <p
            data-kind={deadline.kind}
            className={`event-hero-deadline ${FACT} font-medium text-neutral-700`}
          >
            {deadlineText(deadline, f, t)}
          </p>
        )}
      </div>
      {event.notes && (
        <p className="event-hero-notes mt-4 max-w-prose whitespace-pre-line">{event.notes}</p>
      )}
      {registration && <RegisterLink href={registration} className="mt-4" />}
    </header>
  );
}

export const variants: Variants = {
  DateChip: BibDay,
  EventCard: ProgrammeCard,
  EventHero: PosterHero,
};
