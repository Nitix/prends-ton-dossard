import { useRef, useState } from "react";

import { LoadFailure } from "../../components/LoadFailure";
import { useI18n } from "../../i18n/I18nProvider";
import type { Reminder } from "../../lib/types";
import { describeError } from "../profile/forms";
import { Section } from "../profile/Section";
import { PushSection } from "../push/PushSection";
import { useReminders, useSaveReminders } from "./api";

/** What the four radio buttons say: the reminders that are chosen, as one value. */
type Choice = "none" | "day" | "hour" | "both";

const CHOICES: readonly Choice[] = ["day", "hour", "both", "none"];

const REMINDERS_OF: Readonly<Record<Choice, Reminder[]>> = {
  none: [],
  day: ["day"],
  hour: ["hour"],
  both: ["day", "hour"],
};

function choiceOf(reminders: readonly Reminder[]): Choice {
  const day = reminders.includes("day");
  const hour = reminders.includes("hour");
  if (day && hour) return "both";
  if (day) return "day";
  return hour ? "hour" : "none";
}

/**
 * "Rappels" on the settings page: when to be warned before the registrations of
 * a race open, 1 day before, 1 hour before, both or never. The choice is saved as
 * soon as it changes (as the theme is), with a polite line that says so; a
 * refusal puts the old choice back and says why, in an alert. The section is
 * absent when the server has no reminders (the demo).
 *
 * The choice that was made shows at once, before the server answers. If two
 * changes are made one after the other, the section shows the last one, and the
 * answer of an earlier one does not take its place.
 */
export function RemindersSection() {
  const { t } = useI18n();
  const reminders = useReminders();
  const save = useSaveReminders();
  const heading = useRef<HTMLHeadingElement>(null);
  // The choice that was made and the server has not answered yet.
  const [pending, setPending] = useState<Choice | null>(null);
  const [saved, setSaved] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  // The last choice that was made: an earlier request that ends after it says nothing.
  const latest = useRef(0);

  // The server has no reminders: nothing to show, and nothing to say about them.
  if (reminders.data === null) return null;

  const current = reminders.data === undefined ? null : choiceOf(reminders.data);
  const shown = pending ?? current;
  const unreadable = reminders.isError && reminders.data === undefined;

  async function choose(choice: Choice) {
    const attempt = ++latest.current;
    setPending(choice);
    setSaved(false);
    setFailure(null);
    try {
      await save.mutateAsync(REMINDERS_OF[choice]);
      if (attempt === latest.current) setSaved(true);
    } catch (err) {
      if (attempt === latest.current) setFailure(describeError(t, err));
    }
    // Saved, the cache has the choice; refused, the old one is back.
    if (attempt === latest.current) setPending(null);
  }

  const labels: Record<Choice, string> = {
    none: t.reminders.none,
    day: t.reminders.day,
    hour: t.reminders.hour,
    both: t.reminders.both,
  };

  return (
    <Section title={t.reminders.title} headingRef={heading}>
      <p className="text-sm text-neutral-600">{t.reminders.intro}</p>
      {unreadable && <LoadFailure heading={heading} onRetry={() => reminders.refetch()} />}
      {shown !== null && (
        <fieldset className="flex flex-col gap-2">
          <legend className="eyebrow mb-2">{t.reminders.legend}</legend>
          {CHOICES.map((value) => (
            <label
              key={value}
              className="mode-choice group relative flex min-h-12 cursor-pointer items-center gap-3 rounded-2xl border-2 border-neutral-200 bg-card px-3.5 py-2 hover:border-iris-200 hover:bg-iris-50 has-checked:border-iris-600 has-checked:bg-iris-50 has-checked:font-semibold has-checked:text-iris-800"
            >
              <input
                type="radio"
                name="reminders"
                value={value}
                checked={shown === value}
                onChange={() => {
                  void choose(value);
                }}
                className="absolute -inset-0.5 m-0 cursor-pointer appearance-none rounded-2xl"
              />
              <span
                aria-hidden="true"
                className="flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-neutral-500 group-has-checked:border-iris-600"
              >
                <span
                  data-dot
                  className="size-2.5 scale-0 rounded-full bg-iris-600 transition-transform group-has-checked:scale-100 forced-colors:bg-[CanvasText]"
                />
              </span>
              {labels[value]}
            </label>
          ))}
        </fieldset>
      )}
      {/* The status line stays in the page, empty, so that a screen reader hears what it comes to say. */}
      <output className="text-sm font-medium text-neutral-700">
        {saved ? t.reminders.saved : ""}
      </output>
      {failure !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {failure}
        </p>
      )}
      <p className="text-sm text-neutral-600">{t.reminders.noTime}</p>
      <h3 className="eyebrow">{t.reminders.whereTitle}</h3>
      <p className="text-sm text-neutral-600">{t.reminders.where}</p>
      <PushSection headingRef={heading} />
    </Section>
  );
}
