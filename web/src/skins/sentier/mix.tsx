import { SKIN_DEPTH } from "..";
import { Avatar } from "../../components/Avatar";
import { CountdownRing } from "../../components/Dawn";
import { ClockIcon, PinIcon } from "../../components/icons";
import { RegisterLink } from "../../features/events/RegisterLink";
import { deadlineText, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { daysBetween } from "../../lib/dates";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import { Contours } from "../crete/Alpenglow";
import type { VariantPropsOf, Variants } from "../types";
import { Blaze, Ridges, Sun } from "./motifs";

// « Sentier », depth mix: the two heroes of its variant, which are light. The
// sky of Crête's hero is pine with white words; in « Sentier » the top of the
// page of an event, and the one of a runner, are a page of a map at dawn: a
// wash of sunrise, sand and moss, faint contour lines, pale ridges and the
// sun, under the words in pine. Everything the base shows is here (see
// ../README.md, « Markup variants »); only the markup differs. What these
// modules import from the app they use while they render, never when they are
// evaluated (the cycle of imports that a variant closes: ../README.md).

/**
 * The pale ridges of a light hero, in the greens of the palette (`iris` is the
 * pine). Both are opaque, the far one the pale pine laid over the moss of the
 * foot of the hero: where a ridge covers the sun it hides it, as in the variant.
 * A translucent far ridge let the lower half of the sun show through, as a
 * muddy disc.
 */
const FAR = "color-mix(in srgb, var(--color-iris-200) 70%, var(--color-blush-100))";
const NEAR = "var(--color-iris-100)";

/** The top of the page of an event, on sand and moss. */
function SentierEventHero({ view, heading }: VariantPropsOf<"EventHero">) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, start, end } = view;
  const severalDays = !start.equals(end);
  const registration = webAddress(event.registration_url);
  const deadline = registrationState(event, today);
  const daysToGo = daysBetween(today, start);
  // At full the skin's ring draws nothing (full.tsx): the days left are written, in words.
  // At mix Crête's ring shows them (to the eye: it is hidden from a screen reader, as its base's).
  const writeDays = SKIN_DEPTH === "full" && daysToGo > 0;

  return (
    <header className="event-hero flex flex-col gap-4">
      {/* Dawn over the ridges: the name of the event, its days, its place and its deadline. */}
      <div className="relative overflow-hidden rounded-[1.75rem] border border-neutral-300/70 bg-linear-to-b from-peach-100 via-neutral-50 to-blush-100 shadow-card">
        <span aria-hidden="true" className="pointer-events-none absolute inset-0">
          <Contours className="text-iris-700 opacity-[0.07]" />
          <Sun className="right-[17%] bottom-5 size-12 animate-rise md:bottom-7 md:size-16" />
          <Ridges far={FAR} near={NEAR} className="inset-x-0 bottom-0 h-14 w-full md:h-20" />
        </span>
        <div className="event-hero-body relative flex flex-col gap-3 p-5 pb-[5.25rem] md:p-7 md:pb-24">
          <div className="flex items-start justify-between gap-4">
            {/* The title comes first in the markup (it is read first, and the page gives it the
                focus); the column is reversed, so the date is drawn over it. */}
            <div className="flex min-w-0 flex-col-reverse gap-2.5">
              <h1
                {...heading}
                className="event-hero-title font-display text-[1.875rem] leading-[1.1] font-bold display-title break-words text-iris-900 md:text-[2.375rem]"
              >
                {event.name}
              </h1>
              <div className="flex flex-wrap items-center gap-2 self-start">
                <p className="event-hero-date flex items-center gap-2 rounded-lg bg-card/80 px-2.5 py-1.5 text-sm font-semibold ring-1 ring-neutral-300/60">
                  <Blaze />
                  {severalDays
                    ? t.event.dateRange(f.dateLong(start), f.dateLong(end))
                    : f.dateLong(start)}
                </p>
                {writeDays && <p className="event-hero-days days-left">{f.inDays(daysToGo)}</p>}
              </div>
            </div>
            {daysToGo > 0 && <CountdownRing days={daysToGo} className="mt-1" />}
          </div>
          <p className="flex items-center gap-2 text-[0.9375rem] font-medium text-neutral-700">
            <PinIcon className="size-[1.125rem] shrink-0 text-iris-500" />
            {event.location}
          </p>
          {deadline && (
            <p
              data-kind={deadline.kind}
              className={`event-hero-deadline flex items-start gap-2 self-start text-sm font-semibold ${
                deadline.kind === "open" ? "text-peach-800" : "text-neutral-700"
              }`}
            >
              <ClockIcon className="mt-px size-[1.125rem] shrink-0" />
              <span>{deadlineText(deadline, f, t)}</span>
            </p>
          )}
        </div>
      </div>
      {event.notes && (
        <p className="event-hero-notes border-l-4 border-iris-200 pl-3 text-[0.9375rem] whitespace-pre-line text-ink">
          {event.notes}
        </p>
      )}
      {/* The call to action of the page (a sunrise button: mix.css). */}
      {registration && <RegisterLink href={registration} />}
    </header>
  );
}

/** The top of the page of a runner, on moss and sand, their photo cut out by a white ring. */
function SentierRunnerHero({ runner, heading }: VariantPropsOf<"RunnerHero">) {
  const { t } = useI18n();

  return (
    <header className="runner-hero relative flex items-center gap-4 overflow-hidden rounded-[1.75rem] border border-neutral-300/70 bg-linear-to-br from-blush-100 via-neutral-50 to-peach-50 p-5 pb-12 shadow-card md:gap-6 md:p-7 md:pb-14">
      <span aria-hidden="true" className="pointer-events-none absolute inset-0">
        <Contours className="text-iris-700 opacity-[0.08]" />
        <Ridges far={FAR} near={NEAR} className="inset-x-0 bottom-0 h-8 w-full md:h-12" />
      </span>
      {runner && (
        <Avatar
          runner={runner}
          thumb="256x256"
          className="relative size-20 shrink-0 bg-blush-100 font-display text-2xl font-bold text-iris-800 shadow-card ring-4 ring-card min-[22.5rem]:size-24 min-[22.5rem]:text-3xl md:size-28"
        />
      )}
      <h1
        {...heading}
        className="relative min-w-0 font-display text-[clamp(1.5rem,8vw,1.875rem)] leading-[1.1] font-bold display-title break-words text-iris-900 md:text-[2.25rem]"
      >
        {runner ? runner.name : t.runner.title}
      </h1>
    </header>
  );
}

export const variants: Variants = { EventHero: SentierEventHero, RunnerHero: SentierRunnerHero };
