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
