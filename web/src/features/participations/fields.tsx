import { useId, type ReactNode } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import type { EventView, FormatView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { STATUSES } from "./api";

/** A labelled native select: the browser gives the picker, the keyboard and the screen reader support. */
export function SelectField({
  label,
  value,
  onChange,
  required = false,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <select
        id={id}
        value={value}
        required={required}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className="min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base"
      >
        {children}
      </select>
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
  value,
  onChange,
}: {
  view: EventView;
  /** The ones to offer: some of `view.formats`. */
  formats: FormatView[];
  value: string;
  onChange: (formatId: string) => void;
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
    </SelectField>
  );
}

function isStatus(value: string): value is Status {
  return STATUSES.some((status) => status === value);
}

export function StatusField({
  value,
  onChange,
}: {
  value: Status;
  onChange: (status: Status) => void;
}) {
  const { t } = useI18n();

  return (
    <SelectField
      label={t.participation.status}
      value={value}
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
