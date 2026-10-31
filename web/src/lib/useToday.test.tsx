import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { today } from "./dates";
import { ensureTemporal } from "./temporal";
import { TodayProvider, useToday } from "./useToday";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeAll(async () => {
  await ensureTemporal();
});

function Probe() {
  return <p data-testid="today">{useToday().toString()}</p>;
}

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
