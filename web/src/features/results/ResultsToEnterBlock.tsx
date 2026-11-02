import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState, type RefObject } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { SectionMarker } from "../../components/Slots";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";
import { useToday } from "../../lib/useToday";
import { useSession } from "../auth/session";
import { invalidateEvents } from "../events/api";
import { formatDisplayName } from "../events/formatName";
import { useUpdateParticipation } from "../participations/api";
import { participationError } from "../participations/errors";
import { ResultDialog } from "./ResultDialog";
import {
  RESULTS_EXPAND,
  RESULTS_TO_ENTER_KEY,
  toEnterOf,
  toEnterRow,
  type RegisteredRecord,
  type ToEnter,
} from "./resultsToEnter";

/**
 * The participations of the signed-in user that are « Registered », with what
 * they are on. The events of the home page are the ones to come: the races that
 * are over are not among them, hence a request of its own. Not all of them are
 * to enter (see `toEnterOf`, which also knows the day). The changes of a
 * participation ask for it again (`invalidateEvents` refreshes it).
 */
function useRegistered(): UseQueryResult<ToEnter[]> {
  const { user } = useSession();
  const userId = user?.id ?? "";

  return useQuery({
    queryKey: RESULTS_TO_ENTER_KEY,
    queryFn: async () =>
      (
        await pb.collection("participations").getFullList<RegisteredRecord>({
          // `user` is the account of the runner: these are the runners of the user.
          filter: pb.filter('runner.user = {:me} && status = "registered"', { me: userId }),
          expand: RESULTS_EXPAND,
        })
      ).map(toEnterRow),
    enabled: userId !== "",
  });
}

/**
 * « Résultats à saisir »: the races the user has registered for and that are
 * over (for 60 days at most), the latest first, with what to say of each: « I
 * finished » (the window of the result), « Did not finish » and « Did not
 * start » (the status changes at once). The block is not there when there is
 * nothing to enter, nor while the rows load or when they fail to: it is not
 * worth a message, the races are on the page of their event all the same.
 *
 * A row goes away once it is dealt with, and the button that was pressed with
 * it, so the focus is given back to something that stays (a keyboard or screen
 * reader user must not restart from the top of the page): the title of this
 * block while it has other rows, otherwise the title of the page, which the
 * page passes as `pageHeading`. It is done once the row is really gone from
 * the rows of the block, which is a render after the request.
 */
export function ResultsToEnter({ pageHeading }: { pageHeading: RefObject<HTMLElement | null> }) {
  const { t } = useI18n();
  const today = useToday();
  const query = useRegistered();
  const headingId = useId();
  const heading = useRef<HTMLHeadingElement>(null);
  // A refresh that fails keeps the rows the block already has.
  const rows = toEnterOf(query.data ?? [], today);

  // The participation that was dealt with last: the focus moves once it is
  // gone. The effect runs again for each one, as the last may be gone already.
  const [dealt, setDealt] = useState<string | null>(null);
  const gone = dealt !== null && !rows.some(({ participation }) => participation.id === dealt);
  useEffect(() => {
    if (dealt !== null && gone) (heading.current ?? pageHeading.current)?.focus();
  }, [dealt, gone, pageHeading]);

  if (rows.length === 0) return null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 ref={heading} id={headingId} tabIndex={-1} className="block-title section-title">
        <SectionMarker />
        {t.results.toEnterTitle}
      </h2>
      <ul className="flex flex-col gap-3">
        {rows.map((row) => (
          <ResultRow key={row.participation.id} row={row} onDealtWith={setDealt} />
        ))}
      </ul>
    </section>
  );
}

/**
 * One race to say something of: the event (a link to its page), the race and
 * its day, and three buttons. « I finished » opens the window of the result,
 * which starts from « Finished »; the two others send the status (« Did not
 * finish », « Did not start ») and nothing else.
 *
 * The buttons say they are busy while a request of the row is on its way
 * (`aria-disabled`), and are never `disabled`: they would lose the focus, and
 * a request that fails would not give it back. A second tap, which can come
 * before the page has drawn the busy state, is ignored. The name of the event
 * describes them, as the rows repeat them.
 *
 * A request that fails may fail because the screen is out of date (the
 * participation has been deleted by somebody else): the rows are asked for
 * again. The block is told the row has been dealt with either way, and moves
 * the focus if the row is gone then; if it is still there, the button that was
 * pressed still has it.
 *
 * The window of the result is in the row, so that it goes away with it. When
 * it is cancelled, or leaves the row where it is, « I finished » gets the
 * focus back (a browser that does not focus a button on a tap would not).
 */
function ResultRow({
  row,
  onDealtWith,
}: {
  row: ToEnter;
  onDealtWith: (participationId: string) => void;
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const titleId = useId();
  const { participation, event, format, raceType, date } = row;
  const update = useUpdateParticipation(event.id);
  const [refreshing, setRefreshing] = useState(false);
  const [opened, setOpened] = useState(false);
  const busy = update.isPending || refreshing;
  // Set on the spot: the state of a mutation is there after a render only, and two taps can come before it.
  const sending = useRef(false);

  const finished = useRef<HTMLButtonElement>(null);
  const dismissed = useRef(false);
  useEffect(() => {
    if (opened || !dismissed.current) return;
    dismissed.current = false;
    finished.current?.focus();
  }, [opened]);
  const closeDialog = () => {
    dismissed.current = true;
    setOpened(false);
  };

  async function send(status: "dnf" | "dns") {
    if (sending.current) return;
    sending.current = true;
    try {
      await update.mutateAsync({ id: participation.id, patch: { status } });
    } catch (err) {
      toast.show(participationError(t, err));
      setRefreshing(true);
      try {
        await invalidateEvents(queryClient, event.id);
      } finally {
        setRefreshing(false);
      }
    } finally {
      sending.current = false;
    }
    // The mutation lasts until the rows have their new data, so this row may be gone: only the block is called then.
    onDealtWith(participation.id);
  }

  const busyClass = busy ? "opacity-60" : "";

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex flex-col">
        <h3 id={titleId} className="card-title">
          <Link
            to="/evenements/$id"
            params={{ id: event.id }}
            className="flex min-h-11 items-center underline-offset-4 hover:text-iris-700 hover:underline"
          >
            {event.name}
          </Link>
        </h3>
        <p className="text-sm">{formatDisplayName(format, raceType.label, f, t)}</p>
        <p className="text-sm text-neutral-600">{f.date(date)}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          ref={finished}
          type="button"
          aria-disabled={busy || undefined}
          aria-describedby={titleId}
          onClick={() => {
            if (!sending.current) setOpened(true);
          }}
          className={`${PRIMARY} ${busyClass}`}
        >
          {t.results.finished}
        </button>
        <button
          type="button"
          aria-disabled={busy || undefined}
          aria-describedby={titleId}
          onClick={() => void send("dnf")}
          className={`${SECONDARY} ${busyClass}`}
        >
          {t.results.dnf}
        </button>
        <button
          type="button"
          aria-disabled={busy || undefined}
          aria-describedby={titleId}
          onClick={() => void send("dns")}
          className={`${SECONDARY} ${busyClass}`}
        >
          {t.results.dns}
        </button>
      </div>
      <ResultDialog
        open={opened}
        onClose={closeDialog}
        onSaved={() => {
          closeDialog();
          onDealtWith(participation.id);
        }}
        onGone={() => {
          closeDialog();
          onDealtWith(participation.id);
        }}
        eventId={event.id}
        participation={participation}
        initialStatus="finished"
        // Its race is over: that is what puts it in this list.
        started
      />
    </li>
  );
}
