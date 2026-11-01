/** What the profile needs to know about where the site is running. */
export type InstallEnvironment = {
  /** The site runs as an installed app, with no browser around it. */
  standalone: boolean;
  /** An iPhone or an iPad, where installing is done by hand from the share menu. */
  ios: boolean;
};

type WindowLike = { matchMedia(query: string): { matches: boolean } };
type NavigatorLike = { userAgent: string; maxTouchPoints: number; standalone?: boolean };

/** Reads the environment from the browser. The two arguments are only for tests. */
export function detectEnvironment(
  win: WindowLike = window,
  nav: NavigatorLike = navigator,
): InstallEnvironment {
  // Safari on iOS does not match the media query for a site added to the home
  // screen: it has its own flag.
  const standalone =
    win.matchMedia("(display-mode: standalone)").matches || nav.standalone === true;
  // An iPad says it is a Mac since iPadOS 13: the touch screen tells them apart.
  const ios =
    /iPhone|iPad|iPod/.test(nav.userAgent) ||
    (/Macintosh/.test(nav.userAgent) && nav.maxTouchPoints > 1);
  return { standalone, ios };
}
