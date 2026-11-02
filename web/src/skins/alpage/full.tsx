import { Link } from "@tanstack/react-router";

import { DateChip } from "../../components/Dawn";
import { PinIcon } from "../../components/icons";
import { FormatLine } from "../../features/events/FormatLine";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { registrationLabel, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { terrainOf } from "../sentier/terrain";
import type { VariantPropsOf, Variants } from "../types";

// « Alpage », depth full: the one piece of its variant whose markup differs from
// Crête's, its card. « Alpage » is « Sentier » in « Aurore »'s layout, which is
// Crête's, so the card is Crête's own, but for its formats: each is a panel on
// the tint of its terrain (the road, the forest, the high mountain…), a point of
// the terrain before its words. The terrain is `data-terrain` of the format, read
// from the label of its race type by « Sentier »'s `terrainOf` (../sentier/terrain.ts,
// which holds the file); its mark and its tint are in full.css, from the palette.
// The type is in the words, never in the tint alone. Everything Crête's card
// shows is here (see ../README.md, « Markup variants »); only the markup differs.
// What these modules import from the app they use while they render, never when
// they are evaluated.

/** An event in a list, as Crête draws it, its formats on the tint of their terrain. */
function TerrainCard({ view }: VariantPropsOf<"EventCard">) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, useToday());

  return (
    <article className="event-card card card-lift flex flex-col gap-3 p-4">
      <div className="event-card-head flex gap-3.5">
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
        </div>
      </div>
      {/* Under the chip on a phone, where there is room; beside it from `sm`. */}
      <div className="event-card-body flex flex-col gap-3 empty:hidden sm:pl-[4.625rem]">
        {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
        {interested.length > 0 && (
          <div data-kind="interested" className="event-card-people flex flex-col gap-1.5">
            <p className="text-sm font-medium">{t.event.formatToChoose}</p>
            <ParticipantChips participations={interested} label={t.event.interestedTitle} />
          </div>
        )}
        {formats.length > 0 && (
          <ul className="event-card-formats flex flex-col gap-2">
            {formats.map((formatView) => (
              <li
                key={formatView.format.id}
                data-terrain={terrainOf(formatView.raceType.label)}
                className="event-card-format flex flex-col gap-2 rounded-2xl bg-neutral-50 px-3 py-2.5"
              >
                <FormatLine
                  formatView={formatView}
                  showDate={severalDays}
                  className="flex items-baseline gap-2 text-sm text-neutral-800"
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
    </article>
  );
}

export const variants: Variants = { EventCard: TerrainCard };
