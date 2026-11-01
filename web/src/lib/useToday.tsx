import { createContext, use, useEffect, useMemo, useState, type ReactNode } from "react";

import { msUntilTomorrow, today } from "./dates";
import { onResume } from "./resume";

const TodayContext = createContext<Temporal.PlainDate | null>(null);
const ClockContext = createContext<(() => Temporal.Instant) | null>(null);

/** How often the screens that show a time ("2 hours ago") read the clock again. */
const TICK_MS = 60_000;

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
 * It also gives the clock (`useClock`) to the screens that show a time, such
 * as "2 hours ago". A clock is a function, which a screen calls when it renders:
 * nothing would make it render again as time passes, and the React Compiler
 * keeps the result of a call whose inputs have not changed. So the clock is a
 * new function every minute, and when the app comes back to the foreground:
 * the screens that read it render again, and read the time again.
 *
 * `value` replaces it with a fixed day (and stops the timers), and `now`
 * replaces the clock: both are meant for tests.
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
  const [tick, setTick] = useState(0);
  // The new function is the news: what it returns does not depend on `tick`.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const clock = useMemo(() => () => now(), [now, tick]);

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
    // Every minute while the app is in view, and as soon as it comes back.
    const stopTick = onResume(() => {
      setTick((previous) => previous + 1);
    }, TICK_MS);
    return () => {
      clearTimeout(timer);
      stopResume();
      stopTick();
    };
  }, [now, value]);

  return (
    <ClockContext value={clock}>
      <TodayContext value={value ?? current}>{children}</TodayContext>
    </ClockContext>
  );
}

export function useToday(): Temporal.PlainDate {
  const value = use(TodayContext);
  if (!value) throw new Error("useToday must be used inside a TodayProvider");
  return value;
}

/**
 * The clock of the app: the current instant, `Temporal.Now.instant` unless a
 * test gave another to the `TodayProvider`. A function, not a value: it is read
 * when a time is shown, not before. It is a different function every minute (see
 * `TodayProvider`), so a component that calls it renders again then.
 */
export function useClock(): () => Temporal.Instant {
  const value = use(ClockContext);
  if (!value) throw new Error("useClock must be used inside a TodayProvider");
  return value;
}
