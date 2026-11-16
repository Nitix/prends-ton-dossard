import { expect, test, vi } from "vitest";

// vi.waitFor has its own default of 1 s, apart from `expect.poll`'s: on CI (the `tolerant` mode of
// vite.config.ts) a 1 s wait failed on a slow machine (a dialog that still fades in).
const onCI = Boolean(import.meta.env.VITE_CI);

test("waitForTimeout — vi.waitFor attend aussi longtemps que les actions : 1 s en local, 5 s sur CI", async () => {
  let reached = false;
  setTimeout(() => (reached = true), 1500);
  const outcome = await vi
    .waitFor(() => {
      if (!reached) throw new Error("not yet");
    })
    .then(
      () => "resolved",
      () => "rejected",
    );
  expect(outcome).toBe(onCI ? "resolved" : "rejected");
});
