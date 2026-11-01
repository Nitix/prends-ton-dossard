import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { startTransition, useActionState, useRef, useState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Field, INPUT } from "../../components/Field";
import { useToast } from "../../components/Toast";
import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import type { RaceTypeRecord } from "../../lib/types";
import { useSession } from "../auth/session";
import { SelectField, StatusField } from "../participations/fields";
import { canDeleteEvent, type Me } from "../participations/permissions";
import { invalidateEvents, useEvent, useRaceTypes, type EventView } from "./api";
import { DuplicateHint } from "./DuplicateHint";
import { FormatFieldset } from "./FormatFieldset";
import { formatDisplayName } from "./formatName";
import {
  emptyRow,
  hasMeasure,
  initialDraft,
  joinRowOf,
  toEventDraft,
  type FormatRow,
} from "./formDraft";
import { saveEvent, SaveEventError } from "./saveEvent";

/**
 * What the last attempt to save was refused for, as codes of the server (or
 * of the form, for the one check it makes itself). Each is shown where the user
 * can fix it: under its field, in its format, or above the button.
 */
type Errors = {
  /** The fields of the event, by the name the server gives them. */
  event: Readonly<Record<string, string>>;
  /** The fields of each format, by the key of its row. `row` stands for the format as a whole. */
  rows: Readonly<Record<string, Readonly<Record<string, string>>>>;
  /** What is not about a field of the form. */
  form: string | null;
};

const NO_ERRORS: Errors = { event: {}, rows: {}, form: null };

const EVENT_FIELDS: readonly string[] = [
  "name",
  "location",
  "start_date",
  "end_date",
  "registration_url",
  "registration_deadline",
  "notes",
];
const FORMAT_FIELDS: readonly string[] = [
  "name",
  "race_type",
  "distance_km",
  "duration_min",
  "time_limit_min",
  "elevation_gain_m",
  "price_eur",
  "date",
];

function only(
  fields: Readonly<Record<string, string>>,
  names: readonly string[],
): Record<string, string> {
  return Object.fromEntries(Object.entries(fields).filter(([field]) => names.includes(field)));
}

/** Where to show what the server refused: the field of the event or of the format it is about, else the form. */
function refusal(err: unknown, rows: FormatRow[]): Errors {
  if (!(err instanceof SaveEventError)) {
    const code = errorCode(err) ?? Object.values(fieldErrors(err))[0];
    return { ...NO_ERRORS, form: code ?? "generic" };
  }
  const { target, fields, code } = err;
  if (target.kind === "event") {
    const known = only(fields, EVENT_FIELDS);
    if (Object.keys(known).length > 0) return { ...NO_ERRORS, event: known };
  }
  if (target.kind === "format") {
    const row = rows[target.index];
    if (row) {
      const known = only(fields, FORMAT_FIELDS);
      const shown = Object.keys(known).length > 0 ? known : { row: code ?? "generic" };
      return { ...NO_ERRORS, rows: { [row.key]: shown } };
    }
  }
  return { ...NO_ERRORS, form: code ?? "generic" };
}

/**
 * The form that creates an event, or edits `existing`, with its formats. The
 * app shell around it owns the page's `<main>`.
 */
export function EventForm({ existing }: { existing?: EventView }) {
  const { t } = useI18n();
  const raceTypes = useRaceTypes();

  if (raceTypes.data) return <EventFields existing={existing} raceTypes={raceTypes.data} />;
  if (raceTypes.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.errors.generic}
        </p>
        <button
          type="button"
          onClick={() => void raceTypes.refetch()}
          disabled={raceTypes.isFetching}
          className={`${SECONDARY} self-start`}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }
  return <output>{t.common.loading}</output>;
}

/** The page that edits the event `id`: it waits for the event, then gives it to the form. */
export function EditEventPage({ id }: { id: string }) {
  const { t } = useI18n();
  const query = useEvent(id);

  // The key starts the form over for another event.
  if (query.data) return <EventForm key={id} existing={query.data} />;
  if (query.isError) {
    const gone = query.error instanceof ClientResponseError && query.error.status === 404;
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {gone ? t.errors.not_found : t.errors.generic}
        </p>
        {!gone && (
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        )}
      </div>
    );
  }
  return <output>{t.common.loading}</output>;
}

