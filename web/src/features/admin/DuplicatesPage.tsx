import { useMutation } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactNode } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Field, INPUT } from "../../components/Field";
import { useToast } from "../../components/Toast";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import type { Formatters } from "../../lib/format";
import { useEvent, type FormatView } from "../events/api";
import { formatMeasures } from "../events/formatName";
import { useMergeActions, type MergeKind } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { adminError } from "./errors";
import { EventPicker, type Choice } from "./EventPicker";
import { describeMerge } from "./mergePreview";
import { useRestoreFocus } from "./useRestoreFocus";

/** What the admin is about to merge, as the confirmation restates it. */
type Plan = {
  kind: MergeKind;
  /** The event that holds the result: the page of it is the one to ask for again. */
  eventId: string;
  keep: Choice;
  merge: Choice;
  /** What the preview said the merge does. */
  lines: string[];
};

/**
 * The duplicates page of the admin: two events, or two formats of one event,
 * that two members each added. The admin chooses them, says which one stays,
 * looks at what the merge would do (a preview that writes nothing), and only
 * then, after a last confirmation, merges for good: what is merged is deleted.
 *
 * The title of the page can take the focus (it is not in the tab order): it is
 * where the focus goes when the merge is done and the page starts over, the
 * button that opened the confirmation being gone.
 */
export function DuplicatesPage() {
  const { t } = useI18n();
  const toast = useToast();
  const actions = useMergeActions();
  const title = useRef<HTMLHeadingElement>(null);
  const modeName = useId();

  const [kind, setKind] = useState<MergeKind>("events");
  const [plan, setPlan] = useState<Plan | null>(null);
  // Changing the key of what is chosen makes it start over, empty.
  const [round, setRound] = useState(0);

  useRestoreFocus(plan !== null, () => title.current);

  const modes = [
    { kind: "events", label: t.admin.modeEvents },
    { kind: "formats", label: t.admin.modeFormats },
  ] as const;

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold">
        {t.admin.duplicatesTitle}
      </h1>
      <p>{t.admin.duplicatesIntro}</p>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.admin.mergeMode}</legend>
        {modes.map((mode) => (
          <RadioLine key={mode.kind} checked={kind === mode.kind}>
            <input
              type="radio"
              name={modeName}
              checked={kind === mode.kind}
              onChange={() => {
                setKind(mode.kind);
              }}
              className="size-5 shrink-0"
            />
            {mode.label}
          </RadioLine>
        ))}
      </fieldset>
      {kind === "events" ? (
        <EventsMerge key={`events-${round}`} onPlan={setPlan} />
      ) : (
        <FormatsMerge key={`formats-${round}`} onPlan={setPlan} />
      )}
      <ConfirmDialog
        target={plan}
        onClose={() => {
          setPlan(null);
        }}
        title={plan ? t.admin.mergeConfirmTitle[plan.kind] : ""}
        confirmLabel={t.admin.mergeConfirm}
        run={async (target) => {
          await actions.merge(
            target.kind,
            { keepId: target.keep.id, mergeId: target.merge.id },
            target.eventId,
          );
          toast.show(t.admin.merged);
          setRound((current) => current + 1);
        }}
      >
        {(target) => <PlanSummary plan={target} />}
      </ConfirmDialog>
    </div>
  );
}

/** A choice among a few, with the whole line as the tap target. */
function RadioLine({ checked, children }: { checked: boolean; children: ReactNode }) {
  return (
    <label
      className={`flex min-h-11 items-start gap-3 rounded-lg border px-3 py-2 ${
        checked ? "border-neutral-900" : "border-neutral-300"
      }`}
    >
      {children}
    </label>
  );
}

/** What the confirmation says: who stays, who goes, and what moves. */
function PlanSummary({ plan }: { plan: Plan }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-3">
      <p className="break-words">{t.admin.keptLine(plan.keep.label)}</p>
      <p className="break-words">{t.admin.removedLine(plan.merge.label)}</p>
      <MergeLines kind={plan.kind} lines={plan.lines} />
      <p className="font-medium">{t.admin.mergeIrreversible}</p>
    </div>
  );
}

