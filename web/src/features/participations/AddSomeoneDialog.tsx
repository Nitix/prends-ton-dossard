import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import { useRunners, type EventView } from "../events/api";
import { joinOptions, UNDECIDED } from "../events/participants";
import { useCreateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, SelectField, StatusField } from "./fields";

/**
 * "Add someone": the choice of a runner first, then of one of the formats where
 * they are not yet (and "Not decided yet", as for "I'm in"), then of a status.
 * A runner who has nothing left to choose is not offered. The runner has to
 * confirm it themselves later (unless it is the member's own).
 */
export function AddSomeoneDialog({
  open,
  onClose,
  view,
}: {
  open: boolean;
  onClose: () => void;
  view: EventView;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.participation.addSomeoneTitle}>
      <AddSomeoneForm view={view} onClose={onClose} />
    </Dialog>
  );
}

function AddSomeoneForm({ view, onClose }: { view: EventView; onClose: () => void }) {
  const { t } = useI18n();
  const runners = useRunners();
  const create = useCreateParticipation(view.event.id);

  const [chosenRunner, setChosenRunner] = useState("");
  const [formatId, setFormatId] = useState("");
  const [status, setStatus] = useState<Status>("interested");
  const [message, setMessage] = useState<string | null>(null);

  if (runners.isPending) return <output>{t.common.loading}</output>;
  if (runners.isError) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.errors.generic}
        </p>
        <button
          type="button"
          onClick={() => void runners.refetch()}
          disabled={runners.isFetching}
          className={`${SECONDARY} self-start`}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }

  // The runners who still have a format to take, by name.
  const available = runners.data
    .filter((runner) => {
      const { formats, undecided } = joinOptions(view, runner.id);
      return formats.length > 0 || undecided;
    })
    .toSorted((a, b) => a.name.localeCompare(b.name));
  // The page may load a change while the dialog is open: a runner who is not offered any more is not chosen any more.
  const runnerId = available.some((runner) => runner.id === chosenRunner) ? chosenRunner : "";
  const options = runnerId === "" ? undefined : joinOptions(view, runnerId);
  // The same for the format: it is one of those of this runner, the first by default.
  const firstFormat = options?.formats[0]?.format.id ?? "";
  const formatOffered =
    options !== undefined &&
    ((formatId === UNDECIDED && options.undecided) ||
      options.formats.some(({ format }) => format.id === formatId));
  const chosenFormat = formatOffered ? formatId : firstFormat;
  const noFormat = chosenFormat === UNDECIDED;

  function chooseRunner(id: string) {
    setChosenRunner(id);
    // Each runner starts from the first format that is offered to them.
    setFormatId("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const who = { runner: runnerId, event: view.event.id };
    try {
      await create.mutateAsync(
        noFormat ? { ...who, status: "interested" } : { ...who, format: chosenFormat, status },
      );
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {available.length === 0 ? (
        <p className="text-sm">{t.participation.everyoneThere}</p>
      ) : (
        <>
          <SelectField
            label={t.participation.runner}
            value={runnerId}
            onChange={chooseRunner}
            required
          >
            <option value="" disabled>
              {t.participation.chooseRunner}
            </option>
            {available.map((runner) => (
              <option key={runner.id} value={runner.id}>
                {runner.name}
              </option>
            ))}
          </SelectField>
          {options && (
            <FormatField
              view={view}
              formats={options.formats}
              undecided={options.undecided}
              value={chosenFormat}
              onChange={setFormatId}
            />
          )}
          <StatusField value={status} onChange={setStatus} locked={noFormat} />
        </>
      )}
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
          disabled={create.isPending || available.length === 0}
          className={PRIMARY}
        >
          {create.isPending ? t.auth.saving : t.participation.addSubmit}
        </button>
      </div>
    </form>
  );
}
