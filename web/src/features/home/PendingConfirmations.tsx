import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { formatDisplayName } from "../events/formatName";
import { useDeleteParticipation, useUpdateParticipation } from "../participations/api";
import { participationError } from "../participations/errors";
import { usePending, type PendingView } from "./pending";

const SEPARATOR = " · ";

/**
 * « À confirmer »: the participations that somebody else added for the user,
 * who agrees (Confirmer) or refuses (Retirer, which deletes it at once: the
 * participation is not the user's yet). The block is not there when there is
 * nothing to confirm.
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
  const rows = query.data ?? [];
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
 * Both buttons are off while a request of the row is on its way, so that a
 * second tap cannot send it twice.
 */
function PendingRow({ view, onDealtWith }: { view: PendingView; onDealtWith: () => void }) {
  const { t, f } = useI18n();
  const toast = useToast();
  const { participation, addedBy, event, format, raceType, date } = view;
  const update = useUpdateParticipation(event.id);
  const remove = useDeleteParticipation(event.id);
  const busy = update.isPending || remove.isPending;
  const formatName = formatDisplayName(format, raceType.label, f, t);

  // The mutations last until the lists have their new data, so this row may be
  // gone when they settle: only the toast and the block are called then.
  async function confirm() {
    try {
      await update.mutateAsync({ id: participation.id, patch: { confirmed: true } });
    } catch (err) {
      toast.show(participationError(t, err));
      return;
    }
    toast.show(t.home.confirmed);
    onDealtWith();
  }

  async function refuse() {
    try {
      await remove.mutateAsync(participation.id);
    } catch (err) {
      toast.show(participationError(t, err));
      return;
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
            ? t.home.addedYou(addedBy.name, formatName)
            : `${formatName}${SEPARATOR}${t.event.unconfirmed}`}
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          aria-label={t.home.confirmFor(event.name)}
          onClick={() => void confirm()}
          className={PRIMARY}
        >
          {t.common.confirm}
        </button>
        <button
          type="button"
          disabled={busy}
          aria-label={t.home.removeFor(event.name)}
          onClick={() => void refuse()}
          className={`${SECONDARY} disabled:opacity-60`}
        >
          {t.common.remove}
        </button>
      </div>
    </li>
  );
}
