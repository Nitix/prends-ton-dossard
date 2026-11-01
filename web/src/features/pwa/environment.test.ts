import { expect, test } from "vitest";

import { detectEnvironment } from "./environment";

const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const IPAD =
  "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
// Since iPadOS 13, Safari says it is a Mac: only the touch screen tells them apart.
const MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** The window and the navigator of a browser, with only what the check reads. */
function browser({
  standaloneMedia = false,
  standaloneFlag,
  userAgent = WINDOWS,
  maxTouchPoints = 0,
}: {
  standaloneMedia?: boolean;
  standaloneFlag?: boolean;
  userAgent?: string;
  maxTouchPoints?: number;
}) {
  const asked: string[] = [];
  return {
    asked,
    window: {
      matchMedia: (query: string) => {
        asked.push(query);
        return { matches: standaloneMedia && query === "(display-mode: standalone)" };
      },
    },
    navigator: { userAgent, maxTouchPoints, standalone: standaloneFlag },
  };
}

function detect(options: Parameters<typeof browser>[0]) {
  const { window, navigator } = browser(options);
  return detectEnvironment(window, navigator);
}

test("detectEnvironment — un onglet de navigateur n'est ni installé ni sur iOS", () => {
  expect(detect({})).toEqual({ standalone: false, ios: false });
});

test("detectEnvironment — installé : le mode d'affichage standalone", () => {
  const { window, navigator, asked } = browser({ standaloneMedia: true });

  expect(detectEnvironment(window, navigator).standalone).toBe(true);
  expect(asked).toContain("(display-mode: standalone)");
});

test("detectEnvironment — installé sur iOS : navigator.standalone", () => {
  // Safari does not match the media query for a site added to the home screen.
  expect(detect({ userAgent: IPHONE, standaloneFlag: true }).standalone).toBe(true);
  expect(detect({ userAgent: IPHONE, standaloneFlag: false }).standalone).toBe(false);
});

test("detectEnvironment — iPhone, iPad et iPad qui se dit Mac sont iOS", () => {
  expect(detect({ userAgent: IPHONE, maxTouchPoints: 5 }).ios).toBe(true);
  expect(detect({ userAgent: IPAD, maxTouchPoints: 5 }).ios).toBe(true);
  expect(detect({ userAgent: MAC, maxTouchPoints: 5 }).ios).toBe(true);
});

test("detectEnvironment — un vrai Mac, Android et Windows ne sont pas iOS", () => {
  expect(detect({ userAgent: MAC, maxTouchPoints: 0 }).ios).toBe(false);
  expect(detect({ userAgent: ANDROID, maxTouchPoints: 5 }).ios).toBe(false);
  expect(detect({ userAgent: WINDOWS, maxTouchPoints: 10 }).ios).toBe(false);
});
