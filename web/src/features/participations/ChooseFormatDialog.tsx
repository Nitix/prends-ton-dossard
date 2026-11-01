import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import type { EventView, ParticipationView } from "../events/api";
import { useUpdateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, StatusField } from "./fields";

/**
 * "Pick the format": gives a format, and a status, to a participation that is
 * on the event alone. All the formats of the event are offered: the runner is
 * on none of them, which the server requires of a participation with no format.
 * The participation then moves to its format, and the status can be more than
 * « Interested ».
 */
export function ChooseFormatDialog({
  open,
  onClose,
  onChosen,
  view,
  participationView,
}: {
  open: boolean;
  onClose: () => void;
  /** The format has been given and saved, just before `onClose`: the row is about to move to its format. */
  onChosen?: () => void;
  view: EventView;
  participationView: ParticipationView;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.participation.chooseFormatTitle}>
      <ChooseForm
        view={view}
        participationView={participationView}
        onClose={onClose}
        onChosen={onChosen}
      />
    </Dialog>
  );
}

function ChooseForm({
  view,
  participationView,
  onClose,
  onChosen,
}: {
  view: EventView;
  participationView: ParticipationView;
  onClose: () => void;
  onChosen?: () => void;
}) {
  const { t } = useI18n();
  const update = useUpdateParticipation(view.event.id);
  const { participation, runner } = participationView;

  const [formatId, setFormatId] = useState(view.formats[0]?.format.id ?? "");
  const [status, setStatus] = useState<Status>(participation.status);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await update.mutateAsync({ id: participation.id, patch: { format: formatId, status } });
    } catch (err) {
      setMessage(participationError(t, err));
      return;
    }
    onChosen?.();
    onClose();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="font-medium break-words">{runner.name}</p>
      <FormatField view={view} formats={view.formats} value={formatId} onChange={setFormatId} />
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
        <button type="submit" disabled={update.isPending} className={PRIMARY}>
          {update.isPending ? t.auth.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
