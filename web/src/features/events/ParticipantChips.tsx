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
 * The dashes are a step darker than those of a row: they run right around the
 * avatar, and keep 3:1 with a margin on the pastels of the dawn as well as on
 * the card (src/dashed.test.ts).
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
    <ul aria-label={label ?? t.event.participants} className="flex flex-wrap gap-y-1 pl-1.5">
      {participations.map(({ participation, runner, addedBy }) => {
        const confirmed = participation.confirmed;
        const title = confirmed || !addedBy ? runner.name : t.event.addedBy(addedBy.name);
        return (
          <li
            key={participation.id}
            title={title}
            className={`chip -ml-1.5 inline-flex size-9 items-center justify-center rounded-full text-xs font-bold shadow-[0_0_0_2.5px_var(--color-card)] ${
              confirmed
                ? "bg-dawn-deep text-white"
                : "border-2 border-dashed border-neutral-600 bg-card text-neutral-700"
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
