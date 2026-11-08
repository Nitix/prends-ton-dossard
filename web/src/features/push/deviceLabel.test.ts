import { describe, expect, test } from "vitest";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { deviceLabel } from "./deviceLabel";

const FIREFOX_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36";
const CHROME_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const EDGE_WIN = `${CHROME_WIN} Edg/129.0.0.0`;
const SAFARI_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0.0.0 Mobile/15E148 Safari/604.1";
const CHROME_LINUX =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 14; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0";

const rows: [string, string, number, string, string][] = [
  ["Firefox on Windows", FIREFOX_WIN, 0, "Firefox sur Windows", "Firefox on Windows"],
  ["Chrome on Android", CHROME_ANDROID, 5, "Chrome sur Android", "Chrome on Android"],
  ["Chrome on Windows", CHROME_WIN, 0, "Chrome sur Windows", "Chrome on Windows"],
  ["Edge on Windows", EDGE_WIN, 0, "Edge sur Windows", "Edge on Windows"],
  ["Safari on Mac", SAFARI_MAC, 0, "Safari sur Mac", "Safari on Mac"],
  ["iPhone", IPHONE, 5, "iPhone", "iPhone"],
  ["a third-party browser on iPhone", IPHONE_CHROME, 5, "iPhone", "iPhone"],
  // Since iPadOS 13 an iPad says it is a Mac: the touch screen tells them apart.
  ["iPad", SAFARI_MAC, 5, "iPad", "iPad"],
  ["Chrome on Linux", CHROME_LINUX, 0, "Chrome sur Linux", "Chrome on Linux"],
  ["Firefox on Android", FIREFOX_ANDROID, 5, "Firefox sur Android", "Firefox on Android"],
  ["nothing known", "", 0, "Appareil", "Device"],
];

describe("deviceLabel", () => {
  test.each(rows)("%s", (_name, userAgent, touch, inFrench, inEnglish) => {
    expect(deviceLabel(userAgent, touch, fr)).toBe(inFrench);
    expect(deviceLabel(userAgent, touch, en)).toBe(inEnglish);
  });

  test("never longer than the 60 characters the server keeps", () => {
    expect(deviceLabel("x".repeat(500), 0, fr).length).toBeLessThanOrEqual(60);
  });
});
