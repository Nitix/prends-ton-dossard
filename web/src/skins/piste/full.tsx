import { Fragment } from "react";

import { DateChip } from "../../components/Dawn";
import { Figure } from "../../components/Figure";
import { HeroArt } from "../../components/Slots";
import { FormatParts } from "../../features/events/FormatLine";
import { RegisterLink } from "../../features/events/RegisterLink";
import { deadlineText, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import type { EventHeroProps, FormatTitleProps, TrackFiguresProps, Variants } from "../types";
import { measureMarks } from "./Measures";

// « Piste », depth full: the pieces whose markup the variant of v4 (design/v4-piste)
// draws its own way: the top of the page of an event (a flat band of ink, the
// number of a lane beside the title), the title of a format (its measures as
// chips, as on the card), the figures of a track as one line of big figures,
// and no ring of the days left (the words beside it say them, as a bib, in
// full.css). Each keeps every text, every link and the title the page gives
// its hero. What it reads, it reads as Crête's does (`useToday`,
// `registrationState`, `deadlineText`, `FormatParts`...), at render, never when
// this module is evaluated (README, « Markup variants »).

const SEPARATOR = " · ";

/**
 * The top of the page of an event: the one bold moment of the page, a band of
 * ink with the bend of a track in its corner (the skin's art behind a hero).
 * From `sm`, the number of a lane (the day of the event) stands beside the
 * title; on a phone the date is written large under it. The title, with the
 * `heading` that the page gives it, comes first in the order of the reading,
 * then the days in words, the place, where the registration stands, the notes
 * and the link to register. On a phone the band runs to the edges of the page.
 */
function LaneBand({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysAhead = daysBetween(today, start);
  const dates = severalDays
    ? t.event.dateRange(f.dateLong(start), f.dateLong(end))
    : f.dateLong(start);

  return (
    // `-mx-4 -mt-6` bleeds the band out of the page's `main` to the edges of the screen and up to the
    // header: they are the `px-4 pt-6` of Crête's `main` (components/AppShell.tsx) up to md, where `md:mx-0 md:mt-0`
    // gives the band back as a card. A change to that padding is a change to these numbers.
    <header className="event-hero on-dawn relative isolate -mx-4 -mt-6 overflow-hidden bg-dawn-hero text-neutral-50 md:mx-0 md:mt-0 md:rounded-2xl">
      <HeroArt place="event" />
      <div className="event-hero-body relative flex flex-col px-4 pt-6 md:px-8 md:pt-8">
        <div className="flex items-start gap-4">
          {/* The date is in words beside it: the picture has none of its own. */}
          <div className="hidden sm:block">
            <DateChip start={start} end={end} label="" size="lg" />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h1
              {...heading}
              className="event-hero-title min-w-0 font-display text-[2.5rem] leading-[0.95] font-extrabold display-title break-words text-white md:text-5xl"
            >
              {event.name}
            </h1>
            <p className="event-hero-dates font-display text-xl leading-tight font-semibold tracking-[0.02em] text-iris-300 first-letter:uppercase">
              {dates}
            </p>
            <p className="event-hero-facts font-medium text-neutral-50/85">{event.location}</p>
            {/* Crête's hero shows the days left in a ring; this band has none, so it writes them, as a bib (`.days-left`). */}
            {daysAhead > 0 && (
              <p className="event-hero-days days-left mt-1 self-start">{f.inDays(daysAhead)}</p>
            )}
          </div>
        </div>
        {deadline && (
          <p
            data-kind={deadline.kind}
            className="event-hero-deadline mt-4 inline-flex items-start gap-2 self-start rounded-lg bg-white/10 px-3 py-2 text-sm font-semibold text-white ring-1 ring-white/20"
          >
            <span aria-hidden="true" className="mt-1.5 h-2 w-2.5 shrink-0 -skew-x-12 bg-iris-400" />
            <span>{deadlineText(deadline, f, t)}</span>
          </p>
        )}
        {event.notes && (
          <p className="event-hero-notes mt-4 max-w-prose whitespace-pre-line text-neutral-50/90">
            {event.notes}
          </p>
        )}
        {registration && <RegisterLink href={registration} tone="onDawn" className="mt-5" />}
      </div>
    </header>
  );
}

/**
 * The words of the title of a format: its name in the display face, then its
 * measures as big chips, as the card of an event has them. The separators stay
 * in the text for a screen reader, hidden from the eye (`FormatParts`).
 */
function ChipTitle({ parts }: FormatTitleProps) {
  return (
    <span className="format-title inline-flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      <FormatParts parts={parts} marks={measureMarks("lg")} />
    </span>
  );
}

/**
 * The figures of a track as one line of big figures, in the display face, one
 * after the other (« 12,6 km · 724 m D+ · 728 m D− »), and the altitudes
 * under them. Every figure and its separator are in the text.
 */
function NumeralFigures({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-display text-[1.625rem] leading-none font-bold text-ink tabular-nums">
        {figures.map((figure, i) => (
          <Fragment key={figure}>
            {i > 0 && <span className="text-neutral-600">{SEPARATOR}</span>}
            <Figure>{figure}</Figure>
          </Fragment>
        ))}
      </p>
      {altitude !== null && (
        <p className="route-altitude -mt-1 text-sm text-neutral-600">{altitude}</p>
      )}
    </>
  );
}

/**
 * No ring: the days left are in words, in a tag like a bib (`.days-left`), and
 * the ring would only repeat them.
 */
function NoRing() {
  return null;
}

export const variants: Variants = {
  EventHero: LaneBand,
  FormatTitle: ChipTitle,
  TrackFigures: NumeralFigures,
  CountdownRing: NoRing,
};
