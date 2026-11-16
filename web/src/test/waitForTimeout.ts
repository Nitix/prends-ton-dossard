import { vi } from "vitest";

// Setup file of the browser project (see vite.config.ts).
//
// `vi.waitFor` has its own default timeout, 1 s, which the `expect.poll` and action timeouts of
// vite.config.ts (5 s on CI) do not reach. On a slow CI machine a wait of 1 s ended before a
// dialog had faded in (EventPage « retrait »). It now has the timeout of `expect.poll`; a call
// that gives its own `timeout` keeps it. Local runs stay strict.
const defaultTimeout = import.meta.env.VITE_CI ? 5000 : 1000;
const waitFor = vi.waitFor.bind(vi);
vi.waitFor = (callback, options) =>
  waitFor(
    callback,
    typeof options === "number" ? options : { timeout: defaultTimeout, ...options },
  );
