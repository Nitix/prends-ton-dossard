import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import { useRunners, type EventView } from "../events/api";
import { useCreateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, SelectField, StatusField } from "./fields";

/**
 * "Add someone": the choice of a runner, of a format and of a status. The
 * runners who are on the chosen format already are not offered. The runner
 * has to confirm it themselves later (unless it is the member's own).
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

  const [formatId, setFormatId] = useState(view.formats[0]?.format.id ?? "");
  const [chosenRunner, setChosenRunner] = useState("");
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

  const onFormat = view.formats.find(({ format }) => format.id === formatId)?.participations;
  const present = new Set(onFormat?.map(({ runner }) => runner.id));
  const available = runners.data.filter((runner) => !present.has(runner.id));
  // Changing the format may take the chosen runner away: they are not chosen any more.
  const runnerId = available.some((runner) => runner.id === chosenRunner) ? chosenRunner : "";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await create.mutateAsync({
        runner: runnerId,
        event: view.event.id,
        format: formatId,
        status,
      });
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormatField view={view} formats={view.formats} value={formatId} onChange={setFormatId} />
      {available.length === 0 ? (
        <p className="text-sm">{t.participation.everyoneThere}</p>
      ) : (
        <SelectField
          label={t.participation.runner}
          value={runnerId}
          onChange={setChosenRunner}
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
      )}
      <StatusField value={status} onChange={setStatus} />
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
