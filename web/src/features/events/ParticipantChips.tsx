import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationView } from "./api";

/** The first character of a word, which may take more than one UTF-16 unit. */
function firstLetter(word: string | undefined): string {
  return Array.from(word ?? "")[0] ?? "";
}

/** "AM" for "Alice Martin", "B" for "Bob": the first letter of the first and of the last word. */
function initials(name: string): string {
  const words = name.split(/\s+/).filter((word) => word !== "");
  const last = words.length > 1 ? firstLetter(words.at(-1)) : "";
  return (firstLetter(words[0]) + last).toLocaleUpperCase();
}

/**
 * The runners of a format, as round chips with their initials.
 *
 * A participation the runner has not confirmed is dashed, and it says so in
 * words too: a text for screen readers, and a tooltip that tells who added it.
 * A chip never relies on its colour alone. The full name is in the text for
 * screen readers (the initials are hidden from them) and in the tooltip of a
 * confirmed chip.
 */
export function ParticipantChips({ participations }: { participations: ParticipationView[] }) {
  const { t } = useI18n();

  if (participations.length === 0) return null;
  return (
    <ul aria-label={t.event.participants} className="flex flex-wrap gap-1">
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
            <span aria-hidden="true">{initials(runner.name)}</span>
            <span className="sr-only">{runner.name}</span>
            {!confirmed && <span className="sr-only">{t.event.unconfirmed}</span>}
          </li>
        );
      })}
    </ul>
  );
}
