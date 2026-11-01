import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { today } from "./dates";
import { ensureTemporal } from "./temporal";
import { TodayProvider, useClock, useToday } from "./useToday";

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

function ClockProbe() {
  return <p data-testid="clock">{useClock()().toString()}</p>;
}

test("useClock — rend l'horloge du fournisseur", async () => {
  const fixed = Temporal.Instant.from("2026-11-01T04:30:22Z");
  const screen = await render(
    <TodayProvider value={Temporal.PlainDate.from("2026-11-01")} now={() => fixed}>
      <ClockProbe />
    </TodayProvider>,
  );

  await expect.element(screen.getByTestId("clock")).toHaveTextContent("2026-11-01T04:30:22Z");
});

test("useClock — sans horloge donnée, c'est l'instant présent", async () => {
  const before = Temporal.Now.instant();
  const screen = await render(
    <TodayProvider>
      <ClockProbe />
    </TodayProvider>,
  );
  const after = Temporal.Now.instant();

  const shown = Temporal.Instant.from(screen.getByTestId("clock").element().textContent);
  expect(Temporal.Instant.compare(shown, before)).toBeGreaterThanOrEqual(0);
  expect(Temporal.Instant.compare(shown, after)).toBeLessThanOrEqual(0);
});

// The tick is a timer like the one of midnight: it is faked with the others.
const FAKE = ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] as const;

test("useClock — une nouvelle horloge chaque minute : ce qui montre l'heure se redessine", async () => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const screen = await render(
    <TodayProvider now={fakeClock}>
      <ClockProbe />
    </TodayProvider>,
  );
  await expect.element(screen.getByTestId("clock")).toHaveTextContent("2026-11-01T10:00:00Z");

  await vi.advanceTimersByTimeAsync(59_999);
  expect(screen.getByTestId("clock").element().textContent).toBe("2026-11-01T10:00:00Z");

  // React draws a moment after the timer, and the wait goes by the fake clock: a few ms go by.
  await vi.advanceTimersByTimeAsync(1);
  await vi.waitFor(() => {
    expect(screen.getByTestId("clock").element().textContent).toMatch(/^2026-11-01T10:01:00/);
  });

  // And the next minute: it goes on.
  await vi.advanceTimersByTimeAsync(60_000);
  await vi.waitFor(() => {
    expect(screen.getByTestId("clock").element().textContent).toMatch(/^2026-11-01T10:02:00/);
  });
});

test("useClock — la minute ne tourne pas avec un jour fixé, ni après le démontage", async () => {
  vi.useFakeTimers({ toFake: [...FAKE] });
  vi.setSystemTime(new Date("2026-11-01T10:00:00Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const fixed = await render(
    <TodayProvider value={Temporal.PlainDate.from("2026-11-01")} now={fakeClock}>
      <ClockProbe />
    </TodayProvider>,
  );
  await expect.element(fixed.getByTestId("clock")).toHaveTextContent("2026-11-01T10:00:00Z");

  await vi.advanceTimersByTimeAsync(5 * 60_000);
  expect(fixed.getByTestId("clock").element().textContent).toBe("2026-11-01T10:00:00Z");
  expect(vi.getTimerCount()).toBe(0);
  await fixed.unmount();

  const running = await render(
    <TodayProvider now={fakeClock}>
      <ClockProbe />
    </TodayProvider>,
  );
  expect(vi.getTimerCount()).toBeGreaterThan(0);
  await running.unmount();
  expect(vi.getTimerCount()).toBe(0);
});

test("useClock — une nouvelle horloge quand l'app revient au premier plan", async () => {
  let instant = Temporal.Instant.from("2026-11-01T10:00:00Z");
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const screen = await render(
    <TodayProvider now={() => instant}>
      <ClockProbe />
    </TodayProvider>,
  );
  await expect.element(screen.getByTestId("clock")).toHaveTextContent("2026-11-01T10:00:00Z");

  // The phone kept the tab for hours, its timers asleep.
  instant = Temporal.Instant.from("2026-11-01T14:00:00Z");
  document.dispatchEvent(new Event("visibilitychange"));

  await expect.element(screen.getByTestId("clock")).toHaveTextContent("2026-11-01T14:00:00Z");
});

test("useClock — hors fournisseur, lève une erreur", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(render(<ClockProbe />)).rejects.toThrow(
    "useClock must be used inside a TodayProvider",
  );
});
