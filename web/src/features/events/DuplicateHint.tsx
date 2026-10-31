import { keepPreviousData, skipToken, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useI18n } from "../../i18n/I18nProvider";
import { parseDate } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type { EventRecord } from "../../lib/types";
import { duplicateFilter } from "./duplicates";
import { eventLabel } from "./eventLabel";

/** How long the user has to stop typing before the search starts. */
const TYPING_PAUSE_MS = 400;
/** The events to offer: a few are enough to tell whether it is one of them. */
const MAX_SUGGESTIONS = 5;

/** The name and the date, once the user has stopped typing them for a moment. They start as they are, there being nobody typing yet. */
function useSettled(name: string, startDate: string): { name: string; startDate: string } {
  const [settled, setSettled] = useState({ name, startDate });
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSettled({ name, startDate });
    }, TYPING_PAUSE_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [name, startDate]);
  return settled;
}

/** The filter for what is typed, or null when it is too early to look: no word to look for, or no date yet. */
function filterFor(name: string, startDate: string, excludeId: string | undefined): string | null {
  if (startDate === "") return null;
  try {
    return duplicateFilter(name, parseDate(startDate), excludeId);
  } catch (err) {
    // A date the browser lets through and Temporal does not (a year of six digits).
    if (err instanceof RangeError) return null;
    throw err;
  }
}

/**
 * Events that may be the one being typed: those whose name looks alike and
 * that are at about the same date. It looks once the name and the date are
 * filled in and the user has paused, and says nothing when nothing is found
 * or when the search fails: it is a help, never an obstacle. The links open
 * in a new tab, so that what was typed is not lost. `excludeId` is the event
 * being edited.
 */
export function DuplicateHint({
  name,
  startDate,
  excludeId,
}: {
  name: string;
  startDate: string;
  excludeId?: string;
}) {
  const { t, f } = useI18n();
  const settled = useSettled(name, startDate);
  const filter = filterFor(settled.name, settled.startDate, excludeId);

  const { data } = useQuery({
    queryKey: ["duplicates", filter],
    // The list stays while the next one loads, instead of blinking at each pause.
    placeholderData: keepPreviousData,
    queryFn:
      filter === null
        ? skipToken
        : () =>
            pb.collection("events").getList<EventRecord>(1, MAX_SUGGESTIONS, {
              filter,
              sort: "start_date",
              fields: "id,name,location,start_date,end_date",
            }),
  });
  const events = filter === null ? [] : (data?.items ?? []);

  // The region is always there, empty: a screen reader announces what comes into a region that exists.
  return (
    <div aria-live="polite">
      {events.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg border border-amber-300 bg-amber-50 p-3">
          <p className="text-sm font-medium">{t.form.duplicateQuestion}</p>
          <ul className="flex flex-col">
            {events.map((event) => (
              <li key={event.id}>
                <Link
                  to="/evenements/$id"
                  params={{ id: event.id }}
                  target="_blank"
                  className="inline-flex min-h-11 items-center underline"
                >
                  {eventLabel(event, f, t)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
