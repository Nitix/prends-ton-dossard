// Diagnostic of round 21 (branch diag/safari-clicks only), the side of Node: how late the event
// loop of Vitest's process was during a slow click. Playwright's server runs in that process, so
// a click waits for it as much as for the browser. vite.config.ts starts the sampler (on WebKit on
// CI only) and answers the `clickProbeNode` command of src/test/clickProbe.ts. This module
// imports nothing, so that the config does not load the code of the browser.

/** A tick of the sampler: when it ran (ms since 1970), and how much later than asked. */
export type LagSample = { at: number; lag: number };

/** What Node says of a stretch of time. */
export type NodeLag = {
  /** The longest delay of the event loop, in ms. */
  maxLag: number;
  /** The longest delay in each 500 ms from the start (the 500 ms where the late tick ran). */
  per500: number[];
  /** How many delays were over 100 ms. */
  over100: number;
  /** How many ticks fell in the stretch: one every 20 ms when nothing is late. */
  samples: number;
};

/** The answer of the `clickProbeNode` command: the delays, the load of the machine (1, 5 and 15
 * minutes) and how many browser contexts were open (one per test file running at once). */
export type NodeAnswer = NodeLag & { load: number[]; contexts: number };

const PERIOD = 20;
// Two minutes of ticks: a click lasts 5 s at most.
const KEEP = 6000;

/** Starts a tick every 20 ms that notes how late it is; the list it fills is returned. */
export function startLagSampler(): LagSample[] {
  const samples: LagSample[] = [];
  let last = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    samples.push({ at: Date.now(), lag: Math.max(0, Math.round(now - last - PERIOD)) });
    if (samples.length > KEEP) samples.splice(0, samples.length - KEEP);
    last = now;
  }, PERIOD);
  // It must never keep the process alive.
  timer.unref();
  return samples;
}

/**
 * The delays between two times (ms since 1970). A tick at `at`, `lag` late, stands for a block
 * that began `lag + 20` ms before it: it counts when that block overlaps the stretch.
 */
export function lagBetween(samples: LagSample[], from: number, to: number): NodeLag {
  const per500 = Array.from({ length: Math.max(1, Math.ceil((to - from) / 500)) }, () => 0);
  let maxLag = 0;
  let over100 = 0;
  let count = 0;
  for (const { at, lag } of samples) {
    if (at < from || at - lag - PERIOD > to) continue;
    count += 1;
    maxLag = Math.max(maxLag, lag);
    if (lag > 100) over100 += 1;
    const index = Math.min(per500.length - 1, Math.floor((at - from) / 500));
    per500[index] = Math.max(per500[index] ?? 0, lag);
  }
  return { maxLag, per500, over100, samples: count };
}