function EventFields({
  existing,
  raceTypes,
}: {
  existing: EventView | undefined;
  raceTypes: RaceTypeRecord[];
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user, runner, isAdmin } = useSession();
  const me: Me | null = user && runner ? { userId: user.id, runnerId: runner.id, isAdmin } : null;

  // The event as it was when the form opened. The formats the user takes off
  // are told from it: a refresh that brings a format somebody else has just
  // added must not make it look as if this form had removed it.
  const [initial] = useState(existing);
  // Everything the user types lives here, not in the page: it is still there
  // after the server refuses the form, whatever React does to the form itself.
  const [draft, setDraft] = useState(() => initialDraft(initial));
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const formatsTitle = useRef<HTMLHeadingElement>(null);

  // "I'm taking part" is for a new event, and needs the runner of the member.
  const joinOffered = initial === undefined && runner !== null;
  const joinRow = joinRowOf(draft);

  function change(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function changeRow(key: string, patch: Partial<FormatRow>) {
    setDraft((current) => ({
      ...current,
      rows: current.rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    }));
  }

  function addRow() {
    const row = emptyRow(draft.rows.at(-1)?.raceType);
    setDraft((current) => ({ ...current, rows: [...current.rows, row] }));
    setJustAdded(row.key);
  }

  function removeRow(key: string) {
    setDraft((current) => ({ ...current, rows: current.rows.filter((row) => row.key !== key) }));
    // The button that was pressed goes away with its row: the focus goes to the title of the formats.
    formatsTitle.current?.focus();
  }

  /**
   * The « Retirer » button of a row, or none. A format that exists already may
   * only be deleted by the author of the event and by an admin; a new one has
   * not been saved yet, so anybody may take it off.
   */
  function removalOf(row: FormatRow) {
    const saved = initial?.formats.find(({ format }) => format.id === row.id);
    if (row.id !== undefined && !(initial && me && canDeleteEvent(initial.event, me))) return null;
    return {
      disabled: draft.rows.length === 1,
      participants: saved?.participations.length ?? 0,
      onRemove: () => {
        removeRow(row.key);
      },
    };
  }

  const [errors, submit, pending] = useActionState(async (): Promise<Errors> => {
    // The server has the last word, but there is no point in asking it about a
    // format that has no measure at all.
    const unmeasured = draft.rows.filter((row) => !hasMeasure(row));
    if (unmeasured.length > 0) {
      const rows = Object.fromEntries(
        unmeasured.map((row) => [row.key, { distance_km: "format_measure_required" }]),
      );
      return { ...NO_ERRORS, rows };
    }

    let id: string;
    try {
      const join = joinOffered && draft.join;
      id = await saveEvent(toEventDraft(draft, initial, join), initial, runner?.id);
    } catch (err) {
      return refusal(err, draft.rows);
    }
    await invalidateEvents(queryClient, id);
    toast.show(t.form.saved);
    await navigate({ to: "/evenements/$id", params: { id } });
    return NO_ERRORS;
  }, NO_ERRORS);

  const eventError = (field: string): string | null => {
    const code = errors.event[field];
    return code === undefined ? null : translateError(t, code);
  };

  /** What the choice of the format to join says of a row: its place, and what it is when it has begun to be filled in. */
  function rowLabel(row: FormatRow, number: number): string {
    const raceType = raceTypes.find(({ id }) => id === row.raceType);
    if (!raceType) return t.form.formatTitle(number);
    const name = formatDisplayName(
      {
        name: row.name,
        distance_km: Number(row.distanceKm) || undefined,
        duration_min: row.duration,
        time_limit_min: row.timeLimit,
      },
      raceType.label,
      f,
      t,
    );
    return `${t.form.formatTitle(number)} · ${name}`;
  }

  return (
    <form
      onSubmit={(event) => {
        // Not `action={submit}`: React empties a form once its action is over, and puts back the
        // default of a controlled select, which is not the choice of the user.
        event.preventDefault();
        startTransition(() => {
          submit();
        });
      }}
      className="flex flex-col gap-6"
    >
      <h1 className="text-2xl font-semibold">{initial ? t.form.editTitle : t.form.createTitle}</h1>

      <div className="flex flex-col gap-4">
        <Field label={t.form.name} error={eventError("name")}>
          {(control) => (
            <input
              {...control}
              name="name"
              type="text"
              required
              maxLength={120}
              autoComplete="off"
              value={draft.name}
              onChange={(event) => {
                change({ name: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.form.location} hint={t.form.locationHint} error={eventError("location")}>
          {(control) => (
            <input
              {...control}
              name="location"
              type="text"
              required
              autoComplete="off"
              value={draft.location}
              onChange={(event) => {
                change({ location: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.form.startDate} error={eventError("start_date")}>
          {(control) => (
            <input
              {...control}
              name="start_date"
              type="date"
              required
              value={draft.startDate}
              onChange={(event) => {
                change({ startDate: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.form.endDate} hint={t.form.endDateHint} error={eventError("end_date")}>
          {(control) => (
            <input
              {...control}
              name="end_date"
              type="date"
              value={draft.endDate}
              onChange={(event) => {
                change({ endDate: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <DuplicateHint
          name={draft.name}
          startDate={draft.startDate}
          excludeId={initial?.event.id}
        />
        <Field
          label={t.form.registrationUrl}
          hint={t.form.registrationUrlHint}
          error={eventError("registration_url")}
        >
          {(control) => (
            <input
              {...control}
              name="registration_url"
              type="url"
              inputMode="url"
              autoComplete="off"
              value={draft.registrationUrl}
              onChange={(event) => {
                change({ registrationUrl: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.form.registrationDeadline} error={eventError("registration_deadline")}>
          {(control) => (
            <input
              {...control}
              name="registration_deadline"
              type="date"
              value={draft.registrationDeadline}
              onChange={(event) => {
                change({ registrationDeadline: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field label={t.form.notes} error={eventError("notes")}>
          {(control) => (
            <textarea
              {...control}
              name="notes"
              rows={3}
              value={draft.notes}
              onChange={(event) => {
                change({ notes: event.target.value });
              }}
              className={`${INPUT} py-2`}
            />
          )}
        </Field>
      </div>

      <section aria-labelledby="formats-title" className="flex flex-col gap-4">
        <h2 ref={formatsTitle} id="formats-title" tabIndex={-1} className="text-xl font-semibold">
          {t.form.formatsTitle}
        </h2>
        {draft.rows.map((row, index) => (
          <FormatFieldset
            key={row.key}
            number={index + 1}
            row={row}
            raceTypes={raceTypes}
            errors={errors.rows[row.key] ?? {}}
            onChange={(patch) => {
              changeRow(row.key, patch);
            }}
            removal={removalOf(row)}
            focusFirst={row.key === justAdded}
          />
        ))}
        <button type="button" onClick={addRow} className={`${SECONDARY} self-start`}>
          {t.form.addFormat}
        </button>
      </section>

      {joinOffered && (
        <section className="flex flex-col gap-3">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.join}
              onChange={(event) => {
                change({ join: event.target.checked });
              }}
              className="size-6"
            />
            <span className="font-medium">{t.form.join}</span>
          </label>
          {draft.join && (
            <>
              <SelectField
                label={t.participation.format}
                value={joinRow?.key ?? ""}
                onChange={(joinRowKey) => {
                  change({ joinRow: joinRowKey });
                }}
                required
              >
                {draft.rows.map((row, index) => (
                  <option key={row.key} value={row.key}>
                    {rowLabel(row, index + 1)}
                  </option>
                ))}
              </SelectField>
              <StatusField
                value={draft.joinStatus}
                onChange={(joinStatus) => {
                  change({ joinStatus });
                }}
              />
            </>
          )}
        </section>
      )}

      {errors.form !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {translateError(t, errors.form)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t.auth.saving : t.common.save}
        </button>
        {initial ? (
          <Link
            to="/evenements/$id"
            params={{ id: initial.event.id }}
            className={`${SECONDARY} inline-flex items-center`}
          >
            {t.common.cancel}
          </Link>
        ) : (
          <Link to="/liste" className={`${SECONDARY} inline-flex items-center`}>
            {t.common.cancel}
          </Link>
        )}
      </div>
    </form>
  );
}
