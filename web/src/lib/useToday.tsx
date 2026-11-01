import { createContext, use, useEffect, useState, type ReactNode } from "react";

import { msUntilTomorrow, today } from "./dates";
import { onResume } from "./resume";

const TodayContext = createContext<Temporal.PlainDate | null>(null);

/** The current instant. Temporal is only read when this runs (see dates.ts). */
function currentInstant(): Temporal.Instant {
  return Temporal.Now.instant();
}

/**
 * Gives the current day (in Paris) to the app, so that every screen agrees on
 * what "today" is. It changes at midnight in Paris, and is read again when the
 * app comes back to the foreground: a phone keeps a tab for days, and its
 * timers sleep meanwhile.
 *
 * `value` replaces it with a fixed day, and `now` replaces the clock: both are
 * meant for tests.
 */
export function TodayProvider({
  value,
  now = currentInstant,
  children,
}: {
  value?: Temporal.PlainDate;
  now?: () => Temporal.Instant;
  children: ReactNode;
}) {
  const [current, setCurrent] = useState(() => today(now()));

  useEffect(() => {
    if (value) return undefined;

    // The same day keeps the same object, so that nothing renders again.
    const refresh = () => {
      const next = today(now());
      setCurrent((previous) => (previous.equals(next) ? previous : next));
    };
    // The timer is armed again each time, from the clock: a timer that fired
    // early, or late after a sleep, is corrected by the next one.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        refresh();
        arm();
      }, msUntilTomorrow(now()));
    };

    arm();
    const stopResume = onResume(() => {
      refresh();
      arm();
    });
    return () => {
      clearTimeout(timer);
      stopResume();
    };
  }, [now, value]);

  return <TodayContext value={value ?? current}>{children}</TodayContext>;
}

export function useToday(): Temporal.PlainDate {
  const value = use(TodayContext);
  if (!value) throw new Error("useToday must be used inside a TodayProvider");
  return value;
}
