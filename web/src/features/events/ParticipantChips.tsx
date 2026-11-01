import { Avatar } from "../../components/Avatar";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationView } from "./api";

/**
 * The runners of a format (or of an event with no format yet), as round chips
 * with their photo, or their initials when they have none. `label` is the
 * accessible name of the list: "Participants" unless the list is something
 * else, like the runners who are interested.
 *
 * A participation the runner has not confirmed is dashed, and it says so in
 * words too: a text for screen readers, and a tooltip that tells who added it.
 * A chip never relies on its colour alone, and a photo does not change that:
 * the border and the text stay. The full name is in the text for screen
 * readers (the initials and the photo are hidden from them) and in the tooltip
 * of a confirmed chip.
 */
export function ParticipantChips({
  participations,
  label,
}: {
  participations: ParticipationView[];
  label?: string;
}) {
  const { t } = useI18n();

  if (participations.length === 0) return null;
  return (
    <ul aria-label={label ?? t.event.participants} className="flex flex-wrap gap-1">
      {participations.map(({ participation, runner, addedBy }) => {
        const confirmed = participation.confirmed;
        const title = confirmed || !addedBy ? runner.name : t.event.addedBy(addedBy.name);
        return (
          <li
            key={participation.id}
            title={title}
            className={`inline-flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${
              confirmed
                ? "border-neutral-900 bg-neutral-900 text-white"
                : "border-dashed border-neutral-500 bg-white text-neutral-700"
            }`}
          >
            <Avatar runner={runner} thumb="96x96" className="size-full" />
            <span className="sr-only">{runner.name}</span>
            {!confirmed && <span className="sr-only">{t.event.unconfirmed}</span>}
          </li>
        );
      })}
    </ul>
  );
}
