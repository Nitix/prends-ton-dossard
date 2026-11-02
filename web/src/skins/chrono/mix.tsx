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

const SEPARATOR = " · ";

/** A format of the card: the bar of its zone, its first measure in bold, then the others. */
function ZonedFormat({ formatView, showDate }: { formatView: FormatView; showDate: boolean }) {
  const { t, f } = useI18n();
  const { format, raceType, date } = formatView;
  const [first, ...rest] = formatMeasures(format, raceType.label, f, t);

  return (
    <>
      {/* On an event of several days, the day of each format is worth knowing. */}
      {showDate && <p className="eyebrow">{f.date(date)}</p>}
      <p className="flex items-center gap-2 text-sm text-neutral-700">
        <ZoneBar zone={raceTypeZone(raceType.label)} />
        <span>
          <span className="font-semibold text-ink">{first}</span>
          {rest.length > 0 && `${SEPARATOR}${rest.join(SEPARATOR)}`}
        </span>
      </p>
    </>
  );
}

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
  const daysToGo =
    Temporal.PlainDate.compare(end, today) < 0 ? null : Math.max(0, daysBetween(today, start));
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
                  <ZonedFormat formatView={formatView} showDate={severalDays} />
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
 * The top of the page of an event, as the screen of a watch: the name (the
 * title of the page) with the ring of the days left, the date and the place,
 * where the registration stands (with the bar of its zone), the notes and the
 * link to register, then a white screen with the figures of its formats, in the
 * mono face: the distance, the elevation gain, the duration and the time limit
 * when a format has them, a range when they differ. The grid of a chart and the
 * strip of the zones are the skin's `HeroArt`.
 */
function WatchHero({ view, heading }: EventHeroProps) {
  const { t, f, formatLocale } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);

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

  return (
    <header className="event-hero on-dawn relative overflow-hidden bg-dawn-hero text-white">
      <HeroArt place="event" />
      <div className="relative flex flex-col gap-3 p-5 pb-6 md:p-7 md:pb-8">
        <div className="flex items-start justify-between gap-4">
          <h1
            {...heading}
            className="min-w-0 font-display text-[1.875rem] leading-[1.1] font-bold display-title break-words md:text-[2.375rem]"
          >
            {event.name}
          </h1>
          {daysToGo > 0 && (
            <span className="mt-1">
              <WatchRing days={daysToGo} size={56} light />
            </span>
          )}
        </div>
        <div className="flex flex-col gap-1.5 text-[0.9375rem] font-medium">
          <p className="flex items-center gap-2">
            <CalendarIcon className="size-[1.125rem] shrink-0 opacity-90" />
            {severalDays
              ? t.event.dateRange(f.dateLong(start), f.dateLong(end))
              : f.dateLong(start)}
          </p>
          <p className="flex items-center gap-2">
            <PinIcon className="size-[1.125rem] shrink-0 opacity-90" />
            {event.location}
          </p>
        </div>
        {deadline && (
          <p className="flex items-start gap-2 self-start rounded-lg border border-white/25 px-3 py-2 text-sm font-semibold">
            <ClockIcon className="mt-px size-[1.125rem] shrink-0" />
            <span>
              {registrationLabel(deadline, f, t)}
              {deadline.kind === "open" &&
                deadline.daysLeft <= DAYS_LEFT_SHOWN &&
                `${SEPARATOR}${t.event.daysLeft(deadline.daysLeft)}`}
            </span>
          </p>
        )}
        {event.notes && (
          <p className="self-start rounded-lg glass px-3.5 py-3 text-[0.9375rem] whitespace-pre-line text-ink">
            {event.notes}
          </p>
        )}
        {registration && <RegisterLink href={registration} tone="onDawn" className="mt-1" />}
        {figures.length > 0 && (
          <dl className="mt-1 grid grid-cols-2 gap-x-4 gap-y-3 rounded-xl bg-card px-4 py-3 text-ink sm:flex sm:flex-wrap sm:gap-x-8">
            {figures.map(({ key, label, value }) => (
              <div key={key} className="flex min-w-0 flex-col gap-1">
                <dt className="eyebrow">{label}</dt>
                <dd className="font-mono text-lg leading-tight font-semibold tracking-tight break-words sm:text-2xl sm:whitespace-nowrap">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </header>
  );
}

export const variants: Variants = { EventCard: WatchCard, EventHero: WatchHero };
