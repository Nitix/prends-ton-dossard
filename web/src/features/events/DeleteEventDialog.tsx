import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useRef, useState, type FormEvent } from "react";

import { DANGER, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useComments } from "../comments/api";
import { useOffers } from "../offers/api";
import { describeError } from "../profile/forms";
import { useDeleteEvent, type EventView } from "./api";

/**
 * Asks before deleting an event, and says who is concerned: the server deletes
 * its formats and their participations with it, and the comments and offers of
 * everybody (the places taken in them go too). The warning says so, and the
 * lines under it count them when the page has them (it asks for them with the
 * event). A duplicate is better merged, which keeps them. Once deleted, goes to
 * the list.
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
  const comments = useComments(view.event.id);
  const offers = useOffers(view.event.id);
  const [message, setMessage] = useState<string | null>(null);
  // Set on the spot: the state of the mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);
  const names = participantNames(view);
  // What else is lost, when it is known: the comments and the cars and lodgings, the ones that exist.
  const counts: [number, (n: number) => string][] = [
    [comments.data?.length ?? 0, t.event.deleteCounts.comments],
    [
      offers.data?.filter(({ offer }) => offer.kind === "ride").length ?? 0,
      t.event.deleteCounts.rides,
    ],
    [
      offers.data?.filter(({ offer }) => offer.kind === "lodging").length ?? 0,
      t.event.deleteCounts.lodgings,
    ],
  ];
  const lost = counts.filter(([n]) => n > 0).map(([n, say]) => say(n));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    sending.current = true;
    setMessage(null);
    try {
      await remove.mutateAsync();
    } catch (err) {
      sending.current = false;
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
      {lost.length > 0 && (
        <p>
          {t.event.deleteContents} <strong>{f.list(lost)}</strong>
        </p>
      )}
      {names.length > 0 && (
        <p>
          {t.event.deleteParticipants} <strong>{f.list(names)}</strong>
        </p>
      )}
      <p>{t.event.deleteDuplicate(`${t.nav.admin} > ${t.admin.duplicatesTitle}`)}</p>
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
          aria-disabled={remove.isPending || undefined}
          className={`${DANGER} ${remove.isPending ? "opacity-60" : ""}`}
        >
          {t.common.delete}
        </button>
      </div>
    </form>
  );
}
