import { afterEach, beforeEach, expect, test } from "vitest";

import { ensureTemporal } from "./temporal";

// Node 26 has Temporal natively, as do all the target browsers but Safari.
// The "Safari path" is exercised by removing it before each test.
const native = Object.getOwnPropertyDescriptor(globalThis, "Temporal");
if (!native) {
  throw new Error("This test needs a runtime with a native Temporal (Node 26 or later)");
}

function removeTemporal() {
  Reflect.deleteProperty(globalThis, "Temporal");
}

beforeEach(removeTemporal);

afterEach(() => {
  Object.defineProperty(globalThis, "Temporal", native);
});

test("loads the polyfill when Temporal is missing", async () => {
  expect("Temporal" in globalThis).toBe(false);

  await ensureTemporal();

  expect("Temporal" in globalThis).toBe(true);
  // The polyfill, not the native object that the test put aside.
  expect(globalThis.Temporal).not.toBe(native.value);
  expect(Temporal.PlainDate.from("2026-06-14").dayOfWeek).toBe(7);
  expect(Temporal.PlainDate.from("2026-04-30").until("2026-06-14").days).toBe(45);
});

test("leaves a native Temporal alone", async () => {
  Object.defineProperty(globalThis, "Temporal", native);

  await ensureTemporal();

  expect(globalThis.Temporal).toBe(native.value);
});
