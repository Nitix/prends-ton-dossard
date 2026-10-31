import { describe, expect, test } from "vitest";

import { fromMinutes, toMinutes } from "./minutes";

describe("toMinutes", () => {
  test("hours and minutes make the total", () => {
    expect(toMinutes(46, 30)).toBe(2790);
  });

  test("an empty part counts for nothing", () => {
    expect(toMinutes(48, undefined)).toBe(2880);
    expect(toMinutes(undefined, 45)).toBe(45);
  });

  test("two empty parts, or two zeros, are no duration at all", () => {
    expect(toMinutes(undefined, undefined)).toBeUndefined();
    expect(toMinutes(0, 0)).toBeUndefined();
  });

  test("minutes over 59 are fine: 90 minutes are an hour and a half", () => {
    expect(toMinutes(1, 90)).toBe(150);
  });

  test("a negative or fractional input does not make a negative or fractional duration", () => {
    expect(toMinutes(-1, 0)).toBeUndefined();
    expect(toMinutes(0, 29.6)).toBe(30);
  });
});

describe("fromMinutes", () => {
  test("splits a total into hours and minutes", () => {
    expect(fromMinutes(2790)).toEqual({ hours: 46, minutes: 30 });
  });

  test("leaves out a part that is zero", () => {
    expect(fromMinutes(2880)).toEqual({ hours: 48 });
    expect(fromMinutes(45)).toEqual({ minutes: 45 });
  });

  test("no duration is no part", () => {
    expect(fromMinutes(undefined)).toEqual({});
    expect(fromMinutes(0)).toEqual({});
  });

  test("is the inverse of toMinutes", () => {
    for (const total of [1, 59, 60, 61, 360, 2790, 2880]) {
      const { hours, minutes } = fromMinutes(total);
      expect(toMinutes(hours, minutes)).toBe(total);
    }
  });
});
