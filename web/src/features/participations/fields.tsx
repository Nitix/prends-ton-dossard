import { useId, type ReactNode } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import type { EventView, FormatView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { SUPPORT, UNDECIDED } from "../events/participants";
import { EVENT_STATUSES, STATUSES, statusChoices } from "./api";

/**
 * A labelled native select: the browser gives the picker, the keyboard and the
 * screen reader support. A `hint` is read with the field, and shown under it.
 */
export function SelectField({
  label,
  value,
  onChange,
  required = false,
  disabled = false,
  hint,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  disabled?: boolean;
  hint?: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        required={required}
        disabled={disabled}
        aria-describedby={hint === undefined ? undefined : hintId}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base"
      >
        {children}
      </select>
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-neutral-600">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * The formats of an event to choose from: their name, and their day when the
 * event lasts more than one, since two formats may be alike on different days.
 */
export function FormatField({
  view,
  formats,
  undecided = false,
  support,
  value,
  onChange,
}: {
  view: EventView;
  /** The ones to offer: some of `view.formats`. */
  formats: FormatView[];
  /** Adds « Pas encore décidé » (value `UNDECIDED`), after the formats. */
  undecided?: boolean;
  /** Adds the choice of a supporter (value `SUPPORT`), last, with this label: without it, there is no such choice. */
  support?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t, f } = useI18n();
  const severalDays = !view.start.equals(view.end);

  return (
    <SelectField label={t.participation.format} value={value} onChange={onChange} required>
      {formats.map(({ format, raceType, date }) => {
        const name = formatDisplayName(format, raceType.label, f, t);
        return (
          <option key={format.id} value={format.id}>
            {severalDays ? `${name} · ${f.date(date)}` : name}
          </option>
        );
      })}
      {undecided && <option value={UNDECIDED}>{t.participation.undecided}</option>}
      {support !== undefined && <option value={SUPPORT}>{support}</option>}
    </SelectField>
  );
}

function isStatus(value: string): value is Status {
  return STATUSES.some((status) => status === value);
}

/** What a locked status field shows, and the sentence under it that says why. */
const LOCKS = {
  undecided: { status: "interested", hint: "undecidedHint" },
  support: { status: "supporter", hint: "supportHint" },
} as const;

/**
 * What a choice of the format field stands for when it is not a format
 * ("Not decided yet", "I'm coming to cheer"): the participation is on the
 * event alone, with a status that is not a choice. `lock` is for the
 * `StatusField`, `status` is what the participation is created with. Nothing
 * for a format.
 */
export function noFormatChoice(
  choice: string,
): { lock: keyof typeof LOCKS; status: Status } | undefined {
  if (choice === UNDECIDED) return { lock: "undecided", status: LOCKS.undecided.status };
  if (choice === SUPPORT) return { lock: "support", status: LOCKS.support.status };
  return undefined;
}

/**
 * The status of a participation. With no format chosen (`locked`) it is not
 * a choice: « Intéressé » when the format is to be decided (`"undecided"`),
 * « Supporteur » for somebody who comes to cheer (`"support"`). The field is
 * disabled on that status, and tells why under it.
 *
 * On a format, « Terminé » and « Abandon » are only offered once its race has
 * started (`started`, see `raceStarted`): nobody has finished a race that has
 * not happened. The current `value` stays in the list all the same; a form
 * that lets the format change under it gives `allowedStatus` back as the value.
 */
export function StatusField({
  value,
  onChange,
  started,
  locked,
}: {
  value: Status;
  onChange: (status: Status) => void;
  /** The race of the chosen format has started: its day is today or past. Not read when `locked`. */
  started: boolean;
  /**
   * No format chosen: disabled on « Intéressé » (`"undecided"`, with
   * `t.participation.undecidedHint` under it) or on « Supporteur »
   * (`"support"`, with `t.participation.supportHint`).
   */
  locked?: keyof typeof LOCKS;
}) {
  const { t } = useI18n();
  const lock = locked && LOCKS[locked];

  return (
    <SelectField
      label={t.participation.status}
      value={lock ? lock.status : value}
      disabled={lock !== undefined}
      hint={lock ? t.participation[lock.hint] : undefined}
      onChange={(next) => {
        if (isStatus(next)) onChange(next);
      }}
    >
      {(lock ? EVENT_STATUSES : statusChoices(started, value)).map((status) => (
        <option key={status} value={status}>
          {t.status[status]}
        </option>
      ))}
    </SelectField>
  );
}
