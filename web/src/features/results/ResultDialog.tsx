import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { Field, INPUT } from "../../components/Field";
import { TimeInput } from "../../components/TimeInput";
import { useToast } from "../../components/Toast";
import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationRecord } from "../../lib/types";
import { invalidateEvents } from "../events/api";
import { useUpdateParticipation, type ParticipationPatch } from "../participations/api";
import { isNotFound, participationError } from "../participations/errors";
import { SelectField } from "../participations/fields";

/** The two statuses a result goes with: the server keeps no time or rank on any other. */
type ResultStatus = "finished" | "dnf";

function isResultStatus(value: string): value is ResultStatus {
  return value === "finished" || value === "dnf";
}

/** The fields of the form that the server may refuse, by the name it gives them. */
const FIELDS = ["finish_time_s", "rank", "rank_of", "result_note"] as const;

type FieldName = (typeof FIELDS)[number];

/** What is typed in the form. The numbers of the rank are texts, as the inputs hold them. */
type Draft = {
  status: ResultStatus;
  /** In seconds; undefined while the three fields of the time are empty. */
  time: number | undefined;
  rank: string;
  rankOf: string;
  note: string;
};

/**
 * What the form starts from. The status is the one the caller asks for, else
 * the current one when it is « Finished » or « DNF », else « Finished »: the
 * result of a participation that is not over yet is a finish. The server sends
 * 0 for a number that is not given, which is an empty field.
 */
function initialDraft(
  participation: ParticipationRecord,
  initialStatus: ResultStatus | undefined,
): Draft {
  const { status, finish_time_s, rank, rank_of, result_note } = participation;
  return {
    status: initialStatus ?? (status === "finished" || status === "dnf" ? status : "finished"),
    time: finish_time_s || undefined,
    rank: rank ? String(rank) : "",
    rankOf: rank_of ? String(rank_of) : "",
    note: result_note ?? "",
  };
}

/**
 * What the form sends. A part that is empty is sent as 0, and an empty note as
 * an empty text, so that changing a result clears what has been emptied. A DNF
 * has no time and no rank: they are sent as 0, even if they were typed before
 * the status was changed.
 */
function toPatch({ status, time, rank, rankOf, note }: Draft): ParticipationPatch {
  const finished = status === "finished";
  return {
    status,
    finish_time_s: finished ? (time ?? 0) : 0,
    rank: finished && rank !== "" ? Number(rank) : 0,
    rank_of: finished && rankOf !== "" ? Number(rankOf) : 0,
    result_note: note.trim(),
  };
}

/**
 * What the last attempt to save was refused for, as codes of the server: the
 * ones of fields, which are shown under them, and the one that is not about a
 * field of the form (the status, a refusal of the participation as a whole, or
 * a failure), which is shown above the buttons. `attempt` makes each refusal a
 * new state, so that the focus goes to a field again.
 */
type Refusal = {
  fields: Readonly<Partial<Record<FieldName, string>>>;
  form: string | null;
  attempt: number;
};

const NO_REFUSAL: Refusal = { fields: {}, form: null, attempt: 0 };

function refusalOf(err: unknown, attempt: number): Refusal {
  const fields: Partial<Record<FieldName, string>> = {};
  let form: string | undefined;
  for (const [name, code] of Object.entries(fieldErrors(err))) {
    const field = FIELDS.find((known) => known === name);
    if (field === undefined) form ??= code;
    else fields[field] = code;
  }
  // No code at all (a network failure): the generic message, which `translateError` gives.
  const unexplained = Object.keys(fields).length === 0 && form === undefined;
  return { fields, form: form ?? (unexplained ? (errorCode(err) ?? "generic") : null), attempt };
}

/**
 * The window where the result of a participation on a format is entered, or
 * changed: « Finished » or « DNF », and for a finish its time, its rank and how
 * many were ranked; for both a note. It starts from the result the
 * participation has. `initialStatus` is the status to start from when the
 * caller knows which one the user means (« I finished », « DNF » on the home
 * page).
 *
 * It closes once the result is saved: the caller is told by `onSaved` in place
 * of `onClose` (which is then for the user who cancels), as it has more to do
 * when the participation moves to another list of its page, and so is it by
 * `onGone` when the participation is not there any more (removed, or given
 * another format, by somebody else), which is also said in a toast. While the
 * result is on its way, the button says it is busy and is not disabled: it
 * would lose the focus, and a refusal that is not about a field would not give
 * it back; a second tap is ignored.
 */
export function ResultDialog({
  open,
  onClose,
  onSaved,
  onGone,
  eventId,
  participation,
  initialStatus,
}: {
  open: boolean;
  onClose: () => void;
  /** The result is saved, and the lists are up to date. */
  onSaved?: () => void;
  /** The participation is gone, and the lists are asked for again. */
  onGone?: () => void;
  /** The event of the participation: its page is refreshed after the change. */
  eventId: string;
  participation: ParticipationRecord;
  initialStatus?: ResultStatus;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.results.title}>
      <ResultForm
        eventId={eventId}
        participation={participation}
        initialStatus={initialStatus}
        onClose={onClose}
        onSaved={onSaved}
        onGone={onGone}
      />
    </Dialog>
  );
}

