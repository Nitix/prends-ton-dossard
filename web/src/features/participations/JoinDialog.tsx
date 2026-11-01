import { useState, type FormEvent } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationRecord, Status } from "../../lib/types";
import type { EventView } from "../events/api";
import { useCreateParticipation, useUpdateParticipation } from "./api";
import { participationError } from "./errors";
import { FormatField, StatusField } from "./fields";
import type { Me } from "./permissions";

/**
 * "I'm in": the choice of the format and of the status of the participation
 * of the signed-in member in this event. Where they are on the event already,
 * the dialog changes that participation (so does it confirm it, if somebody
 * else had added them); where they are not, it creates one.
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

/** The participation of the runner in the event: the first, in the order of the days, if they are on several formats. */
function findParticipation(view: EventView, runnerId: string): ParticipationRecord | undefined {
  for (const { participations } of view.formats) {
    const found = participations.find(({ runner }) => runner.id === runnerId);
    if (found) return found.participation;
  }
  return undefined;
}

function JoinForm({ view, me, onClose }: { view: EventView; me: Me; onClose: () => void }) {
  const { t } = useI18n();
  const create = useCreateParticipation(view.event.id);
  const update = useUpdateParticipation(view.event.id);

  // Whether this changes a participation or creates one, and what it can
  // choose from, is settled when the dialog opens. Once saved, the page loads
  // the new participation before the dialog closes: the form must not turn
  // into the one of a participation that has just been created.
  const [mine] = useState(() => findParticipation(view, me.runnerId));
  // The formats where the runner is not already: the server refuses a second
  // participation on a format.
  const [formats] = useState(() =>
    view.formats.filter(
      ({ format, participations }) =>
        format.id === mine?.format ||
        !participations.some(({ runner }) => runner.id === me.runnerId),
    ),
  );

  const [formatId, setFormatId] = useState(mine?.format ?? formats[0]?.format.id ?? "");
  const [status, setStatus] = useState<Status>(mine?.status ?? "interested");
  const [message, setMessage] = useState<string | null>(null);
  const pending = create.isPending || update.isPending;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      if (mine) {
        // A change made by the runner confirms the participation by itself;
        // saying so is just as clear, and does not depend on that.
        const confirm = mine.confirmed ? {} : { confirmed: true as const };
        await update.mutateAsync({ id: mine.id, patch: { status, format: formatId, ...confirm } });
      } else {
        await create.mutateAsync({
          runner: me.runnerId,
          event: view.event.id,
          format: formatId,
          status,
        });
      }
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {mine && <p className="text-sm text-neutral-600">{t.participation.alreadyIn}</p>}
      <FormatField view={view} formats={formats} value={formatId} onChange={setFormatId} />
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
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t.auth.saving : t.common.save}
        </button>
      </div>
    </form>
  );
}
