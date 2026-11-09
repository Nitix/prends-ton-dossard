import { beforeEach } from "vitest";

// Setup file of the browser project (see vite.config.ts).
//
// On an emulated phone (VITEST_DEVICE), the browser says it is an iPhone or a
// Pixel: the app then shows what a phone is shown (« install the app » for
// push, « ⌘ + wheel » for the map's zoom, another label for the device). The
// tests that are about a phone set that identity themselves; every other test
// means a computer, and must not read the phone of the run by accident. So a
// phone's user agent and platform are replaced, before each test, by those of
// Chrome on Windows (what the expectations were written for). On a computer,
// nothing is changed.

const DESKTOP = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
  platform: "Win32",
};

const real = { userAgent: navigator.userAgent, platform: navigator.platform };
const onPhone = /iPhone|iPad|Android|Mobile/.test(real.userAgent);

function pin() {
  if (!onPhone) return;
  for (const [name, value] of Object.entries(DESKTOP)) {
    Object.defineProperty(navigator, name, { value, configurable: true });
  }
}

pin();
beforeEach(pin);

/**
 * Gives the test the real identity of the phone of the run, for the tests that are about it
 * (src/test/phoneIdentity.test.ts). The pin is put back before the next test.
 */
export function useRealIdentity(): void {
  for (const name of Object.keys(DESKTOP)) Reflect.deleteProperty(navigator, name);
}

// On a touch screen Playwright scrolls to a button while the dialog that holds it is still
// rising (the box moves, so the button is « outside of the viewport » at the time it looks, and
// the click waits out its timeout). The windows of a phone run do not animate; the test of the
// motion of a window is on the other targets.
if (matchMedia("(pointer: coarse)").matches) {
  const style = document.createElement("style");
  style.textContent =
    "dialog, dialog * { animation: none !important; transition: none !important; }";
  document.head.append(style);
}