/** What a merge does, a line per change; or that there is nothing to move. */
function MergeLines({ kind, lines }: { kind: MergeKind; lines: string[] }) {
  const { t } = useI18n();
  return lines.length === 0 ? (
    <p>{t.admin.mergeNothing[kind]}</p>
  ) : (
    <ul className="list-disc pl-5">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

/** Merging two events: both are found by their name. */
function EventsMerge({ onPlan }: { onPlan: (plan: Plan) => void }) {
  const { t } = useI18n();
  const [first, setFirst] = useState<Choice | null>(null);
  const [second, setSecond] = useState<Choice | null>(null);

  return (
    <>
      <EventPicker
        title={t.admin.firstEvent}
        value={first}
        onChange={setFirst}
        exclude={second?.id}
      />
      <EventPicker
        title={t.admin.secondEvent}
        value={second}
        onChange={setSecond}
        exclude={first?.id}
      />
      {first && second && (
        // Another pair is another preview: the panel starts over.
        <MergePanel
          key={`${first.id}:${second.id}`}
          kind="events"
          a={first}
          b={second}
          onPlan={onPlan}
        />
      )}
    </>
  );
}

/** Merging two formats: the event comes first, then its two formats. */
function FormatsMerge({ onPlan }: { onPlan: (plan: Plan) => void }) {
  const { t } = useI18n();
  const [event, setEvent] = useState<Choice | null>(null);

  return (
    <>
      <EventPicker title={t.admin.theEvent} value={event} onChange={setEvent} />
      {event && <FormatsOf key={event.id} eventId={event.id} onPlan={onPlan} />}
    </>
  );
}

/** The line of a format in a list of the formats of an event: what it is, when, and who is on it. */
function formatLine(view: FormatView, multiDay: boolean, f: Formatters, t: Messages): string {
  const parts = formatMeasures(view.format, view.raceType.label, f, t);
  // On an event of several days, two formats of different days are not duplicates.
  if (multiDay) parts.push(f.date(view.date));
  const runners = view.participations.map(({ runner }) => runner.name);
  if (runners.length > 0) parts.push(f.list(runners));
  return parts.join(" · ");
}

function FormatsOf({ eventId, onPlan }: { eventId: string; onPlan: (plan: Plan) => void }) {
  const { t, f } = useI18n();
  const event = useEvent(eventId);
  const [firstId, setFirstId] = useState("");
  const [secondId, setSecondId] = useState("");

  if (!event.data) {
    return event.isError ? (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.errors.generic}
        </p>
        <button
          type="button"
          onClick={() => void event.refetch()}
          disabled={event.isFetching}
          className={`${SECONDARY} self-start`}
        >
          {t.common.retry}
        </button>
      </div>
    ) : (
      <output>{t.common.loading}</output>
    );
  }

  const { start, end } = event.data;
  const choices: Choice[] = event.data.formats.map((view) => ({
    id: view.format.id,
    label: formatLine(view, !start.equals(end), f, t),
  }));
  if (choices.length < 2) return <p>{t.admin.needTwoFormats}</p>;

  // A format that is gone since (the page was refreshed) is not chosen any more.
  const first = choices.find((choice) => choice.id === firstId);
  const second = choices.find((choice) => choice.id === secondId);

  const select = (
    label: string,
    chosen: Choice | undefined,
    other: Choice | undefined,
    onChange: (id: string) => void,
  ) => (
    <Field label={label} error={null}>
      {(control) => (
        <select
          {...control}
          value={chosen?.id ?? ""}
          onChange={(change) => {
            onChange(change.target.value);
          }}
          className={INPUT}
        >
          <option value="">{t.admin.chooseFormat}</option>
          {/* The other place's format is not offered: it is not the duplicate of itself. */}
          {choices
            .filter((choice) => choice.id !== other?.id)
            .map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
        </select>
      )}
    </Field>
  );

  return (
    <>
      {select(t.admin.firstFormat, first, second, setFirstId)}
      {select(t.admin.secondFormat, second, first, setSecondId)}
      {first && second && (
        <MergePanel
          key={`${first.id}:${second.id}`}
          kind="formats"
          a={first}
          b={second}
          eventId={eventId}
          onPlan={onPlan}
        />
      )}
    </>
  );
}

/**
 * Which of the two stays, the preview, and the merge. «Fusionner» is for once
 * the server has said what this very merge would do: a change of which one
 * stays is another merge (the counters are not the same), so it takes the
 * preview away. A change of the two records does too, by the `key` that the
 * parent gives this panel.
 */
function MergePanel({
  kind,
  a,
  b,
  eventId,
  onPlan,
}: {
  kind: MergeKind;
  a: Choice;
  b: Choice;
  /** The event the formats are of; for two events it is the one that stays. */
  eventId?: string;
  onPlan: (plan: Plan) => void;
}) {
  const { t, lang } = useI18n();
  const actions = useMergeActions();
  const keepName = useId();
  const [keepFirst, setKeepFirst] = useState(true);

  const keep = keepFirst ? a : b;
  const merge = keepFirst ? b : a;
  // The pickers do not offer the same record twice; the server would refuse it anyway.
  const distinct = keep.id !== merge.id;

  const preview = useMutation({
    mutationFn: () => actions.preview(kind, { keepId: keep.id, mergeId: merge.id }),
  });
  const lines = preview.data ? describeMerge(preview.data, t, lang) : null;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">{t.admin.keep[kind]}</legend>
        {[
          { choice: a, first: true },
          { choice: b, first: false },
        ].map(({ choice, first }) => (
          <RadioLine key={first ? "first" : "second"} checked={keepFirst === first}>
            <input
              type="radio"
              name={keepName}
              checked={keepFirst === first}
              onChange={() => {
                setKeepFirst(first);
                preview.reset();
              }}
              className="mt-0.5 size-5 shrink-0"
            />
            <span className="min-w-0 break-words">{choice.label}</span>
          </RadioLine>
        ))}
        <p className="text-sm text-neutral-600">{t.admin.keepHint[kind]}</p>
      </fieldset>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            preview.mutate();
          }}
          disabled={!distinct || preview.isPending}
          className={SECONDARY}
        >
          {t.admin.preview}
        </button>
        <button
          type="button"
          onClick={() => {
            if (lines !== null) onPlan({ kind, eventId: eventId ?? keep.id, keep, merge, lines });
          }}
          disabled={!distinct || !preview.isSuccess}
          className={PRIMARY}
        >
          {t.admin.merge}
        </button>
      </div>
      {preview.isError && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {adminError(t, preview.error)}
        </p>
      )}
      {/* The region is always there, empty: a screen reader announces what comes into it. */}
      <div aria-live="polite">
        {lines !== null && (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">{t.admin.previewTitle}</h3>
            <MergeLines kind={kind} lines={lines} />
          </div>
        )}
      </div>
    </div>
  );
}
