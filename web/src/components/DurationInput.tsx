import { useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { fromMinutes, toMinutes } from "../lib/minutes";
import { INPUT } from "./Field";

/** What the two fields hold, as typed. */
type Typed = { hours: string; minutes: string };

function typedFrom(total: number | undefined): Typed {
  const { hours, minutes } = fromMinutes(total);
  return {
    hours: hours === undefined ? "" : String(hours),
    minutes: minutes === undefined ? "" : String(minutes),
  };
}

/** A number typed in a field, or undefined when it is empty. */
function numberOf(text: string): number | undefined {
  return text === "" ? undefined : Number(text);
}

function totalOf({ hours, minutes }: Typed): number | undefined {
  return toMinutes(numberOf(hours), numberOf(minutes));
}

/**
 * A duration typed in hours and minutes (46 h 30 for a cut-off), held as a
 * total of minutes. `value` is that total and `onChange` gives the new one,
 * `undefined` when both fields are empty or zero: like any controlled input,
 * the parent keeps what `onChange` says and gives it back.
 *
 * What is typed is not rewritten as long as it makes `value`: "0" and "90"
 * stay as they are, even though 90 minutes are an hour and a half. The fields
 * only change to show a `value` that does not come from them (a form that
 * starts over). `describedBy` links them to a hint or an error.
 */
export function DurationInput({
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
  // so that a value that could never be the total of two fields does not make
  // this start over for ever.
  if (totalOf(typed) !== toMinutes(undefined, value)) setTyped(typedFrom(value));

  function change(part: keyof Typed, text: string) {
    const next = { ...typed, [part]: text };
    setTyped(next);
    onChange(totalOf(next));
  }

  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="text-sm font-medium">{label}</legend>
      <div className="flex items-center gap-2">
        <input
          name={`${name}-hours`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={typed.hours}
          onChange={(event) => {
            change("hours", event.target.value);
          }}
          aria-label={`${label}, ${t.form.hours}`}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={`${INPUT} w-20`}
        />
        <span aria-hidden="true">{t.form.hoursUnit}</span>
        <input
          name={`${name}-minutes`}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          value={typed.minutes}
          onChange={(event) => {
            change("minutes", event.target.value);
          }}
          aria-label={`${label}, ${t.form.minutes}`}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          className={`${INPUT} w-20`}
        />
        <span aria-hidden="true">{t.form.minutesUnit}</span>
      </div>
    </fieldset>
  );
}
