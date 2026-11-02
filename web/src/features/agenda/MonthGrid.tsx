import { Link } from "@tanstack/react-router";

import { useI18n } from "../../i18n/I18nProvider";
import type { EventView } from "../events/api";

/** Dots in a day of the grid on a phone: past this many, "+N" says how many more. */
const MAX_DOTS = 3;

/**
 * The weeks of a month, a table with a column per weekday and the days of the
 * neighbouring months that fill the first and the last week.
 *
 * Two renders of a day share each cell, and the styles choose between them:
 * - below `md`, a button that chooses the day (the events are listed under the
 *   grid): its number and a dot per event;
 * - from `md`, the number and the name of each event, a link to its page.
 *
 * `selected` is the ISO date of the day chosen, if any.
 */
export function MonthGrid({
  weeks,
  month,
  byDay,
  today,
  selected,
  labelledBy,
  busy,
  onSelect,
}: {
  weeks: Temporal.PlainDate[][];
  month: Temporal.PlainYearMonth;
  byDay: Map<string, EventView[]>;
  today: Temporal.PlainDate;
  selected: string | undefined;
  /** The id of the title of the month, which names the table. */
  labelledBy: string;
  /** The events are on their way: the cells are not final. */
  busy: boolean;
  onSelect: (day: Temporal.PlainDate) => void;
}) {
  const { f } = useI18n();

  // On a phone the grid runs from one edge of the screen to the other: seven
  // days of at least 44 px do not fit between the gutters of the page (`px-4`
  // of the app shell's `<main>`) on a 320 px screen. For the same reason a day
  // has no room at its sides there (312 px for seven, 44.5 px each), only
  // above and below. From `md` it is back between them.
  return (
    <div className="-mx-4 bg-card px-1 py-2 shadow-card md:mx-0 md:overflow-hidden md:rounded-[1.25rem] md:p-2">
      <table
        aria-labelledby={labelledBy}
        aria-busy={busy}
        className="w-full table-fixed border-collapse"
      >
        <thead>
          <tr>
            {/* Every week has the same weekdays: the names come from the first one. */}
            {(weeks[0] ?? []).map((day) => (
              <th
                key={day.dayOfWeek}
                scope="col"
                className="pb-2 font-display text-[0.6875rem] font-bold tracking-[0.08em] text-neutral-600 uppercase"
              >
                {f.weekday(day, "short")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]?.toString()}>
              {week.map((day) => (
                <DayCell
                  key={day.toString()}
                  day={day}
                  inMonth={day.toPlainYearMonth().equals(month)}
                  isToday={day.equals(today)}
                  isSelected={selected === day.toString()}
                  views={byDay.get(day.toString()) ?? []}
                  onSelect={onSelect}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayCell({
  day,
  inMonth,
  isToday,
  isSelected,
  views,
  onSelect,
}: {
  day: Temporal.PlainDate;
  inMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
  views: EventView[];
  onSelect: (day: Temporal.PlainDate) => void;
}) {
  const { t, f } = useI18n();
  const dots = Math.min(views.length, MAX_DOTS);
  const more = views.length - dots;
  // Today has a ring around its number, and the selected day is filled in:
  // neither is told by the colour alone.
  const ring = isToday ? "font-bold" : "border-transparent";
  const number = `flex size-7 items-center justify-center rounded-full border-2 text-sm tabular-nums ${ring}`;
  // On the sunrise of the selected day, the ring of today is in its ink (white in Crête).
  const numberOnPhone = `${number} ${isToday ? (isSelected ? "border-dawn-deep-ink" : "border-iris-600 text-iris-700") : ""}`;
  const numberOnDesktop = `${number} ${isToday ? "border-iris-600 bg-iris-600 text-card" : ""}`;

  return (
    <td
      className={`px-0 py-0.5 align-top md:border md:border-neutral-100 md:p-0 ${inMonth ? "" : "md:bg-neutral-50"}`}
    >
      <button
        type="button"
        aria-label={t.agenda.day(f.date(day), views.length)}
        aria-pressed={isSelected}
        aria-current={isToday ? "date" : undefined}
        onClick={() => {
          onSelect(day);
        }}
        className={`press flex h-14 w-full flex-col items-center justify-center gap-0.5 rounded-2xl md:hidden ${
          isSelected
            ? "bg-dawn-deep text-dawn-deep-ink shadow-glow"
            : inMonth
              ? "hover:bg-iris-50"
              : "text-neutral-600 hover:bg-iris-50"
        }`}
      >
        <span className={numberOnPhone}>{day.day}</span>
        {/* The name of the button says how many events there are. */}
        <span aria-hidden="true" className="flex h-3 items-center gap-0.5 text-xs leading-none">
          {Array.from({ length: dots }, (_, i) => (
            <span
              key={i}
              data-testid="dot"
              className={`size-1.5 rounded-full ${isSelected ? "bg-dawn-deep-ink" : "bg-blush-500"}`}
            />
          ))}
          {more > 0 && <span>+{more}</span>}
        </span>
      </button>
      <div
        className={`hidden min-h-24 flex-col gap-1 p-1 md:flex ${inMonth ? "" : "text-neutral-600"}`}
      >
        <time
          dateTime={day.toString()}
          aria-current={isToday ? "date" : undefined}
          className={numberOnDesktop}
        >
          {day.day}
        </time>
        {views.length > 0 && (
          <ul aria-label={f.date(day)} className="flex flex-col gap-0.5">
            {views.map((view) => (
              <li key={view.event.id}>
                <Link
                  to="/evenements/$id"
                  params={{ id: view.event.id }}
                  title={view.event.name}
                  className="block truncate rounded-lg bg-iris-50 px-1.5 py-1 text-xs font-semibold text-iris-800 ring-1 ring-iris-100 hover:bg-iris-100 pointer-coarse:min-h-11 pointer-coarse:py-3"
                >
                  {view.event.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </td>
  );
}
