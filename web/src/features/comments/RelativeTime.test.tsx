import { afterEach, beforeAll, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { RelativeTime } from "./RelativeTime";

beforeAll(async () => {
  await ensureTemporal();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** A clock that follows the fake timers of the test. */
const fakeClock = () => Temporal.Instant.fromEpochMilliseconds(Date.now());

// An element that stays mounted, with the same props, must say the time it is
// now: the page of an event stays open for hours.
test("RelativeTime — « maintenant » devient « il y a 1 minute » une minute plus tard, sans que rien ne change", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"],
  });
  vi.setSystemTime(new Date("2026-11-01T11:00:10Z"));
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const screen = await render(
    <I18nProvider languages={["fr"]}>
      <TodayProvider now={fakeClock}>
        <RelativeTime at="2026-11-01 11:00:00.000Z" />
      </TodayProvider>
    </I18nProvider>,
  );
  await expect.element(screen.getByText("maintenant")).toBeVisible();

  await vi.advanceTimersByTimeAsync(60_000);

  await expect.element(screen.getByText("il y a 1 minute")).toBeVisible();
  await expect.element(screen.getByText("maintenant")).not.toBeInTheDocument();

  // And an hour on, with the same element still there.
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  await expect.element(screen.getByText("il y a 1 heure")).toBeVisible();
});
