import { useEffect, useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { Field, INPUT } from "../../components/Field";
import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import type { OfferKind } from "../../lib/types";
import type { EventView } from "../events/api";
import { useSaveOffer, type OfferInput, type OfferView } from "./api";

/** How many people a car takes besides its driver, and a lodging when it says. */
const SEATS = { ride: { min: 1, max: 8 }, lodging: { min: 1, max: 30 } } as const;

/** The fields of the form, by the name the server gives them, in the order of the form. */
const FIELDS = {
  ride: ["place", "seats", "date", "time", "notes"],
  lodging: ["place", "seats", "date", "end_date", "url", "notes"],
} as const;

type FieldName = (typeof FIELDS)[OfferKind][number];

/** What is typed in the form: texts, as the inputs hold them. */
type Draft = {
  place: string;
  seats: string;
  date: string;
  time: string;
  endDate: string;
  url: string;
  notes: string;
};

/**
 * A new offer starts empty, on the first day of the event: it is the day most
 * cars leave and most beds are for. An offer that is changed starts as it is,
 * with no day if it has none.
 */
function initialDraft(view: EventView, offer: OfferView | undefined): Draft {
  if (!offer) {
    return {
      place: "",
      seats: "",
      date: view.event.start_date,
      time: "",
      endDate: "",
      url: "",
      notes: "",
    };
  }
  const { place, seats, date, time, end_date, url, notes } = offer.offer;
  return {
    place,
    // 0 is how the server says that a lodging has no limit: an empty field.
    seats: seats ? String(seats) : "",
    date: date ?? "",
    time: time ?? "",
    endDate: end_date ?? "",
    url: url ?? "",
    notes: notes ?? "",
  };
}

/**
 * What the form sends. A field that is empty is sent empty (and no seats as
 * 0), so that changing an offer clears what the member has emptied. A car does
 * not send what only a lodging has (the day of departure and the link), nor a
 * lodging the time.
 */
function toInput(kind: OfferKind, draft: Draft): OfferInput {
  const common = {
    place: draft.place.trim(),
    seats: draft.seats === "" ? 0 : Number(draft.seats),
    date: draft.date,
    notes: draft.notes.trim(),
  };
  return kind === "ride"
    ? { ...common, time: draft.time }
    : { ...common, end_date: draft.endDate, url: draft.url.trim() };
}

/**
 * What the last attempt to save was refused for, as codes of the server: the
 * ones of fields, which are shown under them, and the one that is not about a
 * field of the form (a refusal of the offer as a whole, or a failure), which
 * is shown above the buttons. `attempt` makes each refusal a new state, so
 * that the focus goes to a field again.
 */
type Refusal = {
  fields: Readonly<Partial<Record<FieldName, string>>>;
  form: string | null;
  attempt: number;
};

const NO_REFUSAL: Refusal = { fields: {}, form: null, attempt: 0 };

function refusalOf(err: unknown, kind: OfferKind, attempt: number): Refusal {
  const fields: Partial<Record<FieldName, string>> = {};
  let form: string | undefined;
  for (const [name, code] of Object.entries(fieldErrors(err))) {
    const field = FIELDS[kind].find((known) => known === name);
    if (field === undefined) form ??= code;
    else fields[field] = code;
  }
  // No code at all (a network failure): the generic message, which `translateError` gives.
  const unexplained = Object.keys(fields).length === 0 && form === undefined;
  return { fields, form: form ?? (unexplained ? (errorCode(err) ?? "generic") : null), attempt };
}

/**
 * The window that offers a car or a lodging for an event (`offer` absent), or
 * changes one (`offer`, which is of this `kind`: the kind does not change).
 * It closes once the offer is saved, and the focus goes back to the button that
 * opened it, unless that button is gone: `onSaved` tells the page, before the
 * window closes, so that it places the focus. While the offer is on its way,
 * the button says it is busy and is not disabled: it would lose the focus, and
 * a refusal that is not about a field (shown above the buttons) would not give
 * it back; a second click is ignored.
 */
export function OfferDialog({
  open,
  onClose,
  view,
  kind,
  offer,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  view: EventView;
  kind: OfferKind;
  offer?: OfferView | undefined;
  /** Called when the offer is saved, just before `onClose`. */
  onSaved?: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={offer ? t.offers.form.titleEdit : t.offers.form.titleNew[kind]}
    >
      <OfferForm view={view} kind={kind} offer={offer} onClose={onClose} onSaved={onSaved} />
    </Dialog>
  );
}

function OfferForm({
  view,
  kind,
  offer,
  onClose,
  onSaved,
}: {
  view: EventView;
  kind: OfferKind;
  offer: OfferView | undefined;
  onClose: () => void;
  onSaved: (() => void) | undefined;
}) {
  const { t } = useI18n();
  const save = useSaveOffer(view.event.id);
  const form = useRef<HTMLFormElement>(null);
  // Everything the member types lives here: it is still there after the server refuses the form.
  const [draft, setDraft] = useState(() => initialDraft(view, offer));
  const [refusal, setRefusal] = useState(NO_REFUSAL);
  // Set on the spot: the state of a mutation is there after a render only, and two clicks can come before it.
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
      await save.mutateAsync({
        kind,
        ...(offer && { id: offer.offer.id }),
        input: toInput(kind, draft),
      });
    } catch (err) {
      saving.current = false;
      setRefusal((last) => refusalOf(err, kind, last.attempt + 1));
      return;
    }
    // The form goes with the window: it is not reopened for a second save.
    onSaved?.();
    onClose();
  }

  const error = (field: FieldName): string | null => {
    const code = refusal.fields[field];
    return code === undefined ? null : translateError(t, code);
  };
  const { min, max } = SEATS[kind];

  return (
    <form ref={form} onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <Field label={t.offers.form.place[kind]} error={error("place")}>
        {(control) => (
          <input
            {...control}
            name="place"
            type="text"
            required
            maxLength={120}
            autoComplete="off"
            value={draft.place}
            onChange={(event) => {
              change({ place: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>
      <Field label={t.offers.form.seats[kind]} error={error("seats")}>
        {(control) => (
          <input
            {...control}
            name="seats"
            type="number"
            inputMode="numeric"
            min={min}
            max={max}
            step={1}
            // A car has to say how many it takes; a lodging may leave it, which is no limit.
            required={kind === "ride"}
            value={draft.seats}
            onChange={(event) => {
              change({ seats: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>
      <Field label={t.offers.form.date[kind]} error={error("date")}>
        {(control) => (
          <input
            {...control}
            name="date"
            type="date"
            value={draft.date}
            onChange={(event) => {
              change({ date: event.target.value });
            }}
            className={INPUT}
          />
        )}
      </Field>
      {kind === "ride" ? (
        <Field label={t.offers.form.time} error={error("time")}>
          {(control) => (
            <input
              {...control}
              name="time"
              type="time"
              value={draft.time}
              onChange={(event) => {
                change({ time: event.target.value });
              }}
              className={INPUT}
            />
          )}
        </Field>
      ) : (
        <>
          <Field label={t.offers.form.endDate} error={error("end_date")}>
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
          <Field label={t.offers.form.url} error={error("url")}>
            {(control) => (
              <input
                {...control}
                name="url"
                type="url"
                inputMode="url"
                autoComplete="off"
                value={draft.url}
                onChange={(event) => {
                  change({ url: event.target.value });
                }}
                className={INPUT}
              />
            )}
          </Field>
        </>
      )}
      <Field label={t.offers.form.notes} error={error("notes")}>
        {(control) => (
          <textarea
            {...control}
            name="notes"
            rows={3}
            maxLength={1000}
            value={draft.notes}
            onChange={(event) => {
              change({ notes: event.target.value });
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
          aria-disabled={save.isPending || undefined}
          className={`${PRIMARY} ${save.isPending ? "opacity-60" : ""}`}
        >
          {save.isPending ? t.auth.saving : t.offers.form.save}
        </button>
      </div>
    </form>
  );
}
