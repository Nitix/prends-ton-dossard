import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { today } from "./dates";
import { ensureTemporal } from "./temporal";
import { TodayProvider, useToday } from "./useToday";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await ensureTemporal();
});

function Probe() {
  return <p data-testid="today">{useToday().toString()}</p>;
}

/** A clock that follows the fake timers of the test. */
const fakeClock = () => Temporal.Instant.fromEpochMilliseconds(Date.now());

test("useToday — rend la date du fournisseur", async () => {
  const screen = await render(
    <TodayProvider value={Temporal.PlainDate.from("2026-04-30")}>
      <Probe />
    </TodayProvider>,
  );

  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-04-30");
});

test("useToday — hors fournisseur, lève une erreur", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(render(<Probe />)).rejects.toThrow("useToday must be used inside a TodayProvider");
});

test("useToday — sans valeur, rend le jour d'aujourd'hui à Paris", async () => {
  const before = today().toString();
  const screen = await render(
    <TodayProvider>
      <Probe />
    </TodayProvider>,
  );
  const after = today().toString();

  const shown = screen.getByTestId("today").element().textContent;
  // The day could change between the three readings.
  expect([before, after]).toContain(shown);
});

test("useToday — passe au jour suivant à minuit, heure de Paris", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // 23:59 in Paris (UTC+1 in November).
  vi.setSystemTime(new Date("2026-11-01T22:59:00Z"));
  const screen = await render(
    <TodayProvider now={fakeClock}>
      <Probe />
    </TodayProvider>,
  );
  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-11-01");

  await vi.advanceTimersByTimeAsync(59_999);
  expect(screen.getByTestId("today").element().textContent).toBe("2026-11-01");

  await vi.advanceTimersByTimeAsync(1);
  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-11-02");

  // And again the next night: the timer is armed again.
  await vi.advanceTimersByTimeAsync(24 * 3_600_000);
  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-11-03");
});

test("useToday — reprend le jour quand l'app revient au premier plan", async () => {
  let instant = Temporal.Instant.from("2026-11-01T10:00:00Z");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const screen = await render(
    <TodayProvider now={() => instant}>
      <Probe />
    </TodayProvider>,
  );
  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-11-01");

  // The phone kept the tab for two days, its timers asleep.
  instant = Temporal.Instant.from("2026-11-03T07:30:00Z");
  document.dispatchEvent(new Event("visibilitychange"));

  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-11-03");
});

test("useToday — une valeur fixée ne suit pas l'horloge", async () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const screen = await render(
    <TodayProvider
      value={Temporal.PlainDate.from("2026-04-30")}
      now={() => Temporal.Instant.from("2026-11-03T07:30:00Z")}
    >
      <Probe />
    </TodayProvider>,
  );

  document.dispatchEvent(new Event("visibilitychange"));

  await expect.element(screen.getByTestId("today")).toHaveTextContent("2026-04-30");
});
