import { detectEnvironment } from "../pwa/environment";

/**
 * What this browser can do about notifications:
 * - "needs-install": an iPhone or an iPad outside the installed app, where Web
 *   Push does not exist (not in a Safari tab), whatever else the browser says;
 * - "unsupported": no service worker, no Push API or no Notification API (the
 *   service worker is only registered in a production build: with the server of
 *   Vite, the page says the browser cannot);
 * - "denied": the person refused the permission for this site;
 * - "ready": the permission can be asked, or was granted.
 */
export type PushSupport = "ready" | "needs-install" | "denied" | "unsupported";

export type PushEnvironment = {
  win: {
    PushManager?: unknown;
    Notification?: { permission: NotificationPermission } | undefined;
  };
  nav: { serviceWorker?: unknown };
  standalone: boolean;
  ios: boolean;
};

function currentEnvironment(): PushEnvironment {
  const { standalone, ios } = detectEnvironment();
  return { win: window, nav: import.meta.env.PROD ? navigator : {}, standalone, ios };
}

/** Reads the browser; the argument is only for tests. */
export function pushSupport(env: PushEnvironment = currentEnvironment()): PushSupport {
  if (env.ios && !env.standalone) return "needs-install";
  if (
    env.nav.serviceWorker === undefined ||
    env.win.PushManager === undefined ||
    env.win.Notification === undefined
  ) {
    return "unsupported";
  }
  return env.win.Notification.permission === "denied" ? "denied" : "ready";
}
