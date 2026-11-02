import { Link } from "@tanstack/react-router";

import { DateChip } from "../../components/Dawn";
import { PinIcon } from "../../components/icons";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { skinnable } from "../../skins/components";
import type { EventCardProps } from "../../skins/types";
import { FormatLine } from "./FormatLine";
import { ParticipantChips } from "./ParticipantChips";
import { starters } from "./participants";
import { registrationLabel, registrationState } from "./registration";

/**
 * An event in a list: its day or days (a chip of sunrise, said in words to a
 * screen reader), its name (the link to its page, a bar as wide as the card and
 * tall enough to tap), its place, the runners who are interested with no format
 * chosen yet, each of its formats with its measures and its participants, then
 * its supporters. Those who do not start are not on the card. Under the place,
 * the registration deadline, if the event has one, and "Inscriptions closes"
 * once it has passed. Crête draws it alike in every list (`list`); a variant
 * may mark its formats (`decorFormat`) rather than draw it again.
 */
export function EventCardBase({ view, decorFormat }: EventCardProps) {
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
            {formats.map((formatView) => {
              const decor = decorFormat?.(formatView);
              return (
                <li
                  key={formatView.format.id}
                  data-format-kind={decor?.kind}
                  className="event-card-format flex flex-col gap-1.5 rounded-2xl bg-neutral-50 px-3 py-2.5"
                >
                  <FormatLine formatView={formatView} showDate={severalDays} marks={decor?.marks} />
                  <ParticipantChips participations={starters(formatView.participations)} />
                </li>
              );
            })}
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

/** An event in a list, as the skin of the page draws it at the depth of the build (Crête's above, by default). */
export const EventCard = skinnable("EventCard", EventCardBase);
