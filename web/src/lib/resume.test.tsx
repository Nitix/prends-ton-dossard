import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { onResume } from "./resume";

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function pageBecomes(state: DocumentVisibilityState) {
  visibility = state;
  document.dispatchEvent(new Event("visibilitychange"));
}

test("onResume — rappelle quand la page revient au premier plan", () => {
  const callback = vi.fn<() => void>();
  const stop = onResume(callback);

  pageBecomes("hidden");
  expect(callback).not.toHaveBeenCalled();

  pageBecomes("visible");
  expect(callback).toHaveBeenCalledTimes(1);

  stop();
});

test("onResume — rappelle à intervalle régulier tant que la page est visible", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const callback = vi.fn<() => void>();
  const stop = onResume(callback, 60_000);

  vi.advanceTimersByTime(59_999);
  expect(callback).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(callback).toHaveBeenCalledTimes(1);

  // A page in the background is left alone.
  visibility = "hidden";
  vi.advanceTimersByTime(5 * 60_000);
  expect(callback).toHaveBeenCalledTimes(1);

  stop();
});

test("onResume — ne rappelle plus une fois arrêté", () => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  const callback = vi.fn<() => void>();
  const stop = onResume(callback, 60_000);

  stop();
  pageBecomes("hidden");
  pageBecomes("visible");
  vi.advanceTimersByTime(10 * 60_000);

  expect(callback).not.toHaveBeenCalled();
});
