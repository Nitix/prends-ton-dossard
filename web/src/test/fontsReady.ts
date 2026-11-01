import { expect } from "vitest";

/**
 * Waits until the fonts of the site have loaded, and fails if one of them could
 * not: a test that measures a width (a word that must not wrap, a row that must
 * fit a phone) measures it in the fonts of the site, not in the system fonts
 * that stand in while they load, or for good when a file is missing. Without
 * the second check, a font file that moved would let such a test pass on the
 * wrong font.
 */
export async function fontsReady(): Promise<void> {
  await document.fonts.ready;
  const failed = [...document.fonts]
    .filter((face) => face.status === "error")
    .map((face) => `${face.family} ${face.weight} ${face.unicodeRange}`);
  expect(failed, "font faces that failed to load").toEqual([]);
}
