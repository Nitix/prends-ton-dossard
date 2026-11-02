import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { DateChip } from "../../components/Dawn";
import { PinIcon } from "../../components/icons";
import { FormatLine } from "../../features/events/FormatLine";
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
import { countdownZone, raceTypeZone, WatchRing, ZoneBar } from "./watch";

// « Chrono », depth mix: the screen of a GPS watch. The card of an event has
// the ring of the days left in its corner and the bar of a zone before each
// format (the zone of its kind of race) and before the end of the
// registrations (the zone of how soon it is); the top of the page of an event
// is the screen of the watch: its figures (distance, elevation gain, duration)
// on a white screen under the title, the ring of the days left on its zone.
// Each keeps what Crête's piece shows, with the same words (the marks are
// pictures, and what they mean is written beside them). The day of an event
// is Crête's own `DateChip`, dressed by mix.css. What these import is only
// used while they render (see ../README.md).

/**
 * An event in a list, on the screen of a watch: its day, its name (the link to
 * its page, a bar tall enough to tap), its place, where its registration
 * stands (with the bar of its zone) and the ring of the days left in the
 * corner of an event that is not over; under a thin line, who is interested
 * with no format chosen yet, each format with its runners, and the supporters.
 */
function WatchCard({ view }: EventCardProps) {
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
    <article className="event-card card card-lift flex h-full flex-col">
      <div className="flex items-start gap-3 px-4 pt-3.5 pb-3">
        <DateChip
          start={start}
          end={end}
          label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h3 className="font-display text-[1.0625rem] leading-snug font-bold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center underline-offset-4 hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="flex items-center gap-1.5 text-sm text-neutral-600">
            <PinIcon className="size-4 shrink-0 text-blush-600" />
            {event.location}
          </p>
          {registration && (
            <p className="mt-0.5 flex items-center gap-2 text-sm text-neutral-700">
              <ZoneBar
                zone={registration.kind === "open" ? countdownZone(registration.daysLeft) : null}
              />
              {registrationLabel(registration, f, t)}
            </p>
          )}
        </div>
        {daysToGo !== null && <WatchRing days={daysToGo} />}
      </div>
      {hasPeople && (
        <div className="flex flex-col gap-3 border-t border-neutral-100 px-4 pt-3 pb-4">
          {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
          {interested.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t.event.formatToChoose}</p>
              <ParticipantChips participations={interested} label={t.event.interestedTitle} />
            </div>
          )}
          {formats.length > 0 && (
            <ul className="flex flex-col gap-3">
              {formats.map((formatView) => (
                <li key={formatView.format.id} className="flex flex-col gap-1.5">
                  <FormatLine
                    formatView={formatView}
                    showDate={severalDays}
                    marks={{ before: <ZoneBar zone={raceTypeZone(formatView.raceType.label)} /> }}
                    className="flex items-center gap-2 text-sm text-neutral-700"
                  />
                  <ParticipantChips participations={starters(formatView.participations)} />
                </li>
              ))}
            </ul>
          )}
          {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
          {view.supporters.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t.event.supportersTitle}</p>
              <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/** The smallest and the largest of the values that are set (the API sends 0 for what is not). */
function span(values: (number | undefined)[]): [number, number] | null {
  const given = values.filter((value): value is number => value !== undefined && value > 0);
  if (given.length === 0) return null;
  return [Math.min(...given), Math.max(...given)];
}

/** A number or a range of numbers with its unit, the unit smaller: « 15–42 km ». */
function Measure({
  range,
  unit,
  locale,
}: {
  range: [number, number];
  unit: "kilometer" | "meter";
  locale: string;
}) {
  const format = new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    maximumFractionDigits: unit === "kilometer" ? 1 : 0,
  });
  const [from, to] = range;
  const parts = from === to ? format.formatToParts(from) : format.formatRangeToParts(from, to);
  return (
    <>
      {parts.map((part, at) => (
        // The parts of a number may repeat: the place is part of the key.
        // oxlint-disable-next-line react/no-array-index-key
        <span
          key={`${at}:${part.type}`}
          className={part.type === "unit" ? "text-sm font-medium text-neutral-600" : undefined}
        >
          {part.value}
        </span>
      ))}
    </>
  );
}

/**
 * The top of the page of an event, a light head as the variant has it: the date
 * in small mono capitals over the name (the title of the page), its place, then
 * the screen of the watch, a white card on the grid of a chart: the figures of
 * its formats in the mono face (the distance, the elevation gain, the duration
 * and the time limit when a format has them, a range when they differ) and the
 * ring of the days left in it, on its zone; under it where the registration
 * stands (with the bar of its zone), the notes and the link to register.
 */
function WatchHero({ view, heading }: EventHeroProps) {
  const { t, f, formatLocale } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysToGoOf(start, end, today);

  const distance = span(formats.map(({ format }) => format.distance_km));
  const elevation = span(formats.map(({ format }) => format.elevation_gain_m));
  const duration = span(formats.map(({ format }) => format.duration_min));
  const limit = span(formats.map(({ format }) => format.time_limit_min));
  const minutes = (range: [number, number]) =>
    range[0] === range[1]
      ? f.duration(range[0])
      : `${f.duration(range[0])}–${f.duration(range[1])}`;
  const figures: { key: string; label: string; value: ReactNode }[] = [];
  if (distance) {
    figures.push({
      key: "distance",
      label: t.form.measureNames.distance,
      value: <Measure range={distance} unit="kilometer" locale={formatLocale} />,
    });
  }
  if (elevation) {
    figures.push({
      key: "elevation",
      label: t.form.measureNames.elevation,
      value: <Measure range={elevation} unit="meter" locale={formatLocale} />,
    });
  }
  if (duration) {
    figures.push({
      key: "duration",
      label: t.form.measureNames.duration,
      value: minutes(duration),
    });
  }
  if (limit) {
    figures.push({
      key: "time_limit",
      label: t.form.measureNames.time_limit,
      value: minutes(limit),
    });
  }
  const counting = daysToGo !== null && daysToGo > 0;

  return (
    <header className="event-hero flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1
          {...heading}
          className="event-hero-title font-display text-[1.75rem] leading-tight font-bold display-title tracking-[-0.02em] break-words text-ink md:text-[2.125rem]"
        >
          {event.name}
        </h1>
        {/* Above the name, as on a watch; read after it. */}
        <p className="event-hero-date order-first font-mono text-[0.6875rem] leading-4 font-semibold tracking-[0.08em] text-neutral-700 uppercase">
          {severalDays ? t.event.dateRange(f.dateLong(start), f.dateLong(end)) : f.dateLong(start)}
        </p>
        <p className="event-hero-place flex items-center gap-1.5 text-neutral-700">
          <PinIcon className="size-[1.125rem] shrink-0 text-neutral-600" />
          {event.location}
        </p>
      </div>
      {(figures.length > 0 || counting) && (
        <div className="watch-screen card flex items-stretch overflow-hidden">
          {figures.length > 0 && (
            <dl className="grid flex-1 grid-cols-2 gap-x-4 gap-y-3 bg-card/75 px-4 py-3 sm:flex sm:flex-wrap sm:items-center sm:gap-x-8 sm:px-5">
              {figures.map(({ key, label, value }) => (
                <div key={key} className="flex min-w-0 flex-col gap-1">
                  <dt className="eyebrow">{label}</dt>
                  <dd className="font-mono text-lg leading-tight font-semibold tracking-tight break-words text-ink sm:text-2xl sm:whitespace-nowrap">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}
          {counting && (
            <div
              className={`flex items-center justify-center bg-card/75 px-4 py-3 sm:px-6 ${
                figures.length > 0 ? "border-l border-neutral-200" : "flex-1"
              }`}
            >
              <WatchRing days={daysToGo} size={68} />
            </div>
          )}
        </div>
      )}
      {deadline && (
        <p
          data-kind={deadline.kind}
          className="event-hero-deadline flex items-center gap-2.5 text-sm font-medium text-ink"
        >
          <ZoneBar zone={deadline.kind === "open" ? countdownZone(deadline.daysLeft) : null} />
          <span>{deadlineText(deadline, f, t)}</span>
        </p>
      )}
      {event.notes && (
        <p className="event-hero-notes whitespace-pre-line text-neutral-800">{event.notes}</p>
      )}
      {registration && <RegisterLink href={registration} />}
    </header>
  );
}

export const variants: Variants = { EventCard: WatchCard, EventHero: WatchHero };
