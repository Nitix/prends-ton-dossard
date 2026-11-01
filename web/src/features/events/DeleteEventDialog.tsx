import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState, type FormEvent } from "react";

import { DANGER, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { describeError } from "../profile/forms";
import { useDeleteEvent, type EventView } from "./api";

/**
 * Asks before deleting an event, and says who is concerned: the server deletes
 * its formats and their participations with it. Once deleted, goes to the list.
 */
export function DeleteEventDialog({
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
    <Dialog open={open} onClose={onClose} title={t.event.deleteTitle}>
      <DeleteForm view={view} onClose={onClose} />
    </Dialog>
  );
}

/**
 * The runners who have a participation in the event, each once, by name: on a
 * format, or on the event alone (interested, or supporter), whatever the status
 * (those who do not start too: the server deletes every participation of the
 * event).
 */
function participantNames(view: EventView): string[] {
  const names = new Map<string, string>();
  const lists = [
    view.interested,
    view.supporters,
    ...view.formats.map(({ participations }) => participations),
  ];
  for (const participations of lists) {
    for (const { runner } of participations) names.set(runner.id, runner.name);
  }
  return [...names.values()].toSorted((a, b) => a.localeCompare(b));
}

function DeleteForm({ view, onClose }: { view: EventView; onClose: () => void }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const remove = useDeleteEvent(view.event.id);
  const [message, setMessage] = useState<string | null>(null);
  const names = participantNames(view);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await remove.mutateAsync();
    } catch (err) {
      setMessage(describeError(t, err));
      return;
    }
    toast.show(t.event.deleted);
    // Leave the page first: it would ask for the event again, and be told it is gone.
    await navigate({ to: "/liste" });
    queryClient.removeQueries({ queryKey: ["event", view.event.id] });
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p>{t.event.deleteWarning(view.event.name)}</p>
      {names.length > 0 && (
        <p>
          {t.event.deleteParticipants} <strong>{f.list(names)}</strong>
        </p>
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
        <button type="submit" disabled={remove.isPending} className={DANGER}>
          {t.common.delete}
        </button>
      </div>
    </form>
  );
}
