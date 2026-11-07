import { useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { startTransition, useActionState, useId, useRef, useState } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Field, INPUT } from "../../components/Field";
import { useToast } from "../../components/Toast";
import { errorCode, fieldErrors, fieldMessage, translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import { isMonthOnly, parseDate } from "../../lib/dates";
import type { RaceTypeRecord } from "../../lib/types";
import { usePageTitle } from "../../lib/usePageTitle";
import { useToday } from "../../lib/useToday";
import { useSession } from "../auth/session";
import { allowedStatus } from "../participations/api";
import { SelectField, StatusField } from "../participations/fields";
import { canDeleteEvent, type Me } from "../participations/permissions";
import { invalidateEvents, useEvent, useRaceTypes, type EventView } from "./api";
import { DuplicateHint } from "./DuplicateHint";
import { FormatFieldset } from "./FormatFieldset";
import { formatDisplayName } from "./formatName";
import {
  emptyRow,
  eventEndDate,
  formerPeriod,
  hasMeasure,
  initialDraft,
  isDay,
  isLongEvent,
  isSettled,
  joinRowOf,
  joinStarted,
  monthStart,
  shortens,
  toEventDraft,
  type FormatRow,
  type FormerPeriod,
} from "./formDraft";
import { saveEvent, SaveEventError, TraceUploadError } from "./saveEvent";

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

// `end_date` is not one: the form has no field for it, so a refusal about it is said as a whole.
const EVENT_FIELDS: readonly string[] = [
  "name",
  "location",
  "start_date",
  "registration_url",
  "registration_deadline",
  "registration_opening",
  "registration_opening_time",
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
  "gpx",
  "route_url",
  "date",
];

const MONTHS_BACK = 12;
const MONTHS_AHEAD = 36;

/** The months of the list, `YYYY-MM` sorted: 12 back from `current` to 36 ahead, and `stored`, the month saved, when it is outside. */
function monthChoices(current: Temporal.PlainYearMonth, stored: string): string[] {
  const months: string[] = [];
  for (let n = -MONTHS_BACK; n <= MONTHS_AHEAD; n += 1) {
    months.push(current.add({ months: n }).toString());
  }
  if (/^\d{4}-\d{2}$/.test(stored) && !months.includes(stored)) months.push(stored);
  return months.toSorted();
}

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

/** The page that creates an event. The page that edits one sets its title itself (see `EditEventPage`). */
export function NewEventPage() {
  const { t } = useI18n();
  usePageTitle(t.titles.newEvent);
  return <EventForm />;
}

/**
 * The form that creates an event, or edits `existing`, with its formats. The
 * app shell around it owns the page's `<main>`; the page sets the title.
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
  // The one hook that sets this page's title, while the event loads and after.
  usePageTitle(
    query.data
      ? t.titles.edit(query.data.event.name)
      : query.error instanceof ClientResponseError && query.error.status === 404
        ? t.titles.raceNotFound
        : t.titles.editLoading,
  );

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

/**
 * The days of the event, under its start date: one day, or from the first to the
 * last day of its formats (`end`, see `eventEndDate`). An event that is being
 * edited and whose end would change says what it was (`former`, see
 * `formerPeriod`): saving a long event whose formats have no day of their own
 * makes it a one-day event, and that is not to be a surprise. An event of more
 * than two weeks says to check the days of the formats: that is what a year
 * typed wrong makes.
 *
 * It is an `<output>`, a polite live region, so that a change is read out, and
 * the start date is described by it (`id`). It is always in the page, empty (and
 * out of the flow) while there is no start day: a region that comes with its
 * text is often not read out.
 *
 * A date that is being typed is not read out. Chromium gives a complete day for
 * each key of a year (`0002-06-13`, `0020-06-13`, `0202-06-13`), and each would
 * rewrite the region: while one of the `dates` is not settled (see
 * `isSettled`), the region keeps the text it had.
 */
function Period({
  id,
  start,
  end,
  former,
  dates,
  month,
}: {
  id: string;
  start: string;
  end: string;
  former: FormerPeriod | undefined;
  /** Every date the text goes by: the start, and the day of each format. */
  dates: readonly string[];
  /** The month (`YYYY-MM`) of a race known by its month only: its line says that the date is to be set. */
  month?: string;
}) {
  const { t, f } = useI18n();
  let text = "";
  if (month !== undefined) {
    if (/^\d{4}-\d{2}$/.test(month)) {
      text = t.form.periodMonth(f.monthTitle(Temporal.PlainYearMonth.from(month)));
    }
  } else if (isDay(start)) {
    const first = f.date(parseDate(start));
    text =
      end === "" ? t.form.periodOneDay(first) : t.form.periodRange(first, f.date(parseDate(end)));
    if (former) {
      text += ` ${t.form.periodWas(f.date(parseDate(former.start)), f.date(parseDate(former.end)))}`;
    }
    if (isLongEvent(start, end)) text += `. ${t.form.periodLong}`;
  }
  // What the region said when every date was settled, for the renders in between.
  const [said, setSaid] = useState(text);
  const settled = dates.every(isSettled);
  if (settled && said !== text) setSaid(text);
  return (
    <output id={id} className="period-line text-sm text-neutral-700 empty:sr-only">
      {settled ? text : said}
    </output>
  );
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
  const today = useToday();
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
  const periodId = useId();
  const shortensId = useId();
  const needsDayId = useId();

  // "I'm taking part" is for a new event, and needs the runner of the member.
  const joinOffered = initial === undefined && runner !== null;
  const joinRow = joinRowOf(draft);
  // Nobody finishes a race, or gives up on it, before its day: the status goes
  // back to « Intéressé » when the race to join has not started.
  const started = joinStarted(draft, today);
  const joinStatus = allowedStatus(draft.joinStatus, started);

  // The event ends on the last day of its formats: there is no field for it.
  // A race known by its month starts on the 1st of it and ends on its last day.
  const firstDay = draft.monthOnly ? monthStart(draft.startMonth) : draft.startDate;
  const endDate = eventEndDate(
    firstDay,
    draft.rows.map((row) => row.date),
    draft.monthOnly,
  );
  const months = monthChoices(today.toPlainYearMonth(), draft.startMonth);
  // What the form says it would change in the days of the event being edited.
  const former = formerPeriod(initial?.event, endDate);
  const losesDays = former !== undefined && shortens(former, endDate);

  function change(patch: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...patch }));
  }

  /** The box: checked, the month of the day typed (else the one chosen before, else this month); the draft keeps both. */
  function setMonthOnly(monthOnly: boolean) {
    setDraft((current) => {
      // The stored 1st of a month race is not a day the person chose: unchecking leaves the field
      // empty (it is required), so that Save cannot date the race on the 1st. A typed day stays.
      const storedFirst =
        initial !== undefined &&
        isMonthOnly(initial.event) &&
        current.startDate === initial.event.start_date;
      return {
        ...current,
        monthOnly,
        startDate: !monthOnly && storedFirst ? "" : current.startDate,
        // A day half typed (`0020-06-13`) is no month to offer.
        startMonth: !monthOnly
          ? current.startMonth
          : isDay(current.startDate) && isSettled(current.startDate)
            ? current.startDate.slice(0, 7)
            : current.startMonth || today.toPlainYearMonth().toString(),
      };
    });
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

    // What the message about a track that was not sent calls a format: what the page will call it.
    const named = (row: FormatRow, index: number) =>
      displayName(row) ?? t.form.formatTitle(index + 1);
    let id: string;
    // The formats whose track was not sent, and why: the event is saved all the same.
    let unsent: string[] = [];
    let causes: unknown[] = [];
    try {
      const join = joinOffered && draft.join;
      id = await saveEvent(
        toEventDraft({ ...draft, joinStatus }, initial, join, named),
        initial,
        runner?.id,
      );
    } catch (err) {
      if (!(err instanceof TraceUploadError)) return refusal(err, draft.rows);
      id = err.eventId;
      unsent = err.formats;
      causes = err.causes;
    }
    await invalidateEvents(queryClient, id);
    toast.show(unsent.length > 0 ? untracked(unsent, causes) : t.form.saved);
    await navigate({ to: "/evenements/$id", params: { id } });
    return NO_ERRORS;
  }, NO_ERRORS);

  const eventError = (field: string): string | null => {
    const code = errors.event[field];
    return code === undefined ? null : translateError(t, code);
  };

  /**
   * What to say when the track of these formats was not sent. When the server
   * answered each of them with the same refusal of the file, and the form has
   * words for it (too big, not a GPX file), the message says why; any other
   * failure, or different reasons, get the general message.
   */
  function untracked(names: string[], causes: unknown[]): string {
    const reasons = new Set(causes.map((cause) => fieldMessage(t, "gpx", fieldErrors(cause).gpx)));
    const [reason] = reasons;
    return reasons.size === 1 && reason !== undefined
      ? t.form.traceFailedBecause(f.list(names), reason)
      : t.form.traceFailed(f.list(names));
  }

  /** What a row is called, as the page of the event will call it: none until it has a type. */
  function displayName(row: FormatRow): string | undefined {
    const raceType = raceTypes.find(({ id }) => id === row.raceType);
    if (!raceType) return undefined;
    return formatDisplayName(
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
  }

  /** What the choice of the format to join says of a row: its place, and what it is when it has begun to be filled in. */
  function rowLabel(row: FormatRow, number: number): string {
    const name = displayName(row);
    return name === undefined
      ? t.form.formatTitle(number)
      : `${t.form.formatTitle(number)} · ${name}`;
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
      className="event-form flex flex-col gap-6"
    >
      <h1 tabIndex={-1} className="page-title">
        {initial ? t.form.editTitle : t.form.createTitle}
      </h1>

      <div className="form-card card flex flex-col gap-4 p-4 md:p-5">
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
        <div className="flex flex-col gap-1">
          {draft.monthOnly ? (
            <Field label={t.form.month} error={eventError("start_date")} describedBy={periodId}>
              {(control) => (
                <select
                  {...control}
                  name="start_month"
                  required
                  value={draft.startMonth}
                  onChange={(event) => {
                    change({ startMonth: event.target.value });
                  }}
                  className={INPUT}
                >
                  {months.map((month) => (
                    <option key={month} value={month}>
                      {f.monthTitle(Temporal.PlainYearMonth.from(month))}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : (
            <Field label={t.form.startDate} error={eventError("start_date")} describedBy={periodId}>
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
          )}
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.monthOnly}
              onChange={(event) => {
                setMonthOnly(event.target.checked);
              }}
              className="size-6"
            />
            <span className="text-sm font-semibold">{t.form.dayUnknown}</span>
          </label>
          <Period
            id={periodId}
            start={firstDay}
            end={endDate}
            former={former}
            month={draft.monthOnly ? draft.startMonth : undefined}
            dates={draft.monthOnly ? [firstDay] : [firstDay, ...draft.rows.map((row) => row.date)]}
          />
        </div>
        <DuplicateHint name={draft.name} startDate={firstDay} excludeId={initial?.event.id} />
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
        <Field label={t.form.registrationOpening} error={eventError("registration_opening")}>
          {(control) => (
            <input
              {...control}
              name="registration_opening"
              type="date"
              value={draft.registrationOpening}
              onChange={(event) => {
                change({ registrationOpening: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        <Field
          label={t.form.registrationOpeningTime}
          hint={t.form.registrationOpeningTimeHint}
          error={eventError("registration_opening_time")}
          describedBy={draft.registrationOpening === "" ? needsDayId : undefined}
        >
          {(control) => (
            <input
              {...control}
              name="registration_opening_time"
              type="time"
              // A time needs a day: the draft keeps what was typed until it is sent, and the day gives the field back.
              disabled={draft.registrationOpening === ""}
              value={draft.registrationOpeningTime}
              onChange={(event) => {
                change({ registrationOpeningTime: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
        {draft.registrationOpening === "" && (
          <p id={needsDayId} className="-mt-2 text-sm text-neutral-600">
            {t.form.registrationOpeningTimeNeedsDay}
          </p>
        )}
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
        <BlockTitle ref={formatsTitle} id="formats-title" tabIndex={-1} className="text-xl">
          {t.form.formatsTitle}
        </BlockTitle>
        {draft.rows.map((row, index) => (
          <FormatFieldset
            key={row.key}
            number={index + 1}
            row={row}
            startDate={firstDay}
            monthOnly={draft.monthOnly}
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
        <section className="form-card card flex flex-col gap-3 p-4">
          <label className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={draft.join}
              onChange={(event) => {
                change({ join: event.target.checked });
              }}
              className="size-6"
            />
            <span className="font-semibold">{t.form.join}</span>
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
                value={joinStatus}
                started={started}
                onChange={(next) => {
                  change({ joinStatus: next });
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
      {losesDays && (
        <p id={shortensId} className="text-sm font-medium text-neutral-800">
          {t.form.periodShortens(f.date(parseDate(former.start)), f.date(parseDate(former.end)))}
        </p>
      )}
      <div className="form-actions flex flex-wrap gap-2">
        <button
          type="submit"
          disabled={pending}
          aria-describedby={losesDays ? shortensId : undefined}
          className={PRIMARY}
        >
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
