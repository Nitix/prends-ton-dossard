import { useId, useRef, useState, type ChangeEvent, type ReactNode } from "react";

import { SECONDARY } from "../../components/buttons";
import { DurationInput } from "../../components/DurationInput";
import { Field, INPUT } from "../../components/Field";
import { translateFieldError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import { MEASURES, shownMeasures } from "../../lib/measures";
import type { Measure, RaceTypeRecord } from "../../lib/types";
import { gpxStats, MAX_GPX_BYTES, parseGpx, type GpxStats } from "../route/gpx";
import { filledMeasures, isDay, type FormatRow } from "./formDraft";

/** Puts the focus on an element when it appears: the first field of a row that has just been added. */
function focusOnMount(element: HTMLElement | null) {
  element?.focus();
}

/**
 * The fields of one format, in a group named after it ("Épreuve 1"). The measures
 * of its race type come first, the others are in a closed section under them,
 * « Options avancées » (see `shownMeasures`); a measure that has a value is
 * never in that section. `errors`
 * has the code of the server, or of the form, for each field, by the name the
 * server gives it; `row` is a refusal that is about the format as a whole.
 * The day of the format is not before `startDate`, the start of the event.
 */
export function FormatFieldset({
  number,
  row,
  startDate,
  raceTypes,
  errors,
  onChange,
  removal,
  focusFirst,
}: {
  /** The place of the format in the form, from 1. */
  number: number;
  row: FormatRow;
  /** The first day of the event, as it is typed: a text that is not a day gives no minimum. */
  startDate: string;
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
  const { t, f } = useI18n();
  const measuresId = useId();
  const warningId = useId();
  const title = useRef<HTMLLegendElement>(null);
  const trackField = useRef<HTMLInputElement>(null);
  const statusId = useId();
  // The measures that have a value, and so are shown whatever the type says. It is
  // worked out when the row appears, when its type changes, when « Options avancées »
  // is closed, and when a track gives a value: not at every key, since a field that
  // is typed in has to stay where it is, or it would be taken away from under the
  // finger and its focus lost. Emptying a field does not put it away either: it
  // goes at the next change of type.
  const [valued, setValued] = useState<ReadonlySet<Measure>>(() => filledMeasures(row));
  // What the file chosen holds, read in the browser.
  const [read, setRead] = useState<GpxStats | null>(null);
  // Why the file chosen last was left out: it could not be read, or the server would not take it.
  const [refused, setRefused] = useState<"unreadable" | "tooBig" | null>(null);
  // What the form did with the track before a file was chosen: where it goes back to when that file is dropped.
  const [before, setBefore] = useState<"keep" | "remove">("keep");

  const message = (field: string): string | null => {
    const code = errors[field];
    return code === undefined ? null : translateFieldError(t, field, code);
  };
  const trackError =
    refused === "tooBig"
      ? t.format.gpxTooBig
      : refused === "unreadable"
        ? t.route.unreadable
        : message("gpx");

  /** Drops the file chosen: the field is emptied, and the track goes back to what it was before the choice. */
  function dropFile(input: HTMLInputElement | null, chosen: boolean) {
    if (input) input.value = "";
    setRead(null);
    if (chosen) onChange({ gpx: { kind: before } });
  }

  /** A file is chosen: it is left out if it is too big for the server or is not a track, and read here before it is kept. */
  async function chooseTrack(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    const { kind } = row.gpx;
    const chosen = kind === "new";
    setRefused(null);
    if (file === undefined) {
      // The choice was cancelled: the browser forgets the file it had, and so does the form.
      if (chosen) dropFile(null, chosen);
      return;
    }
    if (file.size > MAX_GPX_BYTES) {
      setRefused("tooBig");
      dropFile(input, chosen);
      return;
    }
    let stats: GpxStats;
    try {
      stats = gpxStats(parseGpx(await file.text()));
    } catch {
      // Another file may have been chosen while this one was read: that one is the one to look at.
      if (input.files?.[0] !== file) return;
      setRefused("unreadable");
      dropFile(input, chosen);
      return;
    }
    if (input.files?.[0] !== file) return;
    if (kind !== "new") setBefore(kind);
    setRead(stats);
    onChange({ gpx: { kind: "new", file } });
  }

  /** « Reprendre ces valeurs »: the distance as it is read (to a tenth of a km), and the elevation gain when the file has altitudes. */
  function reuseTrack() {
    if (read === null) return;
    // The values it gives are shown, even for a type that does not use them.
    showAlways(read.min === undefined ? ["distance"] : ["distance", "elevation"]);
    onChange({
      distanceKm: String(Math.round(read.km * 10) / 10),
      ...(read.min === undefined ? {} : { elevation: String(Math.round(read.gain)) }),
    });
  }

  /**
   * « Retirer la trace »: a file chosen and not sent yet is dropped, which puts
   * the track back as it was before the choice; the track the format has on the
   * server is taken off when the form is saved (and « Annuler » keeps it). The
   * button goes with what it removed, and the focus with it: it goes to the title
   * of the format, unless the button is still there.
   */
  function removeTrack() {
    setRefused(null);
    if (row.gpx.kind === "new") {
      dropFile(trackField.current, true);
      if (before === "remove" || !row.hasTrack) title.current?.focus();
    } else {
      onChange({ gpx: { kind: "remove" } });
      title.current?.focus();
    }
  }

  /**
   * « Annuler » under the track that is to be taken off: it stays. Its button is
   * gone, the focus goes to the title of the format. The refusal of a file, which
   * was about the choice that came with the removal, has nothing left to say.
   */
  function keepTrack() {
    setRefused(null);
    onChange({ gpx: { kind: "keep" } });
    title.current?.focus();
  }

  /** Adds measures to those that are shown whatever the type says. */
  function showAlways(measures: readonly Measure[]) {
    setValued((current) => new Set([...current, ...measures]));
  }

  /**
   * « Options avancées » was closed with values in it: they come out, to be with
   * the measures, so that no value is left in a closed section. When that is all
   * the section held it goes, and the summary that had the focus with it: the
   * focus goes to the title of the format.
   */
  function sortAway() {
    const filled = filledMeasures(row);
    const coming = away.filter((measure) => filled.has(measure));
    if (coming.length === 0) return;
    showAlways(coming);
    if (coming.length === away.length) title.current?.focus();
  }

  const hasTrackToRemove = row.gpx.kind === "new" || (row.gpx.kind === "keep" && row.hasTrack);

  // One message for the three measures: a format needs one of them, not each.
  const measureError =
    message("distance_km") ?? message("duration_min") ?? message("time_limit_min");
  const measuresHintId = `${measuresId}-hint`;
  const measuresErrorId = `${measuresId}-error`;
  const measuresDescribedBy =
    measureError === null ? measuresHintId : `${measuresHintId} ${measuresErrorId}`;
  const rowError = message("row");

  // The measures of the type, the ones with a value, and the others.
  const used = shownMeasures(raceTypes.find((raceType) => raceType.id === row.raceType));
  const main = MEASURES.filter((measure) => used.includes(measure) || valued.has(measure));
  const away = MEASURES.filter((measure) => !main.includes(measure));

  /** The field of each measure, wherever it is put: with the others, or in « Options avancées ». */
  const measureFields: Record<Measure, ReactNode> = {
    distance: (
      <Field key="distance" label={t.form.distance} error={null}>
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
    ),
    elevation: (
      <Field key="elevation" label={t.form.elevation} error={message("elevation_gain_m")}>
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
    ),
    duration: (
      <DurationInput
        key="duration"
        name={`format-${row.key}-duration`}
        label={t.form.duration}
        value={row.duration}
        onChange={(duration) => {
          onChange({ duration });
        }}
        describedBy={measuresDescribedBy}
        invalid={measureError !== null}
      />
    ),
    time_limit: (
      <DurationInput
        key="time_limit"
        name={`format-${row.key}-time-limit`}
        label={t.form.timeLimit}
        value={row.timeLimit}
        onChange={(timeLimit) => {
          onChange({ timeLimit });
        }}
        describedBy={measuresDescribedBy}
        invalid={measureError !== null}
      />
    ),
  };

  return (
    <fieldset className="format-fieldset card flex min-w-0 flex-col gap-4 p-4 pt-2">
      <legend
        ref={title}
        tabIndex={-1}
        className="format-legend rounded-full bg-dawn-deep px-3.5 py-1 font-display text-sm font-bold text-dawn-deep-ink shadow-glow"
      >
        {t.form.formatTitle(number)}
      </legend>
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
              // What has a value stays with the measures, whatever the new type uses.
              setValued(filledMeasures(row));
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
        {main.map((measure) => measureFields[measure])}
        {measureError !== null && (
          <p id={measuresErrorId} role="alert" className="text-sm font-medium text-red-700">
            {measureError}
          </p>
        )}
      </div>

      {away.length > 0 && (
        <details
          onToggle={(event) => {
            if (!event.currentTarget.open) sortAway();
          }}
          // A field in the closed section that the browser finds invalid (a number that is not
          // one, which it reads as empty: nothing is filled, so nothing came out) cannot be
          // reported, and the form would not be sent without a word. The section opens, so that
          // the browser can put the focus on the field and say what is wrong. `invalid` does not
          // bubble: the capture phase is where a parent hears it.
          onInvalidCapture={(event) => {
            event.currentTarget.open = true;
          }}
        >
          <summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-neutral-800 marker:text-iris-600">
            {t.form.moreOptions(f.list(away.map((measure) => t.form.measureNames[measure])))}
          </summary>
          <div className="flex flex-col gap-3 pt-1">
            {away.map((measure) => measureFields[measure])}
          </div>
        </details>
      )}

      <div className="flex flex-col gap-2">
        <Field label={t.format.gpx} error={trackError}>
          {(control) => (
            <input
              {...control}
              ref={trackField}
              type="file"
              accept=".gpx,application/gpx+xml"
              onChange={(event) => void chooseTrack(event)}
              className={`${INPUT} py-2 file:mr-3 file:border-0 file:bg-transparent file:font-medium`}
            />
          )}
        </Field>
        {/*
          Always in the page, and never `display: none`: such an element is not
          in the accessibility tree, and a text that comes with its element is
          often not read out, while this line is the only feedback that the file
          was read. Empty, it is out of the flow (`sr-only`), so that it takes no
          room, not even the gap of the column.
        */}
        <output id={statusId} className="text-sm text-neutral-700 empty:sr-only">
          {row.gpx.kind === "new" && read !== null
            ? read.min === undefined
              ? t.format.gpxReadDistance(f.km(read.km))
              : t.format.gpxRead(f.km(read.km), f.meters(read.gain))
            : row.gpx.kind === "remove"
              ? t.format.gpxRemoved
              : null}
        </output>
        <div className="flex flex-wrap gap-2 empty:hidden">
          {row.gpx.kind === "new" && read !== null && (
            <button type="button" onClick={reuseTrack} className={SECONDARY}>
              {t.format.gpxReuse}
            </button>
          )}
          {hasTrackToRemove && (
            <button type="button" onClick={removeTrack} className={SECONDARY}>
              {t.format.gpxRemove}
            </button>
          )}
          {row.gpx.kind === "remove" && (
            <button
              type="button"
              aria-describedby={statusId}
              onClick={keepTrack}
              className={SECONDARY}
            >
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>

      <Field label={t.format.routeUrl} error={message("route_url")}>
        {(control) => (
          <input
            {...control}
            type="url"
            inputMode="url"
            autoComplete="off"
            value={row.routeUrl}
            onChange={(event) => {
              onChange({ routeUrl: event.target.value });
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
            min={isDay(startDate) ? startDate : undefined}
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
