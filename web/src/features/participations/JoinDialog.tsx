import { useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import { raceStarted } from "../../lib/dates";
import type { ParticipationRecord, Status } from "../../lib/types";
import { useToday } from "../../lib/useToday";
import type { EventView } from "../events/api";
import { joinOptions, SUPPORT } from "../events/participants";
import { allowedStatus, useCreateParticipation } from "./api";
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
 * and the page puts the focus where the new participation is. While it is on
 * its way, the button says it is busy and is not disabled (it would lose the
 * focus, and a refusal that is not about a field would not give it back); a
 * second tap is ignored.
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
  const today = useToday();
  const create = useCreateParticipation(view.event.id);

  // What the runner can choose from is settled when the dialog opens. Once
  // saved, the page loads the new participation before the dialog closes: the
  // form must not lose the format that has just been taken.
  const [{ formats, undecided, support }] = useState(() => joinOptions(view, me.runnerId));

  // The first format; an event with none leaves the supporter's choice alone.
  const [formatId, setFormatId] = useState(formats[0]?.format.id ?? (support ? SUPPORT : ""));
  const [status, setStatus] = useState<Status>("interested");
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);
  // « Pas encore décidé » and « Je viens encourager » are on the event alone, with a status that is not a choice.
  const alone = noFormatChoice(formatId);
  // Nobody finishes a race, or gives up on it, before its day: the status goes
  // back to « Intéressé » when the format chosen has not started.
  const picked = formats.find(({ format }) => format.id === formatId);
  const started = picked !== undefined && raceStarted(picked.format, view.event, today);
  const chosenStatus = allowedStatus(status, started);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    const who = { runner: me.runnerId, event: view.event.id };
    try {
      const created = await create.mutateAsync(
        alone
          ? { ...who, status: alone.status }
          : { ...who, format: formatId, status: chosenStatus },
      );
      onJoined?.(created);
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    } finally {
      sending.current = false;
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
      <StatusField
        value={chosenStatus}
        onChange={setStatus}
        started={started}
        locked={alone?.lock}
      />
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
          aria-disabled={create.isPending || undefined}
          className={`${PRIMARY} ${create.isPending ? "opacity-60" : ""}`}
        >
          {create.isPending ? t.auth.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
