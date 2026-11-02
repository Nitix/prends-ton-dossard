import { Link } from "@tanstack/react-router";

import { DateChip } from "../../components/Dawn";
import { PinIcon } from "../../components/icons";
import { FormatLine, type FormatMarks } from "../../features/events/FormatLine";
import { ParticipantChips } from "../../features/events/ParticipantChips";
import { starters } from "../../features/events/participants";
import { registrationLabel, registrationState } from "../../features/events/registration";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { EventCardProps, Variants } from "../types";

// « Rétro », depth mix: the race ticket. The card of an event is a ticket in an
// ink outline with a hard shadow: the day (the stamp of mix.css), the name and
// the place above a perforation with a notch cut in each edge, and on the stub
// the formats, as a name followed by the small tags of its measures, and the
// patches of the runners. It keeps what Crête's card says, with the same
// words. The stamp of the day is Crête's own `DateChip` (the markup is the
// same, mix.css gives it the mustard and the ink). What this imports is only
// used while it renders (see ../README.md).

/**
 * How a format of the stub is marked: its name, then each measure as a small
 * tag, like the numbers printed on a ticket. `FormatLine` keeps the separators
 * in the text, for a screen reader and a copy, and only the tags show them.
 */
const TAGS: FormatMarks = {
  measure: (measure) => (
    <span className="ml-1.5 inline-block rounded-full border-[1.5px] border-neutral-300 bg-card px-2 py-px align-[0.1em] text-[0.78rem] leading-normal font-semibold whitespace-nowrap text-neutral-800">
      {measure}
    </span>
  ),
};

/**
 * An event in a list, as a race ticket: above the perforation, its day, its
 * name (the link to its page, a bar tall enough to tap), its place and where
 * its registration stands; on the stub, who is interested with no format chosen
 * yet, each format with its runners, then the supporters. Those who do not
 * start are not on the card.
 */
function Ticket({ view }: EventCardProps) {
  const { t, f } = useI18n();
  const today = useToday();
  const { event, formats, start, end } = view;
  const severalDays = !start.equals(end);
  const interested = starters(view.interested);
  const registration = registrationState(event, today);
  const stub = interested.length > 0 || formats.length > 0 || view.supporters.length > 0;

  return (
    <article className="event-card card card-lift flex h-full flex-col">
      <div className="flex gap-3 p-3">
        <DateChip
          start={start}
          end={end}
          label={severalDays ? t.event.dateRange(f.date(start), f.date(end)) : f.date(start)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <h3 className="font-display text-lg leading-tight font-bold display-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="-my-1 flex min-h-11 items-center decoration-peach-400 decoration-[3px] underline-offset-4 hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="flex items-center gap-1.5 text-sm font-medium text-neutral-700">
            <PinIcon className="size-4 shrink-0 text-blush-600" />
            {event.location}
          </p>
          {registration && (
            <p
              className={`mt-1 self-start rounded-full border-[1.5px] px-2.5 py-1 text-xs font-semibold ${
                registration.kind === "open"
                  ? "border-ink bg-peach-100 text-ink"
                  : "border-neutral-300 bg-neutral-100 text-neutral-700"
              }`}
            >
              {registrationLabel(registration, f, t)}
            </p>
          )}
        </div>
      </div>
      {stub && (
        <>
          <div aria-hidden="true" className="perforation" />
          <div className="flex flex-col gap-2.5 p-3">
            {/* Before the formats, since there is something left to choose. The words say it, not the place. */}
            {interested.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-semibold text-blush-700">{t.event.formatToChoose}</p>
                <ParticipantChips participations={interested} label={t.event.interestedTitle} />
              </div>
            )}
            {formats.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {formats.map((formatView) => (
                  <li key={formatView.format.id} className="flex flex-col gap-1.5">
                    <FormatLine
                      formatView={formatView}
                      showDate={severalDays}
                      marks={TAGS}
                      className="text-sm font-semibold"
                    />
                    <ParticipantChips participations={starters(formatView.participations)} />
                  </li>
                ))}
              </ul>
            )}
            {/* After the formats: they come to cheer, they start nothing. The words say it, not the place. */}
            {view.supporters.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm font-semibold text-neutral-700">{t.event.supportersTitle}</p>
                <ParticipantChips
                  participations={view.supporters}
                  label={t.event.supportersTitle}
                />
              </div>
            )}
          </div>
        </>
      )}
    </article>
  );
}

export const variants: Variants = { EventCard: Ticket };
