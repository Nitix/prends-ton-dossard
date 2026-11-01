import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { raceStarted } from "../../lib/dates";
import type { Status } from "../../lib/types";
import { useToday } from "../../lib/useToday";
import { invalidateEvents, type EventView, type ParticipationView } from "../events/api";
import { allowedStatus, useUpdateParticipation } from "./api";
import { isNotFound, participationError } from "./errors";
import { FormatField, StatusField } from "./fields";

/**
 * "Pick the race": gives a format, and a status, to a participation that is
 * on the event alone (interested, or supporter). All the formats of the event
 * are offered: the runner is on none of them, which the server requires of a
 * participation with no format. The participation then moves to its format,
 * and the status can be more than « Interested ». While it is on its way, the
 * button says it is busy and is not disabled (it would lose the focus); a
 * second tap is ignored.
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
  /**
   * The format has been given and saved, the participation is about to move to
   * its format; or the participation is not there any more (somebody else gave
   * it a format or removed it), and its row is about to go. Called in place of
   * `onClose` (which is then for the user who cancels): a caller who has a row
   * to move has more to do than close.
   */
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
  const toast = useToast();
  const queryClient = useQueryClient();
  const today = useToday();
  const update = useUpdateParticipation(view.event.id);
  const { participation, runner } = participationView;

  const [chosenFormat, setChosenFormat] = useState("");
  // A supporter is not on a format: « Supporteur » is no status of one, the dialog starts from « Intéressé ».
  const [status, setStatus] = useState<Status>(
    participation.status === "supporter" ? "interested" : participation.status,
  );
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);
  // The page may load a change while the dialog is open: a format that is not
  // on the event any more is not chosen any more, the first one is.
  const formatId = view.formats.some(({ format }) => format.id === chosenFormat)
    ? chosenFormat
    : (view.formats[0]?.format.id ?? "");
  // Nobody finishes a race, or gives up on it, before its day: the status goes
  // back to « Intéressé » when the format chosen has not started.
  const picked = view.formats.find(({ format }) => format.id === formatId);
  const started = picked !== undefined && raceStarted(picked.format, view.event, today);
  const chosenStatus = allowedStatus(status, started);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    try {
      await update.mutateAsync({
        id: participation.id,
        patch: { format: formatId, status: chosenStatus },
      });
    } catch (err) {
      if (isNotFound(err)) {
        // The participation is not on the event alone any more (somebody gave
        // it a format, or removed it) or is gone: the dialog is about nothing.
        // It says so in a toast, which stays once the dialog is closed, and
        // the lists are asked for again before it closes, as after a success.
        toast.show(participationError(t, err));
        await invalidateEvents(queryClient, view.event.id);
        (onChosen ?? onClose)();
        return;
      }
      sending.current = false;
      setMessage(participationError(t, err));
      return;
    }
    (onChosen ?? onClose)();
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p className="font-medium break-words">{runner.name}</p>
      <FormatField view={view} formats={view.formats} value={formatId} onChange={setChosenFormat} />
      <StatusField value={chosenStatus} onChange={setStatus} started={started} />
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
          aria-disabled={update.isPending || undefined}
          className={`${PRIMARY} ${update.isPending ? "opacity-60" : ""}`}
        >
          {update.isPending ? t.auth.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
