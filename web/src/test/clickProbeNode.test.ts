import { expect, test } from "vitest";

import { lagBetween } from "./clickProbeNode";

// Samples every 20 ms, then a block of the event loop of about 2 s, then samples again.
const samples = [
  { at: 500, lag: 0 },
  { at: 1000, lag: 0 },
  { at: 1020, lag: 0 },
  { at: 3000, lag: 1960 },
  { at: 3020, lag: 0 },
  { at: 3200, lag: 150 },
  { at: 9000, lag: 0 },
];

test("lagBetween — le plus long retard de Node pendant un clic, et le plus long par 500 ms", () => {
  expect(lagBetween(samples, 1000, 3100)).toEqual({
    maxLag: 1960,
    // The block is counted in the 500 ms where the late sample was taken; the sample of 3200 ms
    // is in the last one: its block began before the end of the click.
    per500: [0, 0, 0, 0, 1960],
    over100: 2,
    samples: 5,
  });
});

test("lagBetween — sans relevé (la sonde éteinte), tout est à zéro", () => {
  expect(lagBetween([], 1000, 1200)).toEqual({ maxLag: 0, per500: [0], over100: 0, samples: 0 });
});
