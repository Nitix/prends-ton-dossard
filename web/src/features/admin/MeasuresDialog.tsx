import { useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { MEASURES, measuresOf } from "../../lib/measures";
import type { Measure, RaceTypeRecord } from "../../lib/types";
import { useRaceTypeActions } from "./api";
import { adminError } from "./errors";

/**
 * Chooses the measures that a race type uses: the fields that the form of a
 * format shows first for a format of that type, the others being in its
 * « Options avancées ». It is open while it has a race type. A type that has
 * chosen nothing yet uses all four, and so starts with the four ticked.
 */
export function MeasuresDialog({
  raceType,
  onClose,
}: {
  raceType: RaceTypeRecord | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={raceType !== null}
      onClose={onClose}
      title={raceType === null ? "" : t.admin.measuresTitle(raceType.label)}
    >
      {raceType !== null && <MeasuresForm raceType={raceType} onClose={onClose} />}
    </Dialog>
  );
}

function MeasuresForm({ raceType, onClose }: { raceType: RaceTypeRecord; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const actions = useRaceTypeActions();
  const [chosen, setChosen] = useState<ReadonlySet<Measure>>(() => new Set(measuresOf(raceType)));
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // A second tap in the same tick, before the page has drawn the busy button.
  const sending = useRef(false);

  const labels: Record<Measure, string> = {
    distance: t.form.distance,
    elevation: t.form.elevation,
    duration: t.form.duration,
    time_limit: t.form.timeLimit,
  };

  function toggle(measure: Measure, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(measure);
      else next.delete(measure);
      return next;
    });
  }

  /** The button is not `disabled`, which would drop the focus: it says it is busy, and the tap is ignored. */
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const measures = MEASURES.filter((measure) => chosen.has(measure));
    if (measures.length === 0) {
      setMessage(t.admin.measuresNone);
      return;
    }
    sending.current = true;
    setPending(true);
    setMessage(null);
    try {
      await actions.setMeasures(raceType.id, measures);
    } catch (err) {
      sending.current = false;
      setPending(false);
      setMessage(adminError(t, err));
      return;
    }
    toast.show(t.admin.measuresSaved);
    onClose();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">{t.admin.measuresHint}</p>
      <fieldset className="flex flex-col">
        <legend className="sr-only">{t.admin.measures}</legend>
        {MEASURES.map((measure) => (
          <label key={measure} className="flex min-h-11 items-center gap-3">
            <input
              type="checkbox"
              checked={chosen.has(measure)}
              onChange={(event) => {
                toggle(measure, event.target.checked);
              }}
              className="size-6"
            />
            <span className="font-semibold">{labels[measure]}</span>
          </label>
        ))}
      </fieldset>
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={pending || undefined}
          className={`${PRIMARY} ${pending ? "opacity-60" : ""}`}
        >
          {t.common.save}
        </button>
      </div>
    </form>
  );
}
