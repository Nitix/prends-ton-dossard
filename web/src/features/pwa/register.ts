/**
 * Registers the service worker (public/sw.js), which makes the site
 * installable. Only in a build for production: the dev server has no sw.js to
 * send, and a worker would keep the old modules it served. A browser without
 * service workers, or one that refuses this one, loses nothing but the
 * installation: the site is the same without it.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("/sw.js").catch(() => undefined);
}
