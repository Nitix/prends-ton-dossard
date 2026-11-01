import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { Status } from "../../lib/types";
import type { EventView } from "../events/api";
import { joinOptions, UNDECIDED } from "../events/participants";
import { useCreateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, StatusField } from "./fields";
import type { Me } from "./permissions";

/**
 * "I'm in": the choice of the format and of the status of a new participation
 * of the signed-in member in this event. One participation per submit: for a
 * second format, the dialog is opened again. Each participation is changed
 * from its own row, so the dialog never changes one.
 *
 * "Not decided yet" puts the member on the event alone, with no format: the
 * status is then « Intéressé », which the field says.
 */
export function JoinDialog({
  open,
  onClose,
  view,
  me,
}: {
  open: boolean;
  onClose: () => void;
  view: EventView;
  me: Me;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.participation.joinTitle}>
      <JoinForm view={view} me={me} onClose={onClose} />
    </Dialog>
  );
}

function JoinForm({ view, me, onClose }: { view: EventView; me: Me; onClose: () => void }) {
  const { t } = useI18n();
  const create = useCreateParticipation(view.event.id);

  // What the runner can choose from is settled when the dialog opens. Once
  // saved, the page loads the new participation before the dialog closes: the
  // form must not lose the format that has just been taken.
  const [{ formats, undecided }] = useState(() => joinOptions(view, me.runnerId));

  const [formatId, setFormatId] = useState(formats[0]?.format.id ?? "");
  const [status, setStatus] = useState<Status>("interested");
  const [message, setMessage] = useState<string | null>(null);
  const noFormat = formatId === UNDECIDED;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const who = { runner: me.runnerId, event: view.event.id };
    try {
      await create.mutateAsync(
        noFormat ? { ...who, status: "interested" } : { ...who, format: formatId, status },
      );
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <FormatField
        view={view}
        formats={formats}
        undecided={undecided}
        value={formatId}
        onChange={setFormatId}
      />
      <StatusField value={status} onChange={setStatus} locked={noFormat} />
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={create.isPending} className={PRIMARY}>
          {create.isPending ? t.auth.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
