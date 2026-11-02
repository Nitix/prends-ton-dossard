import { Link } from "@tanstack/react-router";

import { DateChip } from "../../components/Dawn";
import { PinIcon } from "../../components/icons";
import { EmptyArt } from "../../components/Slots";
import { FormatLine } from "../../features/events/FormatLine";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { registrationLabel, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { VariantPropsOf, Variants } from "../types";
import { terrainOf } from "./terrain";

// « Sentier », depth full: the pieces of its variant whose markup differs from
// Crête's, over the two heroes of mix.tsx. Its card has a chip for the terrain
// of each format, beside the day as a trail sign; the title of a format says its
// terrain (the band on the edge of its section, in full.css); the figures of a
// track are one line of pine; an empty list is a quiet card with a map of the
// mountains; and the ring of the days left is gone (the words say them, in a
// badge: full.css). Everything the base shows is here (see ../README.md,
// « Markup variants »); only the markup differs. What these modules import
// from the app they use while they render, never when they are evaluated.

/**
 * An event in a list: the day as a trail sign (Crête's `DateChip`, which
 * full.css paints pale pine under a band of sunrise), and beside it the name,
 * the place, the deadline in a badge, then each format as a chip in the tint of
 * its terrain, with the runners under it. The terrain is `data-terrain` of the
 * format: its mark and its tint are in full.css, from the palette. The type is
 * in the words of the chip, never in the tint alone.
 */
function SentierEventCard({ view }: VariantPropsOf<"EventCard">) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, useToday());

  return (
    <article className="event-card card card-lift flex gap-3 p-3 sm:gap-4 sm:p-4">
      <DateChip
        start={start}
        end={end}
        label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h3 className="event-card-title font-display text-[1.0625rem] leading-snug font-bold display-title">
          <Link
            to="/evenements/$id"
            params={{ id: event.id }}
            className="-my-1 flex min-h-11 items-center underline-offset-4 hover:text-iris-700 hover:underline"
          >
            {event.name}
          </Link>
        </h3>
        <p className="event-card-place flex items-center gap-1.5 text-sm text-neutral-600">
          <PinIcon className="size-4 shrink-0 text-blush-500" />
          {event.location}
        </p>
        {registration && (
          <p
            data-kind={registration.kind}
            className={`event-card-deadline mt-1 self-start rounded-full px-2.5 py-1 text-xs font-semibold ${
              registration.kind === "open"
                ? "bg-peach-50 text-peach-800 ring-1 ring-peach-200"
                : "bg-neutral-100 text-neutral-700 ring-1 ring-neutral-200"
            }`}
          >
            {registrationLabel(registration, f, t)}
          </p>
        )}
        <div className="event-card-body mt-2 flex flex-col gap-3 empty:hidden">
          {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
          {interested.length > 0 && (
            <div data-kind="interested" className="event-card-people flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t.event.formatToChoose}</p>
              <ParticipantChips participations={interested} label={t.event.interestedTitle} />
            </div>
          )}
          {formats.length > 0 && (
            <ul className="event-card-formats flex flex-col gap-3 border-t border-neutral-200 pt-3">
              {formats.map((formatView) => (
                <li
                  key={formatView.format.id}
                  data-terrain={terrainOf(formatView.raceType.label)}
                  className="event-card-format flex flex-col gap-1.5"
                >
                  <FormatLine
                    formatView={formatView}
                    showDate={severalDays}
                    className="flex w-fit max-w-full items-baseline gap-1.5 rounded-lg px-2.5 py-1 text-sm font-medium text-ink"
                    marks={{
                      before: (
                        <span
                          aria-hidden="true"
                          className="terrain-mark size-2 shrink-0 -translate-y-px self-center rounded-full"
                        />
                      ),
                    }}
                  />
                  <ParticipantChips participations={starters(formatView.participations)} />
                </li>
              ))}
            </ul>
          )}
          {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
          {view.supporters.length > 0 && (
            <div data-kind="supporters" className="event-card-people flex flex-col gap-1.5">
              <p className="text-sm font-medium">{t.event.supportersTitle}</p>
              <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * The words of the title of a format, as Crête draws them, in a box that says
 * the terrain of the format (`data-terrain`, no box of its own: `contents`):
 * full.css draws the band of that terrain on the edge of the section that holds it.
 */
function TerrainTitle({ Base, ...props }: VariantPropsOf<"FormatTitle">) {
  return (
    <span data-terrain={terrainOf(props.formatView.raceType.label)} className="contents">
      <Base {...props} />
    </span>
  );
}

/** The figures of a track as one line of pine (length, gain, loss), then its altitudes. */
function FiguresLine({ figures, altitude }: VariantPropsOf<"TrackFigures">) {
  return (
    <>
      <p className="route-figures font-display text-lg font-semibold text-iris-800 tabular-nums">
        {figures.join(" · ")}
      </p>
      {altitude !== null && <p className="route-altitude text-sm text-neutral-600">{altitude}</p>}
    </>
  );
}

/** What a list says when it has nothing: a quiet card, its map of the mountains at the left of its words. */
function EmptyTrail({ title, hint }: VariantPropsOf<"EmptyState">) {
  return (
    <div className="empty-state card relative isolate flex items-start gap-3 overflow-hidden p-4 text-left">
      <EmptyArt />
      <div className="flex min-w-0 flex-col gap-1 self-center">
        <p className="card-title">{title}</p>
        <p className="text-sm text-neutral-700">{hint}</p>
      </div>
    </div>
  );
}

/**
 * The ring of the days left, drawn as nothing: a hidden element (components.test.tsx
 * wants a piece to leave something in its box), with no words, as its base says none.
 */
function NoRing() {
  return <span hidden aria-hidden="true" className="countdown-ring" />;
}

export const variants: Variants = {
  EventCard: SentierEventCard,
  FormatTitle: TerrainTitle,
  TrackFigures: FiguresLine,
  EmptyState: EmptyTrail,
  // The words beside it say the days left (a badge, in full.css): « Sentier » has no ring.
  CountdownRing: NoRing,
};
