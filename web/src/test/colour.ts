// The arithmetic of colour for the tests that pin a contrast, or the difference
// between two colours, so that a number says it and not the eye.

export type Vision = "normal" | "protan" | "deutan";

type Linear = readonly [number, number, number];

/**
 * How a colour is seen with a colour vision deficiency (Machado, Oliveira and
 * Fernandes, 2009, at severity 1: protanopia has no red cones, deuteranopia no
 * green ones), as a matrix on linear sRGB. The thresholds of the tests are
 * calibrated on this model: another one moves the borderline pairs.
 */
const SIMULATION = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const;

function channel(hex: string, from: number): number {
  const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** A `#rrggbb` colour in linear light (sRGB without its curve). */
function linear(hex: string): Linear {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) throw new Error(`${hex} is not a #rrggbb colour`);
  return [channel(hex, 1), channel(hex, 3), channel(hex, 5)];
}

/** The relative luminance of WCAG 2: 0 for black, 1 for white. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** The contrast ratio of WCAG 2 between two colours, from 1 to 21, in either order. */
export function contrast(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].toSorted((x, y) => y - x);
  return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));

function seen([r, g, b]: Linear, vision: Vision): Linear {
  if (vision === "normal") return [r, g, b];
  const [row0, row1, row2] = SIMULATION[vision];
  return [
    clamp(row0[0] * r + row0[1] * g + row0[2] * b),
    clamp(row1[0] * r + row1[1] * g + row1[2] * b),
    clamp(row2[0] * r + row2[1] * g + row2[2] * b),
  ];
}

/** A colour in OKLab, where a distance is close to what the eye sees. */
function oklab([r, g, b]: Linear): Linear {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/**
 * How far apart two colours look to someone with the given vision: the
 * distance in OKLab, times 100 (black to white is 100). Both colours are seen
 * the same way, so the number says whether the two can still be told apart.
 */
export function deltaE(a: string, b: string, vision: Vision = "normal"): number {
  const [l1, a1, b1] = oklab(seen(linear(a), vision));
  const [l2, a2, b2] = oklab(seen(linear(b), vision));
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}
