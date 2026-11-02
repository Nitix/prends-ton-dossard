import { Link } from "@tanstack/react-router";

import { CountdownRing } from "../../components/Dawn";
import { ClockIcon, PinIcon } from "../../components/icons";
import { FormatLine } from "../../features/events/FormatLine";
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
import { BibHoles, SafetyPin } from "./Bib";

// « Dossard », depth mix: what the variant draws as a race bib (design/v4-dossard):
// an event in a list is a bib (a band with its days, four punched holes, the
// day of the month as its number, a tear-off line), and the top of the page of
// an event is one big bib, pinned by its two top corners. The look of the bib
// (the colours of its band, its number, the holes) is in mix.css, which reads
// the tokens of the palette; this file is the markup. Each one keeps everything
// Crête's draws: every text, every link, every count. What it reads, it reads as
// Crête's does (`useToday`, `registrationState`, `RegisterLink`, `FormatLine`...),
// at render, never when this module is evaluated (README, « Markup variants »).

const SEPARATOR = " · ";

/**
 * An event in a list, cut like a race bib: a band with its day or days (the
 * colour of the list says which one it is in, `data-list`, and the words say
 * the rest), four punched holes, the day of the month as the big number. Then
 * its name (the link to its page), its place, where its registration stands.
 * Under a tear-off line: the runners who are interested with no format chosen
 * yet, each format with its measures and its starters, and the supporters.
 *
 * The big number repeats the day of the band: it is decoration, hidden from
 * screen readers, which read the band.
 */
function BibCard({ view, list }: EventCardProps) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, useToday());
  const hasRunners = interested.length > 0 || formats.length > 0 || view.supporters.length > 0;

  return (
    <article
      data-list={list}
      className="event-card card card-lift relative flex h-full flex-col overflow-hidden"
    >
      <BibHoles top="0.75rem" />
      <p className="bib-band px-8 py-2">
        {severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
      </p>
      <div className="flex gap-3 px-4 pt-3 pb-3">
        <span
          aria-hidden="true"
          className="bib-number flex w-14 shrink-0 flex-col items-center pt-1"
        >
          <span className="text-5xl">{start.day}</span>
          {severalDays && (
            <span className="mt-1 font-display text-sm font-extrabold text-neutral-600">
              {"→ "}
              {end.day}
            </span>
          )}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-display text-lg leading-tight font-extrabold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center underline-offset-4 hover:text-iris-700 hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="flex items-center gap-1.5 text-sm text-neutral-600">
            <PinIcon className="size-4 shrink-0 text-blush-500" />
            {event.location}
          </p>
          {registration && (
            <p
              className={`mt-1 self-start rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ${
                registration.kind === "open"
                  ? "bg-peach-50 text-peach-700 ring-peach-200"
                  : "bg-neutral-100 text-neutral-700 ring-neutral-200"
              }`}
            >
              {registrationLabel(registration, f, t)}
            </p>
          )}
        </div>
      </div>
      {hasRunners && (
        <div className="bib-tear mx-4 flex flex-col gap-3 pt-3 pb-5">
          {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
          {interested.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">{t.event.formatToChoose}</p>
              <ParticipantChips participations={interested} label={t.event.interestedTitle} />
            </div>
          )}
          {formats.length > 0 && (
            <ul className="flex flex-col gap-3">
              {formats.map((formatView) => (
                <li key={formatView.format.id} className="flex flex-col gap-1.5">
                  <FormatLine formatView={formatView} showDate={severalDays} />
                  <ParticipantChips participations={starters(formatView.participations)} />
                </li>
              ))}
            </ul>
          )}
          {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
          {view.supporters.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">{t.event.supportersTitle}</p>
              <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/**
 * The top of the page of an event: one big bib, pinned at its two top corners.
 * A band with the days, the day of the month as its number (decoration, the
 * band says it), the name (the title of the page, with the `heading` that the
 * page gives it), the days left under the number, the place; under a tear-off
 * line, where the registration stands, the notes, and the link to register.
 *
 * The grid places them; the order of the DOM is the one of the reading, the
 * name first, as in Crête's hero.
 */
function BibHero({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);
  const hasDetails = deadline !== null || event.notes !== "" || registration !== null;

  return (
    <header className="event-hero relative mt-3">
      <SafetyPin className="absolute -top-3.5 left-5 z-10 w-20 -rotate-12" />
      <SafetyPin className="absolute -top-3.5 right-5 z-10 w-20 -scale-x-100 rotate-12" />
      <div className="bib-hero relative grid grid-cols-[auto_minmax(0,1fr)] overflow-hidden rounded-[1.75rem] bg-card shadow-lift ring-1 ring-ink/5">
        <BibHoles top="1.05rem" />
        <h1
          {...heading}
          className="col-start-2 row-start-2 self-end pt-5 pr-5 font-display text-[1.625rem] leading-[1.05] font-black display-title break-words min-[24rem]:text-[1.875rem] md:text-[2.5rem]"
        >
          {event.name}
        </h1>
        <span
          aria-hidden="true"
          className="bib-number col-start-1 row-start-2 pt-5 pr-4 pl-5 text-[3.75rem] min-[24rem]:text-[4.5rem] md:pl-7 md:text-[6rem]"
        >
          {start.day}
        </span>
        {daysToGo > 0 && (
          <span className="col-start-1 row-start-3 pt-2 pb-5 pl-5 md:pl-7">
            <CountdownRing days={daysToGo} />
          </span>
        )}
        <p className="bib-band col-span-2 row-start-1 px-9 py-3 md:text-sm">
          {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </p>
        <p className="col-start-2 row-start-3 flex items-start gap-2 pt-1 pr-5 pb-5 text-neutral-600">
          <PinIcon className="mt-0.5 size-[1.125rem] shrink-0 text-blush-500" />
          {event.location}
        </p>
        {hasDetails && (
          <div className="bib-tear col-span-2 row-start-4 mx-5 flex flex-col gap-3 pt-4 pb-6">
            {deadline && (
              <p
                className={`flex items-start gap-2 self-start rounded-2xl px-3 py-2 text-sm font-semibold ring-1 ${
                  deadline.kind === "open"
                    ? "bg-peach-50 text-peach-700 ring-peach-200"
                    : "bg-neutral-100 text-neutral-700 ring-neutral-200"
                }`}
              >
                <ClockIcon className="mt-px size-[1.125rem] shrink-0" />
                <span>
                  {registrationLabel(deadline, f, t)}
                  {deadline.kind === "open" &&
                    deadline.daysLeft <= DAYS_LEFT_SHOWN &&
                    `${SEPARATOR}${t.event.daysLeft(deadline.daysLeft)}`}
                </span>
              </p>
            )}
            {event.notes && <p className="whitespace-pre-line">{event.notes}</p>}
            {registration && <RegisterLink href={registration} />}
          </div>
        )}
      </div>
    </header>
  );
}

export const variants: Variants = { EventCard: BibCard, EventHero: BibHero };
