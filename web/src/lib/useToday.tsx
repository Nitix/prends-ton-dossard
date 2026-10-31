import { createContext, use, useState, type ReactNode } from "react";

import { today } from "./dates";

const TodayContext = createContext<Temporal.PlainDate | null>(null);

/**
 * Gives the current day (in Paris) to the app, so that every screen agrees on
 * what "today" is. It is read once, when the app starts. `value` replaces it:
 * it is meant for tests, which need a fixed day.
 */
export function TodayProvider({
  value,
  children,
}: {
  value?: Temporal.PlainDate;
  children: ReactNode;
}) {
  const [current] = useState(() => today());
  return <TodayContext value={value ?? current}>{children}</TodayContext>;
}

export function useToday(): Temporal.PlainDate {
  const value = use(TodayContext);
  if (!value) throw new Error("useToday must be used inside a TodayProvider");
  return value;
}
