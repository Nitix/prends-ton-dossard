import { useId } from "react";

import { SECONDARY } from "../../components/buttons";
import { DurationInput } from "../../components/DurationInput";
import { Field, INPUT } from "../../components/Field";
import { translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import type { RaceTypeRecord } from "../../lib/types";
import type { FormatRow } from "./formDraft";

/** Puts the focus on an element when it appears: the first field of a row that has just been added. */
function focusOnMount(element: HTMLElement | null) {
  element?.focus();
}

/**
 * The fields of one format, in a group named after it ("Épreuve 1"). `errors`
 * has the code of the server, or of the form, for each field, by the name the
 * server gives it; `row` is a refusal that is about the format as a whole.
 */
export function FormatFieldset({
  number,
  row,
  raceTypes,
  errors,
  onChange,
  removal,
  focusFirst,
}: {
  /** The place of the format in the form, from 1. */
  number: number;
  row: FormatRow;
  raceTypes: RaceTypeRecord[];
  errors: Readonly<Record<string, string>>;
  onChange: (patch: Partial<FormatRow>) => void;
  /**
   * The « Retirer » button, which is left out when the user may not take the
   * format off: `disabled` is for the only format left, and `participants`
   * is how many runners are on a format that exists already, which the server
   * deletes with it.
   */
  removal: { disabled: boolean; participants: number; onRemove: () => void } | null;
  focusFirst: boolean;
}) {
  const { t } = useI18n();
  const measuresId = useId();
  const warningId = useId();

  const message = (field: string): string | null => {
    const code = errors[field];
    return code === undefined ? null : translateError(t, code);
  };

  // One message for the three measures: a format needs one of them, not each.
  const measureError =
    message("distance_km") ?? message("duration_min") ?? message("time_limit_min");
  const measuresHintId = `${measuresId}-hint`;
  const measuresErrorId = `${measuresId}-error`;
  const measuresDescribedBy =
    measureError === null ? measuresHintId : `${measuresHintId} ${measuresErrorId}`;
  const rowError = message("row");

  return (
    <fieldset className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-3">
      <legend className="px-1 text-lg font-semibold">{t.form.formatTitle(number)}</legend>
      {rowError !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {rowError}
        </p>
      )}

      <Field label={t.form.formatName} hint={t.form.formatNameHint} error={message("name")}>
        {(control) => (
          <input
            {...control}
            ref={focusFirst ? focusOnMount : undefined}
            type="text"
            autoComplete="off"
            value={row.name}
            onChange={(event) => {
              onChange({ name: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>

      <Field label={t.form.raceType} error={message("race_type")}>
        {(control) => (
          <select
            {...control}
            required
            value={row.raceType}
            onChange={(event) => {
              onChange({ raceType: event.target.value });
            }}
            className={INPUT}
          >
            <option value="" disabled>
              {t.form.chooseRaceType}
            </option>
            {raceTypes.map((raceType) => (
              <option key={raceType.id} value={raceType.id}>
                {raceType.label}
              </option>
            ))}
          </select>
        )}
      </Field>

      <div className="flex flex-col gap-3">
        <p id={measuresHintId} className="text-sm text-neutral-600">
          {t.form.measuresHint}
        </p>
        <Field label={t.form.distance} error={null}>
          {(control) => (
            <input
              {...control}
              aria-describedby={measuresDescribedBy}
              aria-invalid={measureError !== null}
              type="number"
              inputMode="decimal"
              min={0}
              step="any"
              value={row.distanceKm}
              onChange={(event) => {
                onChange({ distanceKm: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <DurationInput
          name={`format-${row.key}-duration`}
          label={t.form.duration}
          value={row.duration}
          onChange={(duration) => {
            onChange({ duration });
          }}
          describedBy={measuresDescribedBy}
          invalid={measureError !== null}
        />
        <DurationInput
          name={`format-${row.key}-time-limit`}
          label={t.form.timeLimit}
          value={row.timeLimit}
          onChange={(timeLimit) => {
            onChange({ timeLimit });
          }}
          describedBy={measuresDescribedBy}
          invalid={measureError !== null}
        />
        {measureError !== null && (
          <p id={measuresErrorId} role="alert" className="text-sm font-medium text-red-700">
            {measureError}
          </p>
        )}
      </div>

      <Field label={t.form.elevation} error={message("elevation_gain_m")}>
        {(control) => (
          <input
            {...control}
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            value={row.elevation}
            onChange={(event) => {
              onChange({ elevation: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>

      <Field label={t.format.price} error={message("price_eur")}>
        {(control) => (
          <input
            {...control}
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={row.price}
            onChange={(event) => {
              onChange({ price: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>

      <Field label={t.form.formatDate} hint={t.form.formatDateHint} error={message("date")}>
        {(control) => (
          <input
            {...control}
            type="date"
            value={row.date}
            onChange={(event) => {
              onChange({ date: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>

      {removal && (
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={removal.onRemove}
            disabled={removal.disabled}
            aria-describedby={removal.participants > 0 ? warningId : undefined}
            className={`${SECONDARY} self-start disabled:opacity-60`}
          >
            {t.common.remove}
          </button>
          {removal.participants > 0 && (
            <p id={warningId} className="text-sm text-neutral-700">
              {t.form.formatHasParticipants(removal.participants)}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}
