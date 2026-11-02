import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DateChip } from "../../components/Dawn";
import { CalendarIcon, ClockIcon, PinIcon } from "../../components/icons";
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
import type { EventCardProps, EventHeroProps, Variants } from "../types";
import { Accent, DotRing, KindMark } from "./marks";

// « Carnet », depth mix: a logbook drawn like a technical sheet. The card of an
// event is a white sheet with its name in two voices (the bold sans, its last
// word in an italic serif), the ring of dots of the days left in its corner,
// and its formats on hairlines, each with the square of its kind of race; the
// top of the page of an event is a navy sheet with the same two voices and the
// same ring, and its facts on hairlines. Each keeps what Crête's piece shows,
// with the same words. The day of an event is Crête's own `DateChip`, dressed
// by mix.css. What these import is only used while they render (see
// ../README.md).

const SEPARATOR = " · ";

/** A line of the card, on its hairline: what it is, and its runners at the end. */
function Line({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 last:pb-0">
      {children}
    </li>
  );
}

/** A format of the card: the square of its kind, its first measure in ink, the others quieter. */
function MarkedFormat({ formatView, showDate }: { formatView: FormatView; showDate: boolean }) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;
  const [first, ...rest] = formatMeasures(format, raceType.label, f, t);

  return (
    <div className="flex min-w-0 flex-col">
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="eyebrow">{f.date(date)}</p>}
      <p className="flex items-baseline gap-2 text-sm">
        <KindMark label={raceType.label} />
        <span>
          <span className="font-medium text-ink">{first}</span>
          {rest.length > 0 && (
            <span className="text-neutral-600">{`${SEPARATOR}${rest.join(SEPARATOR)}`}</span>
          )}
        </span>
      </p>
    </div>
  );
}

/**
 * An event in a list, a sheet of the logbook: its day, its name (the link to
 * its page, a bar tall enough to tap), its place and where its registration
 * stands, the ring of dots of the days left in its corner; under a hairline,
 * who is interested with no format chosen yet, each format with its runners,
 * and the supporters.
 */
function Sheet({ view }: EventCardProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, today);
  // Under way, it is on today; over, it has no ring.
  const daysToGo =
    Temporal.PlainDate.compare(end, today) < 0 ? null : Math.max(0, daysBetween(today, start));
  const hasPeople = interested.length > 0 || formats.length > 0 || view.supporters.length > 0;

  return (
    <article className="event-card card card-lift flex flex-col p-4 md:px-5">
      <div className="flex items-start gap-3">
        <DateChip
          start={start}
          end={end}
          label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-[1.1875rem] leading-snug font-semibold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center underline-offset-[3px] hover:underline"
            >
              <span>
                <Accent text={event.name} />
              </span>
            </Link>
          </h3>
          <p className="flex items-center gap-1.5 text-sm text-neutral-600">
            <PinIcon className="size-3.5 shrink-0 text-neutral-500" />
            {event.location}
          </p>
          {registration && (
            <p className="mt-2 self-start">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium text-neutral-700 ${
                  registration.kind === "open"
                    ? "border-neutral-300 bg-card"
                    : "border-dashed border-neutral-600 bg-neutral-50"
                }`}
              >
                <ClockIcon className="size-3.5 shrink-0 text-neutral-500" />
                {registrationLabel(registration, f, t)}
              </span>
            </p>
          )}
        </div>
        {daysToGo !== null && <DotRing days={daysToGo} />}
      </div>
      {hasPeople && (
        <ul className="mt-3.5 divide-y divide-neutral-200 border-t border-neutral-200">
          {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
          {interested.length > 0 && (
            <Line>
              <p className="text-sm text-neutral-700">{t.event.formatToChoose}</p>
              <ParticipantChips participations={interested} label={t.event.interestedTitle} />
            </Line>
          )}
          {formats.map((formatView) => (
            <Line key={formatView.format.id}>
              <MarkedFormat formatView={formatView} showDate={severalDays} />
              <ParticipantChips participations={starters(formatView.participations)} />
            </Line>
          ))}
          {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
          {view.supporters.length > 0 && (
            <Line>
              <p className="text-sm text-neutral-700">{t.event.supportersTitle}</p>
              <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
            </Line>
          )}
        </ul>
      )}
    </article>
  );
}

/**
 * The top of the page of an event, a navy sheet of the logbook: the name in two
 * voices (the title of the page) with the ring of dots of the days left, then
 * the date, the place and where the registration stands on hairlines, the notes
 * and the link to register. The dots of the sheet are the skin's `HeroArt`.
 */
function SheetHero({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);

  return (
    <header className="event-hero on-dawn relative overflow-hidden bg-dawn-hero text-white">
      <HeroArt place="event" />
      <div className="relative flex flex-col gap-3 p-5 pb-8 md:p-7 md:pb-10">
        <div className="flex items-start justify-between gap-4">
          <h1
            {...heading}
            className="min-w-0 font-display text-[1.875rem] leading-[1.1] font-semibold display-title break-words md:text-[2.375rem]"
          >
            <Accent text={event.name} />
          </h1>
          {daysToGo > 0 && (
            <span className="mt-1">
              <DotRing days={daysToGo} size={56} light />
            </span>
          )}
        </div>
        <div className="flex flex-col divide-y divide-white/20 border-y border-white/20 text-[0.9375rem] font-medium">
          <p className="flex items-center gap-2 py-2.5">
            <CalendarIcon className="size-[1.125rem] shrink-0 opacity-90" />
            {severalDays
              ? t.event.dateRange(f.dateLong(start), f.dateLong(end))
              : f.dateLong(start)}
          </p>
          <p className="flex items-center gap-2 py-2.5">
            <PinIcon className="size-[1.125rem] shrink-0 opacity-90" />
            {event.location}
          </p>
          {deadline && (
            <p className="flex items-start gap-2 py-2.5">
              <ClockIcon className="mt-px size-[1.125rem] shrink-0 opacity-90" />
              <span>
                {registrationLabel(deadline, f, t)}
                {deadline.kind === "open" &&
                  deadline.daysLeft <= DAYS_LEFT_SHOWN &&
                  `${SEPARATOR}${t.event.daysLeft(deadline.daysLeft)}`}
              </span>
            </p>
          )}
        </div>
        {event.notes && (
          <p className="self-start rounded-xl glass px-3.5 py-3 text-[0.9375rem] whitespace-pre-line text-ink">
            {event.notes}
          </p>
        )}
        {registration && <RegisterLink href={registration} tone="onDawn" className="mt-1" />}
      </div>
    </header>
  );
}

export const variants: Variants = { EventCard: Sheet, EventHero: SheetHero };
