import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { DANGER, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { ParticipationRecord, RunnerRecord, Status } from "../../lib/types";
import { invalidateEvents, type EventView } from "../events/api";
import { EVENT_STATUSES, STATUSES, useDeleteParticipation, useUpdateParticipation } from "./api";
import { ChooseFormatDialog } from "./ChooseFormatDialog";
import { isNotFound, participationError } from "./errors";

const ITEM =
  "flex min-h-11 w-full items-center gap-2 rounded-md px-3 text-left hover:bg-neutral-100";

/** Which dialog the menu has opened, if any. */
type Opened = "remove" | "choose";

/**
 * The actions on a participation: change its status, confirm it, remove it.
 * For a participation on the event alone (`formatsOf`), it offers the two
 * statuses that are possible with no format (« Interested » and
 * « Supporter »), then « Pick the race ». It is a menu of the browser (the
 * Popover API): the button opens it, and it closes with Esc, with a click
 * outside, and with a click on one of its actions, with no script. Removing
 * asks first, in a dialog.
 *
 * Who may do what is the page's call: it only shows this to those who may
 * edit the participation, and passes `canConfirm` for the runner it is about.
 *
 * Where the focus goes (a keyboard or screen reader user must not restart from
 * the top of the page): a status change or a confirmation gives it back to the
 * button of the menu (the browser does, when the popover closes); so does a
 * dialog that is cancelled; and a removal that goes through, like a format that
 * is given or a status that moves the participation to another list (to or
 * from the "did not start" list, or from interested to supporter and back),
 * calls `onRemoved`, since this menu goes away with its row: the page puts the
 * focus somewhere that stays.
 */
export function ParticipationMenu({
  eventId,
  participation,
  runner,
  label,
  formatsOf,
  canConfirm,
  onRemoved,
}: {
  /** The event of the participation: its page is refreshed after each change. */
  eventId: string;
  participation: ParticipationRecord;
  runner: RunnerRecord;
  /** What the participation is on, for the dialog that asks to confirm the removal: its format, or the event when it has none. */
  label: string;
  /** Given for a participation on the event alone: the event, whose formats it can take. */
  formatsOf?: EventView;
  canConfirm: boolean;
  /** The participation has just left its row (removed, moved to another list, or found gone): this menu is about to go away. */
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const menuId = useId();
  const update = useUpdateParticipation(eventId);
  const [opened, setOpened] = useState<Opened | null>(null);

  // A dialog opens from an item of the popover, which closes at the same time.
  // The native dialog would take that item, now hidden, as the place to give
  // the focus back to, and the focus would fall to the page's <body>. So the
  // button of the menu gets it, once the dialog is closed (the effect of the
  // dialog, a child of this component, closes it before this one runs).
  const trigger = useRef<HTMLButtonElement>(null);
  const dismissed = useRef(false);
  useEffect(() => {
    if (opened !== null || !dismissed.current) return;
    dismissed.current = false;
    trigger.current?.focus();
  }, [opened]);
  const dismiss = () => {
    dismissed.current = true;
    setOpened(null);
  };
  const removed = () => {
    setOpened(null);
    onRemoved();
  };

  async function change(patch: { status?: Status; confirmed?: true }) {
    try {
      await update.mutateAsync({ id: participation.id, patch });
    } catch (err) {
      toast.show(participationError(t, err));
      if (isNotFound(err)) {
        // The participation is gone (removed, or given a format by somebody
        // else, which is another row): what the page shows is out of date. It
        // is asked for again, and the row goes, with this menu.
        await invalidateEvents(queryClient, eventId);
        onRemoved();
      }
      return;
    }
    // The page lists those who do not start apart from the others, and the
    // supporters of the event apart from those who are interested in it: the row moves.
    const { status } = patch;
    const moves = formatsOf
      ? status !== participation.status
      : (status === "dns") !== (participation.status === "dns");
    if (status !== undefined && moves) onRemoved();
  }

  return (
    <>
      <button
        ref={trigger}
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
        {/* With no format, only two statuses are possible: the participation is on the event alone. */}
        <ul aria-label={t.participation.status}>
          {(formatsOf ? EVENT_STATUSES : STATUSES).map((status) => {
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
          {formatsOf && (
            <li>
              <button
                type="button"
                popoverTarget={menuId}
                popoverTargetAction="hide"
                onClick={() => {
                  setOpened("choose");
                }}
                className={ITEM}
              >
                {t.participation.chooseFormat}
              </button>
            </li>
          )}
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
                setOpened("remove");
              }}
              className={`${ITEM} text-red-700`}
            >
              {t.common.remove}
            </button>
          </li>
        </ul>
      </div>
      <Dialog open={opened === "remove"} onClose={dismiss} title={t.participation.removeTitle}>
        <RemoveForm
          eventId={eventId}
          participation={participation}
          runner={runner}
          label={label}
          onClose={dismiss}
          onRemoved={removed}
        />
      </Dialog>
      {formatsOf && (
        <ChooseFormatDialog
          open={opened === "choose"}
          onClose={dismiss}
          onChosen={removed}
          view={formatsOf}
          participationView={{ participation, runner }}
        />
      )}
    </>
  );
}

function RemoveForm({
  eventId,
  participation,
  runner,
  label,
  onClose,
  onRemoved,
}: {
  eventId: string;
  participation: ParticipationRecord;
  runner: RunnerRecord;
  label: string;
  onClose: () => void;
  onRemoved: () => void;
}) {
  const { t } = useI18n();
  const remove = useDeleteParticipation(eventId);
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    try {
      await remove.mutateAsync(participation.id);
      onRemoved();
    } catch (err) {
      setMessage(participationError(t, err));
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      <p>{t.participation.removeWarning(runner.name, label)}</p>
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
