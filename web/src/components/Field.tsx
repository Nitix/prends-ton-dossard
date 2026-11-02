import { useId, type ReactNode } from "react";

/**
 * The look of a text input, a select and a text area: at least 44 px tall, which
 * is a tap target. Its edge is what shows a field (3:1 at least on its ground, at
 * rest, under the pointer, with the focus and refused, by day and at night:
 * src/contrast.test.ts measures it).
 */
export const INPUT =
  "min-h-11 rounded-xl border border-neutral-500 bg-field px-3.5 text-base text-ink shadow-[inset_0_1px_2px_rgb(36_27_53/0.04)] transition-[border-color,box-shadow] hover:border-iris-400 focus:border-iris-500 focus:shadow-[0_0_0_4px_rgb(139_124_255/0.18)] aria-invalid:border-red-700";

/** The look of a field that shows a text to copy, read-only: its edge, on the soft ground of a panel. */
export const READ_ONLY_INPUT =
  "min-h-11 rounded-xl border border-neutral-500 bg-neutral-50 px-3.5 text-base text-neutral-800";

/** What the control of a field gets, to be linked to its label, its hint and its error. */
export type FieldControl = {
  id: string;
  "aria-describedby": string | undefined;
  "aria-invalid": boolean;
};

/**
 * A label, a control, and under it a hint and an error. The control is given
 * as a function, since each kind of control (an input, a select, a text area)
 * is its own element: it spreads what it receives on itself, which links it to
 * the label (`id`), to the hint and to the error (`aria-describedby`). The
 * error is announced when it appears. `describedBy` is the id of an element that
 * is not in the field and says something more about it, after the error.
 */
export function Field({
  label,
  hint,
  error,
  describedBy: elsewhereId,
  children,
}: {
  label: string;
  hint?: string;
  error: string | null;
  describedBy?: string;
  children: (control: FieldControl) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [
    hint === undefined ? null : hintId,
    error === null ? null : errorId,
    elsewhereId ?? null,
  ]
    .filter((described) => described !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-neutral-800">
        {label}
      </label>
      {children({
        id,
        "aria-describedby": describedBy === "" ? undefined : describedBy,
        "aria-invalid": error !== null,
      })}
      {hint !== undefined && (
        <p id={hintId} className="text-sm text-neutral-600">
          {hint}
        </p>
      )}
      {error !== null && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
