import { useId, useState, type FormEvent } from "react";

import { DANGER, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationRecord, RunnerRecord, Status } from "../../lib/types";
import { STATUSES, useDeleteParticipation, useUpdateParticipation } from "./api";
import { participationError } from "./errors";

const ITEM =
  "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-neutral-100";

/**
 * The actions on a participation: change its status, confirm it, remove it.
 * It is a menu of the browser (the Popover API): the button opens it, and it
 * closes with Esc, with a click outside, and with a click on one of its
 * actions, with no script. Removing asks first, in a dialog.
 *
 * Who may do what is the page's call: it only shows this to those who may
 * edit the participation, and passes `canConfirm` for the runner it is about.
 */
export function ParticipationMenu({
  eventId,
  participation,
  runner,
  formatLabel,
  canConfirm,
}: {
  /** The event of the participation: its page is refreshed after each change. */
  eventId: string;
  participation: ParticipationRecord;
  runner: RunnerRecord;
  /** The name of the format, for the dialog that asks to confirm the removal. */
  formatLabel: string;
  canConfirm: boolean;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const menuId = useId();
  const update = useUpdateParticipation(eventId);
  const [removing, setRemoving] = useState(false);

  async function change(patch: { status?: Status; confirmed?: true }) {
    try {
      await update.mutateAsync({ id: participation.id, patch });
    } catch (err) {
      toast.show(participationError(t, err));
    }
  }

  return (
    <>
      <button
        type="button"
        popoverTarget={menuId}
        aria-label={t.participation.actionsFor(runner.name)}
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none hover:bg-neutral-100"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {/* No `display` class here: it would override the browser's `display: none` of a closed popover. */}
      <div
        id={menuId}
        popover="auto"
        className="menu-popover rounded-lg border border-neutral-200 bg-white p-1 shadow-lg"
      >
        <ul aria-label={t.participation.status}>
          {STATUSES.map((status) => {
            const current = status === participation.status;
            return (
              <li key={status}>
                <button
                  type="button"
                  popoverTarget={menuId}
                  popoverTargetAction="hide"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    if (!current) void change({ status });
                  }}
                  className={`${ITEM} ${current ? "font-semibold" : ""}`}
                >
                  {/* The current status is not told by the weight of the text alone. */}
                  <span aria-hidden="true" className="w-4 text-center">
                    {current ? "✓" : ""}
                  </span>
                  {t.status[status]}
                </button>
              </li>
            );
          })}
        </ul>
        <ul className="mt-1 border-t border-neutral-200 pt-1">
          {canConfirm && !participation.confirmed && (
            <li>
              <button
                type="button"
                popoverTarget={menuId}
                popoverTargetAction="hide"
                onClick={() => void change({ confirmed: true })}
                className={ITEM}
              >
                {t.common.confirm}
              </button>
            </li>
          )}
          <li>
            <button
              type="button"
              popoverTarget={menuId}
              popoverTargetAction="hide"
              onClick={() => {
                setRemoving(true);
              }}
              className={`${ITEM} text-red-700`}
            >
              {t.common.remove}
            </button>
          </li>
        </ul>
      </div>
      <Dialog
        open={removing}
        onClose={() => {
          setRemoving(false);
        }}
        title={t.participation.removeTitle}
      >
        <RemoveForm
          eventId={eventId}
          participation={participation}
          runner={runner}
          formatLabel={formatLabel}
          onClose={() => {
            setRemoving(false);
          }}
        />
      </Dialog>
    </>
  );
}

function RemoveForm({
  eventId,
  participation,
  runner,
  formatLabel,
  onClose,
}: {
  eventId: string;
  participation: ParticipationRecord;
  runner: RunnerRecord;
  formatLabel: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteParticipation(eventId);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await remove.mutateAsync(participation.id);
      onClose();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p>{t.participation.removeWarning(runner.name, formatLabel)}</p>
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
          {t.common.remove}
        </button>
      </div>
    </form>
  );
}
