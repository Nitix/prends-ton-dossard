import type { Messages } from "../../i18n/fr";

/** The most the server keeps of a label. */
const MAX = 60;

/** The browser, from the user agent: the more specific names come first (Edge and Opera also say Chrome). */
function browserOf(userAgent: string): string | null {
  if (/Edg(e|A|iOS)?\//.test(userAgent)) return "Edge";
  if (/OPR\/|Opera/.test(userAgent)) return "Opera";
  if (/SamsungBrowser/.test(userAgent)) return "Samsung Internet";
  if (/Firefox\/|FxiOS/.test(userAgent)) return "Firefox";
  if (/Chrome\/|CriOS/.test(userAgent)) return "Chrome";
  if (/Safari\//.test(userAgent)) return "Safari";
  return null;
}

/** The system, from the user agent. */
function systemOf(userAgent: string): string | null {
  if (/Android/.test(userAgent)) return "Android";
  if (/Windows/.test(userAgent)) return "Windows";
  if (/CrOS/.test(userAgent)) return "ChromeOS";
  if (/Macintosh|Mac OS X/.test(userAgent)) return "Mac";
  if (/Linux|X11/.test(userAgent)) return "Linux";
  return null;
}

/**
 * What the list of devices calls this one: « Firefox sur Windows », « Chrome sur
 * Android », « Safari sur Mac », or « iPhone » and « iPad » alone (the browser of
 * an iPhone says little: they all are Safari inside). An iPad says it is a Mac
 * since iPadOS 13: the touch screen tells them apart.
 */
export function deviceLabel(userAgent: string, maxTouchPoints: number, t: Messages): string {
  const { device } = t.push;
  if (/iPhone|iPod/.test(userAgent)) return device.iphone;
  if (/iPad/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)) {
    return device.ipad;
  }
  const browser = browserOf(userAgent);
  const system = systemOf(userAgent);
  const label =
    browser !== null && system !== null
      ? device.browserOn(browser, system)
      : (browser ?? system ?? device.unknown);
  return label.slice(0, MAX);
}
