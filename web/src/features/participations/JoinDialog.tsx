import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationRecord, Status } from "../../lib/types";
import type { EventView } from "../events/api";
import { joinOptions, SUPPORT } from "../events/participants";
import { useCreateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, noFormatChoice, StatusField } from "./fields";
import type { Me } from "./permissions";

/**
 * "I'm in": the choice of the format and of the status of a new participation
 * of the signed-in member in this event. One participation per submit: for a
 * second format, the dialog is opened again. Each participation is changed
 * from its own row, so the dialog never changes one.
 *
 * "Not decided yet" puts the member on the event alone, with no format: the
 * status is then « Intéressé », which the field says. "I'm coming to cheer"
 * does too, as a supporter: the status is then « Supporteur », which the
 * field says as well.
 *
 * Once the participation is saved, `onJoined` is given it, then the dialog
 * closes: the button that opened it may be gone with the last format to take,
 * and the page puts the focus where the new participation is.
 */
export function JoinDialog({
  open,
  onClose,
  onJoined,
  view,
  me,
}: {
  open: boolean;
  onClose: () => void;
  onJoined?: (created: ParticipationRecord) => void;
  view: EventView;
  me: Me;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.participation.joinTitle}>
      <JoinForm view={view} me={me} onClose={onClose} onJoined={onJoined} />
    </Dialog>
  );
}

function JoinForm({
  view,
  me,
  onClose,
  onJoined,
}: {
  view: EventView;
  me: Me;
  onClose: () => void;
  onJoined?: (created: ParticipationRecord) => void;
}) {
  const { t } = useI18n();
  const create = useCreateParticipation(view.event.id);

  // What the runner can choose from is settled when the dialog opens. Once
  // saved, the page loads the new participation before the dialog closes: the
  // form must not lose the format that has just been taken.
  const [{ formats, undecided, support }] = useState(() => joinOptions(view, me.runnerId));

  // The first format; an event with none leaves the supporter's choice alone.
  const [formatId, setFormatId] = useState(formats[0]?.format.id ?? (support ? SUPPORT : ""));
  const [status, setStatus] = useState<Status>("interested");
  const [message, setMessage] = useState<string | null>(null);
  // « Pas encore décidé » and « Je viens encourager » are on the event alone, with a status that is not a choice.
  const alone = noFormatChoice(formatId);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const who = { runner: me.runnerId, event: view.event.id };
    try {
      const created = await create.mutateAsync(
        alone ? { ...who, status: alone.status } : { ...who, format: formatId, status },
      );
      onJoined?.(created);
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
        support={support ? t.participation.support : undefined}
        value={formatId}
        onChange={setFormatId}
      />
      <StatusField value={status} onChange={setStatus} locked={alone?.lock} />
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
