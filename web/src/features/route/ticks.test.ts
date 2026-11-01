import { describe, expect, test } from "vitest";

import { altitudeScale, distanceTicks } from "./ticks";

/** Whether a step is 1, 2, 2.5 or 5 times a power of ten: a round one. */
function isRound(step: number): boolean {
  const mantissa = Number((step / 10 ** Math.floor(Math.log10(step))).toFixed(6));
  return [1, 2, 2.5, 5].includes(mantissa);
}

describe("distanceTicks", () => {
  test("distanceTicks — de 4 à 6 graduations rondes, de 0 à la longueur", () => {
    const problems: string[] = [];
    // Every length from 1.5 to 5 000 km, with steps that do not favour a round number.
    for (let km = 1.5; km < 5000; km *= 1.0137) {
      const ticks = distanceTicks(km);
      const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
      const evenlySpaced = ticks.every((tick, i) => Math.abs(tick - i * step) < 1e-9);
      const ok =
        ticks.length >= 4 &&
        ticks.length <= 6 &&
        ticks[0] === 0 &&
        (ticks.at(-1) ?? Infinity) <= km &&
        isRound(step) &&
        evenlySpaced;
      if (!ok) problems.push(`${km} km: ${ticks.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  test("distanceTicks — un marathon", () => {
    expect(distanceTicks(42.2)).toEqual([0, 10, 20, 30, 40]);
    expect(distanceTicks(100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(distanceTicks(12)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  test("distanceTicks — rien à graduer sur une longueur nulle", () => {
    expect(distanceTicks(0)).toEqual([0]);
    expect(distanceTicks(Number.NaN)).toEqual([0]);
  });
});

describe("altitudeScale", () => {
  test("altitudeScale — de 3 à 5 graduations rondes, en mètres entiers, qui encadrent les altitudes", () => {
    const problems: string[] = [];
    for (let min = -50; min < 4000; min += 37) {
      for (const span of [0, 3, 10, 23, 80, 150, 410, 990, 2300]) {
        const max = min + span;
        const { from, to, ticks } = altitudeScale(min, max);
        const step = (ticks[1] ?? 0) - (ticks[0] ?? 0);
        const ok =
          ticks.length >= 3 &&
          ticks.length <= 5 &&
          // The scale covers the data, and its ends are graduations.
          from <= min &&
          to >= max &&
          ticks[0] === from &&
          ticks.at(-1) === to &&
          Number.isInteger(step) &&
          isRound(step) &&
          // Never a -0, which Intl writes "-0 m".
          ticks.every((tick) => !Object.is(tick, -0));
        if (!ok) problems.push(`${min} to ${max}: ${from}, ${to}, ${ticks.join(", ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("altitudeScale — un exemple", () => {
    expect(altitudeScale(450, 750)).toEqual({
      from: 400,
      to: 800,
      ticks: [400, 500, 600, 700, 800],
    });
    // A flat track still has a scale: at least 10 m high.
    const flat = altitudeScale(500, 500);
    expect(flat.to - flat.from).toBeGreaterThanOrEqual(10);
    expect(flat.from).toBeLessThanOrEqual(500);
    expect(flat.to).toBeGreaterThanOrEqual(500);
  });
});
