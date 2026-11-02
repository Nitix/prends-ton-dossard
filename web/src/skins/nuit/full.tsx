import { Fragment } from "react";

import { Figure } from "../../components/Figure";
import { HeroArt } from "../../components/Slots";
import { RegisterLink } from "../../features/events/RegisterLink";
import { deadlineText, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import type { EventHeroProps, TrackFiguresProps, Variants } from "../types";

// « Nuit », depth full: the pieces whose markup the variant of v4 (design/v4-nuit)
// draws its own way: the top of the page of an event (the date in lime over the
// title, the rest in a column, no ring), the figures of a track as one line of
// the display face (a pace, not tiles), and no ring of the days left (the
// words beside it say them, in a lime or cyan pill: full.css). Each keeps every
// text, every link and the title the page gives its hero. What it reads, it
// reads as Crête's does (`useToday`, `registrationState`, `deadlineText`...),
// at render, never when this module is evaluated (README, « Markup variants »).

const SEPARATOR = " · ";

/**
 * The top of the page of an event, under the headlamp: the days in lime over
 * the name of the event (the title of the page, with the `heading` that the
 * page gives it), then the place, where its registration stands, its notes and
 * the link to register. The title is the first of the page in the order of the
 * reading; the date is put over it by the column (`order`). The tape on its
 * top edge is the skin's art behind a hero.
 */
function HeadlampHero({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);

  return (
    <header className="event-hero on-dawn relative flex flex-col gap-1.5 overflow-hidden bg-dawn-hero p-5 text-ink md:p-7">
      <HeroArt place="event" />
      <h1
        {...heading}
        className="event-hero-title relative min-w-0 font-display text-[1.875rem] leading-tight font-bold display-title text-balance break-words md:text-4xl"
      >
        {event.name}
      </h1>
      <p className="event-hero-date relative order-first font-display text-sm font-semibold tracking-wide text-iris-600">
        {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
      </p>
      <p className="event-hero-facts relative text-neutral-700">{event.location}</p>
      {deadline && (
        <p
          data-kind={deadline.kind}
          className="event-hero-deadline relative text-sm text-neutral-600"
        >
          {deadlineText(deadline, f, t)}
        </p>
      )}
      {event.notes && (
        <p className="event-hero-notes relative mt-3 border-l-2 border-neutral-300 pl-3 whitespace-pre-line text-neutral-700">
          {event.notes}
        </p>
      )}
      {registration && <RegisterLink href={registration} tone="onDawn" className="relative mt-4" />}
    </header>
  );
}

/**
 * The figures of a track as one line, in the display face, one after the other
 * like the splits of a run (« 12,6 km · 724 m D+ · 728 m D− »), and the
 * altitudes under them. Every figure and its separator are in the text.
 */
function PaceFigures({ figures, altitude }: TrackFiguresProps) {
  return (
    <>
      <p className="route-figures font-display text-lg font-semibold tabular-nums">
        {figures.map((figure, i) => (
          <Fragment key={figure}>
            {i > 0 && <span className="text-neutral-500">{SEPARATOR}</span>}
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
 * No ring: the days left are in words, in a pill (`.days-left`), and the ring
 * would only repeat them. It draws a hidden mark rather than nothing at all:
 * the shared test of the pieces (components.test.tsx) waits for something in
 * the box of each one.
 */
function NoRing() {
  return <span aria-hidden="true" hidden />;
}

export const variants: Variants = {
  EventHero: HeadlampHero,
  TrackFigures: PaceFigures,
  CountdownRing: NoRing,
};
