import { Link } from "@tanstack/react-router";

import { DateChip } from "../../components/Dawn";
import { FormatLine } from "../../features/events/FormatLine";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { registrationLabel, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { EventCardProps, Variants } from "../types";
import { measureMarks } from "./Measures";

// « Piste », depth mix: what the variant draws as a lane of a track
// (design/v4-piste): an event in a list is a card with the number of a lane at
// its left, and every measure of a format is a chip. The look of the number is
// in mix.css (the day of an event, `.date-chip`, which the card draws through
// `DateChip`); this file is the markup of the card. It keeps everything Crête's
// draws: every text, every link, every count. What it reads, it reads as
// Crête's does (`useToday`, `registrationState`, `FormatLine`...), at render,
// never when this module is evaluated (README, « Markup variants »).

/**
 * An event in a list: its day or days (the number of a lane, and the date in
 * words for screen readers), then in a column its name (the link to its page),
 * its place, where its registration stands, the runners who are interested
 * with no format chosen yet, each format with its measures as chips and its
 * starters, then its supporters. Those who do not start are not on the card.
 */
function LaneCard({ view }: EventCardProps) {
  const { t, f } = useI18n();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, useToday());

  return (
    <article className="event-card card card-lift flex h-full gap-3.5 p-3.5">
      <DateChip
        start={start}
        end={end}
        label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* Not `display-title`, as in v4: the name of an event on a lane is in the display face at its own size, not in the italic capitals of the titles of the pages. */}
        <h3 className="font-display text-[1.375rem] leading-tight font-bold">
          <Link
            to="/evenements/$id"
            params={{ id: event.id }}
            className="-mt-1 flex min-h-11 items-center decoration-iris-500 decoration-2 underline-offset-4 hover:underline"
          >
            {event.name}
          </Link>
        </h3>
        <p className="-mt-1.5 text-sm font-medium text-neutral-600">{event.location}</p>
        {registration && (
          <p className="mt-0.5 self-start rounded-full border border-neutral-300 px-2.5 py-0.5 text-xs font-semibold text-neutral-700">
            {registrationLabel(registration, f, t)}
          </p>
        )}
        {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
        {interested.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="eyebrow">{t.event.formatToChoose}</p>
            <ParticipantChips participations={interested} label={t.event.interestedTitle} />
          </div>
        )}
        {formats.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2.5 border-t border-neutral-200 pt-2.5">
            {formats.map((formatView) => (
              <li key={formatView.format.id} className="flex flex-col gap-1.5">
                {/* The line of Crête's format, its name and each measure marked as a chip. */}
                <FormatLine
                  formatView={formatView}
                  showDate={severalDays}
                  marks={measureMarks()}
                  className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm"
                />
                <ParticipantChips participations={starters(formatView.participations)} />
              </li>
            ))}
          </ul>
        )}
        {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
        {view.supporters.length > 0 && (
          <div className="mt-2 flex flex-col gap-1.5">
            <p className="eyebrow">{t.event.supportersTitle}</p>
            <ParticipantChips participations={view.supporters} label={t.event.supportersTitle} />
          </div>
        )}
      </div>
    </article>
  );
}

export const variants: Variants = { EventCard: LaneCard };
