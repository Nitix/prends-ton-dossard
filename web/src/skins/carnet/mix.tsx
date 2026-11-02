import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DateChip } from "../../components/Dawn";
import { CalendarIcon, ClockIcon, PinIcon } from "../../components/icons";
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
import { daysToGo as daysToGoOf } from "../../lib/dates";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import type { EventCardProps, EventHeroProps, Variants } from "../types";
import { Accent, DotRing, KindMark } from "./marks";

// « Carnet », depth mix: a logbook drawn like a technical sheet. The card of an
// event is a white sheet with its name in two voices (the bold sans, its last
// word in an italic serif), the ring of dots of the days left in its corner,
// and its formats on hairlines, each with the square of its kind of race; the
// top of the page of an event is paper, as the variant has it: the kinds of its
// races, the same two voices and the same ring, and its date, its place and
// where its registration stands in a grid framed by hairlines. Each keeps what Crête's piece shows,
// with the same words. The day of an event is Crête's own `DateChip`, dressed
// by mix.css. What these import is only used while they render (see
// ../README.md).

/** A line of the card, on its hairline: what it is, and its runners at the end. */
function Line({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 py-2.5 last:pb-0">
      {children}
    </li>
  );
}

/** The name of a format in ink; the square of its kind goes before it. */
const NAME_IN_INK: FormatMarks = {
  name: (name) => <span className="format-name font-medium text-ink">{name}</span>,
};

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
  const daysToGo = daysToGoOf(start, end, today);
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
        <ul className="event-card-formats mt-3.5 divide-y divide-neutral-200 border-t border-neutral-200">
          {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
          {interested.length > 0 && (
            <Line>
              <p className="text-sm text-neutral-700">{t.event.formatToChoose}</p>
              <ParticipantChips participations={interested} label={t.event.interestedTitle} />
            </Line>
          )}
          {formats.map((formatView) => (
            <Line key={formatView.format.id}>
              <FormatLine
                formatView={formatView}
                showDate={severalDays}
                marks={{ ...NAME_IN_INK, before: <KindMark label={formatView.raceType.label} /> }}
                className="flex items-baseline gap-2 text-sm text-neutral-600"
              />
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

/** A fact of the event, in the grid framed by hairlines: its picture, then its words. */
function Fact({
  icon,
  className = "",
  children,
  ...props
}: {
  icon: ReactNode;
  className?: string;
  children: ReactNode;
  "data-kind"?: string;
}) {
  return (
    <li {...props} className={`flex items-start gap-2 bg-card px-3.5 py-3 ${className}`}>
      <span aria-hidden="true" className="mt-0.5 shrink-0 text-neutral-500">
        {icon}
      </span>
      <span className="text-[0.9375rem] leading-snug text-ink">{children}</span>
    </li>
  );
}

/**
 * The top of the page of an event, paper as the variant has it: the kinds of its
 * races over the name in two voices (the title of the page), the ring of dots of
 * the days left beside it with the words under it, then the date, the place and
 * where the registration stands in a grid framed by hairlines, the notes and the
 * link to register.
 */
function SheetHero({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysToGoOf(start, end, today);
  // The kinds of its races, once each, over the title.
  const kinds = [...new Map(formats.map(({ raceType }) => [raceType.id, raceType.label])).values()];

  return (
    <header className="event-hero flex flex-col gap-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-3">
          {kinds.length > 0 && (
            <p className="eyebrow flex flex-wrap items-center gap-x-3 gap-y-1">
              {kinds.map((kind) => (
                <span key={kind} className="inline-flex items-center gap-1.5">
                  <KindMark label={kind} />
                  {kind}
                </span>
              ))}
            </p>
          )}
          <h1
            {...heading}
            className="event-hero-title text-[2.25rem] leading-[1.02] font-semibold tracking-[-0.035em] text-balance break-words text-ink md:text-[3rem]"
          >
            <Accent text={event.name} />
          </h1>
        </div>
        {daysToGo !== null && daysToGo > 0 && (
          <div className="mt-1 flex shrink-0 flex-col items-center gap-1">
            <DotRing days={daysToGo} size={64} silent />
            <p className="days-left text-[0.6875rem] whitespace-nowrap text-neutral-600">
              {f.inDays(daysToGo)}
            </p>
          </div>
        )}
      </div>
      <ul
        className={`event-hero-facts grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-neutral-200 bg-neutral-200 ${
          deadline ? "md:grid-cols-[1.15fr_0.85fr_1.6fr]" : ""
        }`}
      >
        <Fact icon={<CalendarIcon className="size-4" />}>
          {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </Fact>
        <Fact icon={<PinIcon className="size-4" />}>{event.location}</Fact>
        {deadline && (
          <Fact
            icon={<ClockIcon className="size-4" />}
            data-kind={deadline.kind}
            className="event-hero-deadline col-span-2 md:col-span-1"
          >
            {deadlineText(deadline, f, t)}
          </Fact>
        )}
      </ul>
      {event.notes && (
        <p className="event-hero-notes max-w-prose text-[0.9375rem] whitespace-pre-line text-neutral-700">
          {event.notes}
        </p>
      )}
      {registration && <RegisterLink href={registration} />}
    </header>
  );
}

export const variants: Variants = { EventCard: Sheet, EventHero: SheetHero };
