import { expect, test } from "vitest";

import { pushSupport } from "../features/push/support";
import { detectEnvironment } from "../features/pwa/environment";
import { useRealIdentity } from "./desktopIdentity";
import { isTouchDevice } from "./support";

// The other tests of a phone run take the identity of a computer (desktopIdentity.ts). These keep
// the real one of the emulated phone, so that each phone target meets what the app does there.
// (navigator.userAgentData, which Chromium on a phone fills in, is not pinned in either case.)

test.skipIf(!isTouchDevice)(
  "phone — l'identité du téléphone émulé est celle que l'appli lit",
  () => {
    useRealIdentity();

    const phone = /iPhone/.test(navigator.userAgent) ? "iphone" : "android";
    expect(navigator.userAgent).toMatch(/Mobile/);
    expect(detectEnvironment().ios).toBe(phone === "iphone");
    // On an iPhone, in a tab of Safari, Web Push does not exist: the page says how to install.
    expect(pushSupport() === "needs-install").toBe(phone === "iphone");
  },
);

test.skipIf(!isTouchDevice)("phone — l'écran tactile est « coarse », sans survol", () => {
  expect(matchMedia("(pointer: coarse)").matches).toBe(true);
  expect(matchMedia("(hover: none)").matches).toBe(true);
});
