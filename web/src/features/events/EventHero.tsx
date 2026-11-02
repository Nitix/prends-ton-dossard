import { CountdownRing } from "../../components/Dawn";
import { CalendarIcon, ClockIcon, PinIcon } from "../../components/icons";
import { HeroArt } from "../../components/Slots";
import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import { skinnable } from "../../skins/components";
import type { EventHeroProps } from "../../skins/types";
import { RegisterLink } from "./RegisterLink";
import { deadlineText, registrationState } from "./registration";

/**
 * The top of the page of an event, its hero: its name (the title of the page),
 * the days left before it starts (a ring), its day or days, its place, where its
 * registration stands (and the days left in the last week), its notes, and the
 * link to register on its official page. On the sky of the dawn drawn like a map
 * (the skin's `HeroArt`), the name in white, and the sun rising behind the
 * ridges at its foot.
 */
export function EventHeroBase({ view, heading }: EventHeroProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);

  return (
    <header className="event-hero on-dawn relative overflow-hidden rounded-[1.75rem] bg-dawn-hero text-white shadow-glow">
      <HeroArt place="event" />
      <div className="event-hero-body relative flex flex-col gap-3 p-5 pb-[5.25rem] md:p-7 md:pb-24">
        <div className="flex items-start justify-between gap-4">
          <h1
            {...heading}
            className="event-hero-title min-w-0 font-display text-[1.875rem] leading-[1.1] font-extrabold display-title break-words md:text-[2.375rem]"
          >
            {event.name}
          </h1>
          {daysToGo > 0 && <CountdownRing days={daysToGo} tone="light" className="mt-1" />}
        </div>
        <div className="event-hero-facts flex flex-col gap-1.5 text-[0.9375rem] font-medium">
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
          <p
            data-kind={deadline.kind}
            className="event-hero-deadline flex items-start gap-2 self-start rounded-2xl bg-(--hero-veil) px-3 py-2 text-sm font-semibold ring-1 ring-white/25"
          >
            <ClockIcon className="mt-px size-[1.125rem] shrink-0" />
            <span>{deadlineText(deadline, f, t)}</span>
          </p>
        )}
        {event.notes && (
          <p className="event-hero-notes self-start rounded-2xl glass px-3.5 py-3 text-[0.9375rem] whitespace-pre-line text-ink shadow-[0_8px_24px_-14px_var(--shade-notes)]">
            {event.notes}
          </p>
        )}
        {registration && <RegisterLink href={registration} tone="onDawn" className="mt-1" />}
      </div>
    </header>
  );
}

/** The top of the page of an event, as the skin of the page draws it at the depth of the build (Crête's above, by default). */
export const EventHero = skinnable("EventHero", EventHeroBase);
