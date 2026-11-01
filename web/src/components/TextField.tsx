import { useId } from "react";

import { INPUT } from "./Field";

/**
 * A labelled input. Its hint and its error are linked to it with
 * `aria-describedby`, so that a screen reader reads them with the field.
 * The error is announced when it appears.
 *
 * The field is uncontrolled: a form that keeps what was typed after a refusal
 * hands it back as `defaultValue` (React empties a form once its action is over).
 */
export function TextField({
  label,
  name,
  type = "text",
  inputMode,
  autoComplete,
  defaultValue,
  hint,
  error,
}: {
  label: string;
  name: string;
  type?: "text" | "email" | "password";
  inputMode?: "email";
  autoComplete: string;
  defaultValue: string;
  hint?: string;
  error: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((described) => described !== null)
    .join(" ");

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-neutral-800">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required
        defaultValue={defaultValue}
        aria-invalid={error !== null}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        className={`${INPUT} font-normal`}
      />
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
