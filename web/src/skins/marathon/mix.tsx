import { Link } from "@tanstack/react-router";

import { CountdownRing, DateChip } from "../../components/Dawn";
import { HeroArt } from "../../components/Slots";
import type { FormatView } from "../../features/events/api";
import { formatMeasures } from "../../features/events/formatName";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { RegisterLink } from "../../features/events/RegisterLink";
import {
  DAYS_LEFT_SHOWN,
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
// page is the poster: the day in heavy figures on the ink of the sky, the blue
// line along its foot, what to know between two thin rules. Each keeps what
// Crête's piece shows, and the words are the same: only the markup differs
// (the figures are pictures, the date is said in words for a screen reader).
// What these import is only used while they render (see ../README.md).

const SEPARATOR = " · ";

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
          className={`font-display leading-[0.82] font-black tracking-[-0.06em] whitespace-nowrap tabular-nums ${
            big ? "text-[5rem]" : several ? "text-[1.625rem]" : "text-[3.5rem]"
          }`}
        >
          {several ? `${start.day}–${end.day}` : start.day}
        </span>
        <span className="font-display text-[0.625rem] leading-[1.15] font-extrabold tracking-[0.07em] text-iris-700 uppercase">
          {caption}
          {start.year !== thisYear && ` ${start.year}`}
        </span>
      </span>
    </>
  );
}

/**
 * A format of a card: its name, then each of its measures as a tag, like the
 * kilometre markers of a course (« 15 KM », « 700 M D+ », « 30 € »). The
 * separators stay in the text, for a screen reader and a copy, and only the
 * tags show them.
 */
function MeasureTags({ formatView, showDate }: { formatView: FormatView; showDate: boolean }) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;
  const [head, ...rest] = formatMeasures(format, raceType.label, f, t);

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="eyebrow">{f.date(date)}</p>}
      <p className="flex flex-wrap items-center gap-x-1 gap-y-1 text-sm font-semibold text-ink">
        <span className="mr-1">{head}</span>
        {rest.map((part, at) => (
          // The parts of a line may repeat: the place is part of the key.
          // oxlint-disable-next-line react/no-array-index-key
          <span key={`${at}:${part}`} className="inline-flex">
            <span className="sr-only">{SEPARATOR}</span>
            <span className="inline-flex min-h-5 items-center rounded-xs border border-ink px-1 font-display text-[0.625rem] font-extrabold tracking-[0.06em] uppercase">
              {part}
            </span>
          </span>
        ))}
      </p>
    </>
  );
}

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
      <div className="flex gap-3 px-4 pt-3 pb-3">
        <DateChip
          start={start}
          end={end}
          label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-[1.3125rem] leading-[1.15] font-extrabold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center decoration-iris-600 decoration-[3px] underline-offset-[5px] hover:text-ink hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="text-sm font-medium text-neutral-700">{event.location}</p>
          {registration && (
            <p className="mt-0.5 text-sm font-semibold text-neutral-700">
              {registrationLabel(registration, f, t)}
            </p>
          )}
        </div>
      </div>
      {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
      {interested.length > 0 && (
        <div className={PART}>
          <p className="text-sm font-semibold">{t.event.formatToChoose}</p>
          <ParticipantChips participations={interested} label={t.event.interestedTitle} />
        </div>
      )}
      {formats.length > 0 && (
        <ul className="flex flex-col">
          {formats.map((formatView) => (
            <li key={formatView.format.id} className={PART}>
              <MeasureTags formatView={formatView} showDate={severalDays} />
              <ParticipantChips participations={starters(formatView.participations)} />
            </li>
          ))}
        </ul>
      )}
      {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
      {view.supporters.length > 0 && (
        <div className={PART}>
          <p className="text-sm font-semibold">{t.event.supportersTitle}</p>
          <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
        </div>
      )}
    </article>
  );
}

/** A fact of the poster, between its rules: stacked on a phone, in columns from `md`. */
const FACT =
  "border-white/30 py-2.5 text-[0.9375rem] font-medium not-first:border-t md:px-4 md:not-first:border-t-0 md:not-first:border-l md:first:pl-0";

/**
 * The top of the page of an event, as the poster of a race on the ink of the
 * sky: the day in heavy figures (a picture), the name in heavy type with the
 * days left, then the date, the place and where the registration stands between
 * two thin rules, the notes and the link to register; the blue line runs along
 * its foot (the skin's `HeroArt`).
 */
function PosterHero({ view, heading }: EventHeroProps) {
  const { t, f, formatLocale } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const several = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);
  const longMonth = start.toLocaleString(formatLocale, { month: "long" });

  return (
    <header className="event-hero on-dawn relative overflow-hidden bg-dawn-hero text-white">
      <HeroArt place="event" />
      <div className="relative flex flex-col gap-3 p-5 pb-[5.25rem] md:p-7 md:pb-24">
        <div aria-hidden="true" className="flex items-end gap-3 md:gap-4">
          <span
            className={`font-display leading-[0.82] font-black tracking-[-0.06em] whitespace-nowrap tabular-nums ${
              several ? "text-[3.5rem] md:text-[5rem]" : "text-[5.5rem] md:text-[8rem]"
            }`}
          >
            {several ? `${start.day}–${end.day}` : start.day}
          </span>
          <span className="flex flex-col gap-1 pb-1 font-display text-[0.6875rem] leading-none font-extrabold tracking-[0.07em] uppercase md:pb-2 md:text-[0.8125rem]">
            {!several && <span className="text-iris-300">{f.weekday(start, "long")}</span>}
            <span>{several ? f.weekday(start, "short").replace(".", "") : longMonth}</span>
            <span className="opacity-80">{start.year}</span>
          </span>
        </div>
        <div className="flex items-start justify-between gap-4">
          <h1
            {...heading}
            className="min-w-0 font-display text-[1.875rem] leading-[1.05] font-black display-title break-words md:text-[2.75rem]"
          >
            {event.name}
          </h1>
          {daysToGo > 0 && <CountdownRing days={daysToGo} tone="light" className="mt-1" />}
        </div>
        <div className="grid border-y-2 border-white/60 md:grid-cols-3">
          <p className={FACT}>
            {several ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
          </p>
          <p className={FACT}>{event.location}</p>
          {deadline && (
            <p className={FACT}>
              {registrationLabel(deadline, f, t)}
              {deadline.kind === "open" &&
                deadline.daysLeft <= DAYS_LEFT_SHOWN &&
                `${SEPARATOR}${t.event.daysLeft(deadline.daysLeft)}`}
            </p>
          )}
        </div>
        {event.notes && <p className="max-w-prose whitespace-pre-line">{event.notes}</p>}
        {registration && <RegisterLink href={registration} tone="onDawn" className="mt-1" />}
      </div>
    </header>
  );
}

export const variants: Variants = {
  DateChip: BibDay,
  EventCard: ProgrammeCard,
  EventHero: PosterHero,
};
