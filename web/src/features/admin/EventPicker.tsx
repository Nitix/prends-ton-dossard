import { useEffect, useId, useState } from "react";

import { SECONDARY } from "../../components/buttons";
import { Field, INPUT } from "../../components/Field";
import { useI18n } from "../../i18n/I18nProvider";
import { eventLabel } from "../events/eventLabel";
import { useEventSearch } from "./api";

/** How long the admin has to stop typing before the search starts. */
export const SEARCH_PAUSE_MS = 300;

/** What the admin chose: the id of the record, and the line that describes it. */
export type Choice = { id: string; label: string };

/** The value once the user has stopped changing it for a moment. It starts as it is: nobody is typing yet. */
function useSettled(value: string): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled(value);
    }, SEARCH_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [value]);
  return settled;
}

/** Puts the focus on an element when it appears: only used for what the user has just asked for. */
function focusOnMount(element: HTMLElement | null) {
  element?.focus();
}

/**
 * Chooses one event, by a part of its name. The events of the past are looked
 * for as much as those to come: a duplicate is often an event that is over.
 * Each is told from the others by its day and its place (see `eventLabel`).
 *
 * Once an event is chosen it is shown alone, with a button to change it.
 * `exclude` is an event that is not offered: the one already chosen for the
 * other place, since an event is not the duplicate of itself.
 *
 * The page is a region named `title`.
 */
export function EventPicker({
  title,
  value,
  onChange,
  exclude,
}: {
  title: string;
  value: Choice | null;
  onChange: (next: Choice | null) => void;
  exclude?: string;
}) {
  const { t } = useI18n();
  const titleId = useId();
  // The search field comes back when the choice is changed: that is where the focus goes.
  const [changing, setChanging] = useState(false);

  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-3 rounded-lg border border-neutral-300 p-3"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {title}
      </h2>
      {value === null ? (
        <Search exclude={exclude} focusSearch={changing} onPick={onChange} />
      ) : (
        <div className="flex items-start justify-between gap-3">
          <p className="min-w-0 font-medium break-words">{value.label}</p>
          <button
            type="button"
            ref={focusOnMount}
            onClick={() => {
              setChanging(true);
              onChange(null);
            }}
            className={`${SECONDARY} shrink-0`}
          >
            {t.admin.changeChoice}
          </button>
        </div>
      )}
    </section>
  );
}

function Search({
  exclude,
  focusSearch,
  onPick,
}: {
  exclude: string | undefined;
  focusSearch: boolean;
  onPick: (choice: Choice) => void;
}) {
  const { t, f } = useI18n();
  const [typed, setTyped] = useState("");
  // Spaces around the name are not part of it, and spaces alone are no name.
  const term = useSettled(typed).trim();
  const search = useEventSearch(term);
  const found = (search.data ?? []).filter((event) => event.id !== exclude);

  /** What goes under the field: nothing before a name is typed, then the events, or why there are none. */
  function results() {
    if (term === "") return null;
    if (search.isError && !search.data) {
      return (
        <div className="flex flex-col gap-2">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void search.refetch()}
            disabled={search.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      );
    }
    if (search.data === undefined)
      return <p className="text-sm text-neutral-600">{t.common.loading}</p>;
    if (found.length === 0) {
      // The events of the previous name stay while the next ones come: they say nothing about this one.
      return search.isPlaceholderData ? null : <p className="text-sm">{t.admin.noEventFound}</p>;
    }
    return (
      <ul className="flex flex-col gap-2">
        {found.map((event) => {
          const label = eventLabel(event, f, t);
          return (
            <li key={event.id}>
              <button
                type="button"
                onClick={() => {
                  onPick({ id: event.id, label });
                }}
                className="min-h-11 w-full rounded-lg border border-neutral-300 bg-white px-3 py-2 text-left break-words"
              >
                {label}
              </button>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label={t.admin.searchEvent} hint={t.admin.searchEventHint} error={null}>
        {(control) => (
          <input
            {...control}
            ref={focusSearch ? focusOnMount : undefined}
            type="search"
            autoComplete="off"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
            }}
            className={INPUT}
          />
        )}
      </Field>
      {/* The region is always there, empty: a screen reader announces what comes into it. */}
      <div aria-live="polite" className="flex flex-col gap-2">
        {results()}
      </div>
    </div>
  );
}
