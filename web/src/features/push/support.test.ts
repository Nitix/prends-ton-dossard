import { describe, expect, test } from "vitest";

import { pushSupport, type PushEnvironment } from "./support";

function env(
  over: {
    win?: PushEnvironment["win"];
    nav?: PushEnvironment["nav"];
    standalone?: boolean;
    ios?: boolean;
  } = {},
): PushEnvironment {
  return {
    win: { PushManager: {}, Notification: { permission: "default" }, ...over.win },
    nav: { serviceWorker: {}, ...over.nav },
    standalone: over.standalone ?? false,
    ios: over.ios ?? false,
  };
}

describe("pushSupport", () => {
  test("ready: the three APIs, permission not refused", () => {
    expect(pushSupport(env())).toBe("ready");
    expect(pushSupport(env({ win: { Notification: { permission: "granted" } } }))).toBe("ready");
  });

  test("denied: the permission is refused", () => {
    expect(pushSupport(env({ win: { Notification: { permission: "denied" } } }))).toBe("denied");
  });

  test("unsupported: one of the three APIs is missing", () => {
    expect(pushSupport(env({ nav: { serviceWorker: undefined } }))).toBe("unsupported");
    expect(pushSupport(env({ win: { PushManager: undefined } }))).toBe("unsupported");
    expect(pushSupport(env({ win: { Notification: undefined } }))).toBe("unsupported");
  });

  test("needs-install: iOS outside the installed app, whatever the APIs say", () => {
    expect(pushSupport(env({ ios: true }))).toBe("needs-install");
    expect(pushSupport(env({ ios: true, win: { PushManager: undefined } }))).toBe("needs-install");
    expect(pushSupport(env({ ios: true, win: { Notification: { permission: "denied" } } }))).toBe(
      "needs-install",
    );
  });

  test("iOS in the installed app is like any other browser", () => {
    expect(pushSupport(env({ ios: true, standalone: true }))).toBe("ready");
    expect(pushSupport(env({ ios: true, standalone: true, win: { PushManager: undefined } }))).toBe(
      "unsupported",
    );
  });
});
