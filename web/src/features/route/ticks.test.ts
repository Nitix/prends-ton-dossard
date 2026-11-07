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
      const ticks = distanceTicks(0, km);
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
    expect(distanceTicks(0, 42.2)).toEqual([0, 10, 20, 30, 40]);
    expect(distanceTicks(0, 100)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(distanceTicks(0, 12)).toEqual([0, 2.5, 5, 7.5, 10]);
  });

  test("distanceTicks — rien à graduer sur une longueur nulle", () => {
    expect(distanceTicks(0, 0)).toEqual([0]);
    expect(distanceTicks(0, Number.NaN)).toEqual([0]);
  });

  test("distanceTicks — une longueur énorme ou infinie se termine", () => {
    expect(distanceTicks(0, Infinity)).toEqual([0]);
    for (const km of [1e12, 1e100, 1e300, 1.7e308, Number.MAX_VALUE]) {
      const ticks = distanceTicks(0, km);
      expect(ticks.length).toBeGreaterThanOrEqual(2);
      expect(ticks.length).toBeLessThanOrEqual(6);
      expect(ticks.every(Number.isFinite)).toBe(true);
    }
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
          ticks.every((tick) => !Object.is(tick, -0)) &&
          // A track at or above sea level has no scale below it.
          (min < 0 || from >= 0);
        if (!ok) problems.push(`${min} to ${max}: ${from}, ${to}, ${ticks.join(", ")}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test("altitudeScale — des altitudes énormes ou infinies se terminent", () => {
    const inputs: [number, number][] = [
      [-1e308, 1e308],
      [0, 1.7e308],
      [-Number.MAX_VALUE, Number.MAX_VALUE],
      [1e300, 1e300],
      [-Infinity, Infinity],
      [Infinity, Infinity],
      [Number.NaN, 5],
      [Number.NaN, Number.NaN],
      [0, 1e7],
    ];
    const problems: string[] = [];
    for (const [min, max] of inputs) {
      const { from, to, ticks } = altitudeScale(min, max);
      const ok =
        ticks.length >= 3 &&
        ticks.length <= 5 &&
        Number.isFinite(from) &&
        Number.isFinite(to) &&
        from < to &&
        ticks.every(Number.isFinite);
      if (!ok) problems.push(`${min} to ${max}: ${from}, ${to}, ${ticks.join(", ")}`);
    }
    expect(problems).toEqual([]);
  });

  test("altitudeScale — une trace au niveau de la mer ne descend pas sous 0", () => {
    expect(altitudeScale(0, 3)).toEqual({ from: 0, to: 10, ticks: [0, 5, 10] });
    expect(altitudeScale(0, 0)).toEqual({ from: 0, to: 10, ticks: [0, 5, 10] });
    const small = altitudeScale(2, 3);
    expect(small.from).toBe(0);
    expect(small.ticks.every((tick) => tick >= 0)).toBe(true);
    // Below sea level, the scale is centred on the track as before.
    const below = altitudeScale(-3, 0);
    expect(below.from).toBeLessThanOrEqual(-3);
    expect(below.to).toBeGreaterThanOrEqual(0);
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

test("distanceTicks — sur une portion, des repères ronds à l'intérieur", () => {
  // The old call is the portion from 0.
  expect(distanceTicks(0, 20)).toEqual([0, 5, 10, 15, 20]);
  // 12.4 to 18.0: round steps inside the portion, 4 to 6 of them.
  expect(distanceTicks(12.4, 18)).toEqual([13, 14, 15, 16, 17, 18]);
  // A short portion has finer steps, never under 0.1 km.
  expect(distanceTicks(3.05, 3.35)).toEqual([3.1, 3.2, 3.3]);
  // Every tick is inside, for any portion.
  for (const [from, to] of [
    [0.3, 0.5],
    [41.2, 42.2],
    [7, 7.2],
    [100, 380],
  ] as const) {
    const ticks = distanceTicks(from, to);
    expect(ticks.length).toBeGreaterThanOrEqual(1);
    expect(ticks.length).toBeLessThanOrEqual(6);
    for (const tick of ticks) {
      expect(tick).toBeGreaterThanOrEqual(from - 1e-9);
      expect(tick).toBeLessThanOrEqual(to + 1e-9);
    }
  }
  // Nonsense gives the one graduation at its start.
  expect(distanceTicks(5, 5)).toEqual([5]);
  expect(distanceTicks(0, Number.POSITIVE_INFINITY)).toEqual([0]);
});
