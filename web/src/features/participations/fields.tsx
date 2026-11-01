import { useId, type ReactNode } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import type { EventView, FormatView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { UNDECIDED } from "../events/participants";
import { STATUSES } from "./api";

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
  value,
  onChange,
}: {
  view: EventView;
  /** The ones to offer: some of `view.formats`. */
  formats: FormatView[];
  /** Adds « Pas encore décidé » (value `UNDECIDED`), last. */
  undecided?: boolean;
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
    </SelectField>
  );
}

function isStatus(value: string): value is Status {
  return STATUSES.some((status) => status === value);
}

/**
 * The status of a participation. With no format chosen (`locked`) it can only
 * be « Intéressé »: the field says so, and tells why under it.
 */
export function StatusField({
  value,
  onChange,
  locked = false,
}: {
  value: Status;
  onChange: (status: Status) => void;
  /** No format chosen: disabled on « Intéressé », with `t.participation.undecidedHint` under it. */
  locked?: boolean;
}) {
  const { t } = useI18n();

  return (
    <SelectField
      label={t.participation.status}
      value={locked ? "interested" : value}
      disabled={locked}
      hint={locked ? t.participation.undecidedHint : undefined}
      onChange={(next) => {
        if (isStatus(next)) onChange(next);
      }}
    >
      {STATUSES.map((status) => (
        <option key={status} value={status}>
          {t.status[status]}
        </option>
      ))}
    </SelectField>
  );
}
