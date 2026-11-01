import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import { invalidateEvents } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { useDeleteParticipation, useUpdateParticipation } from "../participations/api";
import { isNotFound, participationError } from "../participations/errors";
import { PENDING_KEY, pendingOf, usePending, type PendingView } from "./pending";

const SEPARATOR = " · ";

/**
 * « À confirmer »: the participations that somebody else added for the user,
 * who agrees (Confirmer) or refuses (Retirer, which deletes it at once: the
 * participation is not the user's yet). The block is not there when there is
 * nothing to confirm. A race that « Résultats à saisir » shows is not here too
 * (see `pendingOf`): it would be on the page twice, with five buttons.
 *
 * A row goes away once it is dealt with, and the button that was pressed with
 * it, so the focus is given back to something that stays (a keyboard or screen
 * reader user must not restart from the top of the page): the title of this
 * block while it has other rows, otherwise the title of the page, which the
 * page passes as `pageHeading`.
 */
export function PendingConfirmations({
  pageHeading,
}: {
  pageHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useI18n();
  const today = useToday();
  const query = usePending();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const [handled, setHandled] = useState(0);

  // Once the row is gone and the block has its new rows (or has gone too).
  useEffect(() => {
    if (handled > 0) (heading.current ?? pageHeading.current)?.focus();
  }, [handled, pageHeading]);

  // A refresh that fails keeps the rows the block already shows.
  if (query.isError && !query.data) {
    return (
      <div className="flex flex-col gap-3">
        <p role="alert" className="text-sm font-medium text-red-700">
          {t.errors.generic}
        </p>
        <button
          type="button"
          onClick={() => void query.refetch()}
          disabled={query.isFetching}
          className={`${SECONDARY} self-start disabled:opacity-60`}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }
  const rows = pendingOf(query.data ?? [], today);
  if (rows.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 ref={heading} id={headingId} tabIndex={-1} className="text-lg font-semibold">
        {t.home.pendingTitle}
      </h2>
      <ul className="flex flex-col gap-3">
        {rows.map((view) => (
          <PendingRow
            key={view.participation.id}
            view={view}
            onDealtWith={() => {
              setHandled((count) => count + 1);
            }}
          />
        ))}
      </ul>
    </section>
  );
}

/**
 * One participation to confirm. Dashed, like every participation that is not
 * confirmed, and said in words by the title of the block and the sentence.
 * A participation on a format names the format, and has the day of the format;
 * one on the event alone names the event, has the start of the event, and says
 * « Format à choisir » on its own line (« Supporteur » for a supporter, who has
 * no format to choose).
 * Both buttons are off while a request of the row is on its way, so that a
 * second tap cannot send it twice.
 *
 * A request that fails may fail because the screen is out of date (the
 * participation has been deleted, or changed, by somebody else): the lists are
 * asked for again, so that the row goes away if it has to, and the buttons
 * stay off until they have answered. Taking a participation back that is
 * already gone is not a failure: it is what was asked for.
 *
 * Where the focus goes after a failure, so that it never falls to the page's
 * <body>: if the lists no longer have the row, the block is told, as for a
 * success (the button went with the row); if the row is still there, the button
 * that was pressed gets its focus back (the browser dropped it when the button
 * was disabled), unless the user has moved to something else meanwhile.
 */
function PendingRow({ view, onDealtWith }: { view: PendingView; onDealtWith: () => void }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const { participation, addedBy, event, format, raceType, date } = view;
  const queryClient = useQueryClient();
  const update = useUpdateParticipation(event.id);
  const remove = useDeleteParticipation(event.id);
  const [refreshing, setRefreshing] = useState(false);
  const busy = update.isPending || remove.isPending || refreshing;

  // The button that was pressed, until the buttons are back. A disabled button
  // cannot have the focus: the browser moves it to the body.
  const pressed = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (busy) return;
    const button = pressed.current;
    pressed.current = null;
    if (button?.isConnected && document.activeElement === document.body) button.focus();
  }, [busy]);
  // What the participation is on: its format, or the event when it has none yet.
  const subject = format && raceType ? formatDisplayName(format, raceType.label, f, t) : event.name;

  // After a failure, what the screen shows may be what is wrong. Resolves once
  // the lists have their new data, as a mutation that succeeds does.
  async function refresh() {
    setRefreshing(true);
    try {
      await invalidateEvents(queryClient, event.id);
    } finally {
      setRefreshing(false);
    }
  }

  /** After a failure: the lists are fresh, and the focus goes where it stays if the row is gone. */
  async function refreshAfterFailure() {
    await refresh();
    const rows = queryClient.getQueryData<PendingView[]>(PENDING_KEY);
    if (!rows?.some((row) => row.participation.id === participation.id)) onDealtWith();
  }

  // The mutations last until the lists have their new data, so this row may be
  // gone when they settle: only the toast and the block are called then.
  async function confirm() {
    try {
      await update.mutateAsync({ id: participation.id, patch: { confirmed: true } });
    } catch (err) {
      toast.show(participationError(t, err));
      await refreshAfterFailure();
      return;
    }
    toast.show(t.home.confirmed);
    onDealtWith();
  }

  async function refuse() {
    try {
      await remove.mutateAsync(participation.id);
    } catch (err) {
      if (!isNotFound(err)) {
        toast.show(participationError(t, err));
        await refreshAfterFailure();
        return;
      }
      // Already gone: the same end as a removal that went through.
      await refresh();
    }
    toast.show(t.home.removed);
    onDealtWith();
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border-2 border-dashed border-neutral-400 bg-white p-3">
      <div className="flex flex-col">
        <h3 className="text-base font-semibold">
          <Link
            to="/evenements/$id"
            params={{ id: event.id }}
            className="flex min-h-11 items-center underline-offset-2 hover:underline"
          >
            {event.name}
          </Link>
        </h3>
        <p className="text-sm text-neutral-600">{f.date(date)}</p>
        <p className="text-sm">
          {addedBy
            ? t.home.addedYou(addedBy.name, subject)
            : `${subject}${SEPARATOR}${t.event.unconfirmed}`}
        </p>
        {/* On the event alone, the participation says in words what it is: a supporter has no format to pick. */}
        {!format && (
          <p className="text-sm">
            {participation.status === "supporter" ? t.status.supporter : t.event.formatToChoose}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-label={t.home.confirmFor(event.name)}
          onClick={(click) => {
            pressed.current = click.currentTarget;
            void confirm();
          }}
          className={PRIMARY}
        >
          {t.common.confirm}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={t.home.removeFor(event.name)}
          onClick={(click) => {
            pressed.current = click.currentTarget;
            void refuse();
          }}
          className={`${SECONDARY} disabled:opacity-60`}
        >
          {t.common.remove}
        </button>
      </div>
    </li>
  );
}