function ResultForm({
  eventId,
  participation,
  initialStatus,
  onClose,
  onSaved,
  onGone,
}: {
  eventId: string;
  participation: ParticipationRecord;
  initialStatus: ResultStatus | undefined;
  onClose: () => void;
  onSaved: (() => void) | undefined;
  onGone: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateParticipation(eventId);
  const form = useRef<HTMLFormElement>(null);
  const id = useId();
  const timeErrorId = `${id}-time-error`;
  const rankErrorId = `${id}-rank-error`;
  // Everything the user types lives here: it is still there after the server refuses the form.
  const [draft, setDraft] = useState(() => initialDraft(participation, initialStatus));
  const [refusal, setRefusal] = useState(NO_REFUSAL);
  // Set on the spot: the state of a mutation is there after a render only, and two taps can come before it.
  const saving = useRef(false);

  function change(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  // The first field the server refused has the focus (the fields are in the page in the order of the form).
  useEffect(() => {
    if (refusal.attempt === 0) return;
    form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [refusal]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    try {
      await update.mutateAsync({ id: participation.id, patch: toPatch(draft) });
    } catch (err) {
      if (isNotFound(err)) {
        // The participation is gone: the dialog is about nothing. It says so in
        // a toast, which stays once the dialog is closed, and the lists are
        // asked for again before it closes, as after a success.
        toast.show(participationError(t, err));
        await invalidateEvents(queryClient, eventId);
        (onGone ?? onClose)();
        return;
      }
      saving.current = false;
      setRefusal((last) => refusalOf(err, last.attempt + 1));
      return;
    }
    (onSaved ?? onClose)();
  }

  const error = (field: FieldName): string | null => {
    const code = refusal.fields[field];
    return code === undefined ? null : translateError(t, code);
  };
  const timeError = error("finish_time_s");
  // The rank and the number of people ranked are told together: the refusal is about how they stand.
  const rankError = error("rank") ?? error("rank_of");
  const rankDescribedBy = rankError === null ? undefined : rankErrorId;

  return (
    <form ref={form} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <SelectField
        label={t.participation.status}
        value={draft.status}
        onChange={(status) => {
          if (isResultStatus(status)) change({ status });
        }}
      >
        <option value="finished">{t.status.finished}</option>
        <option value="dnf">{t.status.dnf}</option>
      </SelectField>
      {draft.status === "finished" && (
        <>
          <div className="flex flex-col gap-1">
            <TimeInput
              name="finish_time_s"
              label={t.results.time}
              value={draft.time}
              onChange={(time) => {
                change({ time });
              }}
              describedBy={timeError === null ? undefined : timeErrorId}
              invalid={timeError !== null}
            />
            {timeError !== null && (
              <p id={timeErrorId} role="alert" className="text-sm font-medium text-red-700">
                {timeError}
              </p>
            )}
          </div>
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium">{t.results.rank}</legend>
            <div className="flex flex-wrap items-center gap-2">
              <input
                name="rank"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.rank}
                onChange={(event) => {
                  change({ rank: event.target.value });
                }}
                aria-label={t.results.rank}
                aria-describedby={rankDescribedBy}
                aria-invalid={error("rank") !== null}
                className={`${INPUT} w-24`}
              />
              <span aria-hidden="true">{t.results.rankOf}</span>
              <input
                name="rank_of"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={draft.rankOf}
                onChange={(event) => {
                  change({ rankOf: event.target.value });
                }}
                aria-label={t.results.rankTotal}
                aria-describedby={rankDescribedBy}
                aria-invalid={error("rank_of") !== null}
                className={`${INPUT} w-24`}
              />
            </div>
            {rankError !== null && (
              <p id={rankErrorId} role="alert" className="text-sm font-medium text-red-700">
                {rankError}
              </p>
            )}
          </fieldset>
        </>
      )}
      <Field label={t.results.note} hint={t.results.noteHint} error={error("result_note")}>
        {(control) => (
          <textarea
            {...control}
            name="result_note"
            rows={3}
            maxLength={200}
            value={draft.note}
            onChange={(event) => {
              change({ note: event.target.value });
            }}
            className={`${INPUT} py-2`}
          />
        )}
      </Field>
      {refusal.form !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {translateError(t, refusal.form)}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={update.isPending || undefined}
          className={`${PRIMARY} ${update.isPending ? "opacity-60" : ""}`}
        >
          {update.isPending ? t.auth.saving : t.results.save}
        </button>
      </div>
    </form>
  );
}
