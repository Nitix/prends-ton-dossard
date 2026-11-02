import { useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { INPUT } from "./Field";

const SECONDS_PER_MINUTE = 60;
const SECONDS_PER_HOUR = 3600;

/** What the three fields hold, as typed. */
type Typed = { hours: string; minutes: string; seconds: string };

/** The text of a part of a time: nothing when it is zero, as a form is left empty. */
function textOf(part: number): string {
  return part > 0 ? String(part) : "";
}

function typedFrom(total: number | undefined): Typed {
  if (total === undefined || !(total > 0)) return { hours: "", minutes: "", seconds: "" };
  return {
    hours: textOf(Math.floor(total / SECONDS_PER_HOUR)),
    minutes: textOf(Math.floor((total % SECONDS_PER_HOUR) / SECONDS_PER_MINUTE)),
    seconds: textOf(total % SECONDS_PER_MINUTE),
  };
}

/** A number typed in a field, or undefined when it is empty. */
function numberOf(text: string): number | undefined {
  return text === "" ? undefined : Number(text);
}

/**
 * The total of seconds of what was typed. A part that is left empty counts for
 * nothing, and nothing at all, zero or less is no time: `undefined`. The result
 * is a whole number, which is what the server stores.
 */
function totalOf({ hours, minutes, seconds }: Typed): number | undefined {
  const total = Math.round(
    (numberOf(hours) ?? 0) * SECONDS_PER_HOUR +
      (numberOf(minutes) ?? 0) * SECONDS_PER_MINUTE +
      (numberOf(seconds) ?? 0),
  );
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

/** The parts of a time, in the order they are typed. */
const PARTS = ["hours", "minutes", "seconds"] as const;

/**
 * A time typed in hours, minutes and seconds (4 h 12 min 30 s for a finish),
 * held as a total of seconds. `value` is that total and `onChange` gives the
 * new one, `undefined` when the three fields are empty or zero: like any
 * controlled input, the parent keeps what `onChange` says and gives it back.
 *
 * It works like `DurationInput`: what is typed is not rewritten as long as it
 * makes `value` ("90" minutes stay as they are, though they are an hour and a
 * half), and the fields only change to show a `value` that does not come from
 * them (a form that starts over). `describedBy` links them to a hint or an
 * error, and `invalid` says that the server refused the time.
 */
export function TimeInput({
  name,
  label,
  value,
  onChange,
  describedBy,
  invalid = false,
}: {
  name: string;
  label: string;
  value?: number;
  onChange: (value: number | undefined) => void;
  describedBy?: string;
  invalid?: boolean;
}) {
  const { t } = useI18n();
  const [typed, setTyped] = useState(() => typedFrom(value));

  // A value that the fields do not make comes from the parent: show it. It is
  // compared as a total is made (whole, and nothing when it is zero or less),
  // so that a value that could never be the total of three fields does not
  // make this start over for ever.
  const wanted = Math.round(value ?? 0);
  if (totalOf(typed) !== (wanted > 0 ? wanted : undefined)) setTyped(typedFrom(value));

  function change(part: keyof Typed, text: string) {
    const next = { ...typed, [part]: text };
    setTyped(next);
    onChange(totalOf(next));
  }

  const names = {
    hours: t.results.hoursName,
    minutes: t.results.minutesName,
    seconds: t.results.secondsName,
  };

  return (
    <fieldset className="field flex flex-col gap-1">
      <legend className="field-label text-sm font-medium">{label}</legend>
      {/* A field with its unit stay together when the line is too short for the three. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {PARTS.map((part) => (
          <span key={part} className="flex items-center gap-1">
            <input
              name={`${name}-${part}`}
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={typed[part]}
              onChange={(event) => {
                change(part, event.target.value);
              }}
              aria-label={`${label}, ${names[part]}`}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              className={`${INPUT} w-[4.5rem]`}
            />
            <span aria-hidden="true">{t.results[part]}</span>
          </span>
        ))}
      </div>
    </fieldset>
  );
}
