import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { BlockTitle } from "../../components/BlockTitle";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { CountdownRing } from "../../components/Dawn";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { webAddress } from "../../lib/url";
import { useToday } from "../../lib/useToday";
import { invalidateEvents, type EventView } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { useUpdateParticipation } from "../participations/api";
import { participationError } from "../participations/errors";
import { todosOf, type TodoRow } from "./registrationTodo";

/**
 * « Inscriptions à faire »: the races the runner of the user is interested in
 * and has not registered for, in the events whose registration is still open,
 * the nearest deadline first. Each row links to the official site, when the
 * event has one, and has « Je suis inscrit ». The block is not there when
 * there is nothing to do. `runnerId` is not known while the runner of the user
 * loads.
 *
 * A row goes away once it is dealt with, and the button that was pressed with
 * it, so the focus is given back to something that stays (a keyboard or screen
 * reader user must not restart from the top of the page): the title of this
 * block while it has other rows, otherwise the title of the page, which the
 * page passes as `pageHeading`. It is done once the row is really gone from
 * the events the block is made of, which is a render after the mutation.
 */
export function RegistrationTodoBlock({
  views,
  runnerId,
  pageHeading,
}: {
  views: EventView[];
  runnerId: string | undefined;
  pageHeading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t } = useI18n();
  const today = useToday();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  const rows = todosOf(views, runnerId, today);

  // The participation that was dealt with last: the focus moves once it is
  // gone. The effect runs again for each one, as the last may be gone already.
  const [dealt, setDealt] = useState<string | null>(null);
  const gone = dealt !== null && !rows.some(({ participation }) => participation.id === dealt);
  useEffect(() => {
    if (dealt !== null && gone) (heading.current ?? pageHeading.current)?.focus();
  }, [dealt, gone, pageHeading]);

  if (rows.length === 0) return null;

  return (
    <section
      aria-labelledby={headingId}
      data-block="registrations"
      className="page-block flex flex-col gap-3"
    >
      <BlockTitle ref={heading} id={headingId} tabIndex={-1}>
        {t.home.todoTitle}
      </BlockTitle>
      <ul className="race-list flex flex-col gap-3">
        {rows.map((row) => (
          <TodoItem key={row.participation.id} row={row} onDealtWith={setDealt} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One registration to do: the event (a link to its page), the format (or
 * « Format à choisir »), the deadline and the days left, in words.
 *
 * « Je suis inscrit » changes the status to « Inscrit »; it is for a format
 * only, as a participation on the event alone has no format to be registered
 * on (the page of the event is where it is chosen). It is off while the
 * request is on its way, so that a second tap cannot send it twice.
 *
 * A request that fails may fail because the screen is out of date (the
 * participation has been deleted by somebody else): the events are asked for
 * again, and the buttons stay off until they have answered. If the row is
 * gone then, the block is told, as for a success; if it is still there, the
 * button that was pressed gets its focus back (the browser dropped it when the
 * button was disabled), unless the user has moved to something else meanwhile.
 */
function TodoItem({
  row,
  onDealtWith,
}: {
  row: TodoRow;
  onDealtWith: (participationId: string) => void;
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const titleId = useId();
  const { view, formatView, participation, deadline, daysLeft } = row;
  const { event } = view;
  const update = useUpdateParticipation(event.id);
  const [refreshing, setRefreshing] = useState(false);
  const busy = update.isPending || refreshing;
  const site = webAddress(event.registration_url);
  const what = formatView
    ? formatDisplayName(formatView.format, formatView.raceType.label, f, t)
    : t.event.formatToChoose;

  const pressed = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (busy) return;
    const button = pressed.current;
    pressed.current = null;
    if (button?.isConnected && document.activeElement === document.body) button.focus();
  }, [busy]);

  // The mutation lasts until the events have their new data, so this row may
  // be gone when it settles: only the block is called then.
  async function registered() {
    try {
      await update.mutateAsync({ id: participation.id, patch: { status: "registered" } });
    } catch (err) {
      toast.show(participationError(t, err));
      setRefreshing(true);
      try {
        await invalidateEvents(queryClient, event.id);
      } finally {
        setRefreshing(false);
      }
    }
    onDealtWith(participation.id);
  }

  return (
    <li className="todo-row card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <h3 id={titleId} className="card-title">
            <Link
              to="/evenements/$id"
              params={{ id: event.id }}
              className="flex min-h-11 items-center underline-offset-4 hover:text-iris-700 hover:underline"
            >
              {event.name}
            </Link>
          </h3>
          <p className="text-sm">{what}</p>
          <p className="text-sm text-neutral-600">{t.home.todoBefore(f.date(deadline))}</p>
        </div>
        {/* The words are the countdown: nothing here is told by a colour. The ring only shows it. */}
        <div className="todo-countdown flex shrink-0 flex-col items-center gap-1 pt-1">
          <CountdownRing days={daysLeft} />
          <p className="days-left text-xs font-semibold text-neutral-700">{f.inDays(daysLeft)}</p>
        </div>
      </div>
      {(site || formatView) && (
        // The name of the event describes the actions, which the rows repeat.
        <div className="flex flex-wrap gap-2">
          {site && (
            <a
              href={site}
              target="_blank"
              rel="noopener noreferrer"
              aria-describedby={titleId}
              className={`${PRIMARY} inline-flex items-center`}
            >
              {t.home.todoRegister}
            </a>
          )}
          {formatView && (
            <button
              type="button"
              disabled={busy}
              aria-describedby={titleId}
              onClick={(click) => {
                pressed.current = click.currentTarget;
                void registered();
              }}
              className={`${SECONDARY} disabled:opacity-60`}
            >
              {t.home.todoDone}
            </button>
          )}
        </div>
      )}
    </li>
  );
}
