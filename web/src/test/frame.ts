/**
 * The frame the tests draw in: Vitest's 414 × 896 on a computer, and the screen of the phone on
 * an emulated one (vite.config.ts). Tests that set their own size put it back to this one.
 */
const [width = 414, height = 896] = String(import.meta.env.VITE_TEST_FRAME ?? "414x896")
  .split("x")
  .map(Number);

export const FRAME = { width, height };
