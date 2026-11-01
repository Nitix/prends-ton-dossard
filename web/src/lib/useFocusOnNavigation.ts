import { useRouter } from "@tanstack/react-router";
import { useEffect } from "react";

/** How long a page that loads has to show its title before `<main>` gets the focus instead. */
const TITLE_WAIT_MS = 1000;

/**
 * Moves the focus to the title of the new page when the user goes to another
 * page, for the keyboard and for screen readers: they start the page from
 * its top, and hear what page it is. Without it, the link that was tapped
 * goes away with the old page, and the focus falls back to the `<body>`.
 *
 * It looks at the navigations the router has finished, and acts on those that
 * change the pathname, and only those. Not the first page (nobody came from
 * another page), and not a change of the search or of the hash (the filters
 * of a list, a link to an anchor): the user is still on the same page, and
 * the focus stays where they put it.
 *
 * The title is the first `<h1>` of `<main>`. A page that loads shows a
 * loading state first, so the hook waits for the title to be there, for a
 * second; after that, `<main>` itself takes the focus. It never takes the
 * focus from the user who has already put it in the page, though (a field
 * they started to fill while the page was loading).
 *
 * The router already scrolls a new page to its top, so the focus does not
 * scroll: it would only pull back a reader who went down while the title was
 * coming.
 *
 * Use it once, in the root of the app, where it covers every page, signed in
 * or not.
 */
export function useFocusOnNavigation(): void {
  const router = useRouter();

  useEffect(() => {
    let stopWaiting: (() => void) | undefined;
    const unsubscribe = router.subscribe("onResolved", ({ fromLocation, pathChanged }) => {
      // Without a `fromLocation`, this is the first page of the app.
      if (fromLocation === undefined || !pathChanged) return;
      // A navigation that follows another one while the page was still
      // loading: the page that counts is the last.
      stopWaiting?.();
      stopWaiting = focusPage();
    });
    return () => {
      unsubscribe();
      stopWaiting?.();
    };
  }, [router]);
}

/**
 * Gives the focus to the title of the page, as soon as it is there. Returns
 * the function that stops waiting for it.
 */
function focusPage(): () => void {
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    observer?.disconnect();
    clearTimeout(timer);
  };

  if (focusTitle()) return stop;

  // A title that comes with the data of the page: look again at each change of the page.
  observer = new MutationObserver(() => {
    if (focusTitle()) stop();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setTimeout(() => {
    stop();
    const main = document.querySelector("main");
    if (main !== null && !userIsIn(main)) focus(main);
  }, TITLE_WAIT_MS);
  return stop;
}

/**
 * Focuses the title of the page if it is there. `true` when there is nothing
 * more to wait for: the title has the focus, or the user has put it elsewhere
 * in the page.
 */
function focusTitle(): boolean {
  const main = document.querySelector("main");
  if (main === null) return false;
  if (userIsIn(main)) return true;
  const title = main.querySelector<HTMLElement>("h1");
  if (title === null) return false;
  focus(title);
  return true;
}

/** The user has already put the focus in the page: on a field, a button, anything but the `<body>`. */
function userIsIn(main: HTMLElement): boolean {
  const active = document.activeElement;
  return active !== null && active !== document.body && main.contains(active);
}

function focus(element: HTMLElement): void {
  // Only an element with a `tabindex` can take the focus when it is not a
  // control: a title, `<main>`. `-1` keeps it out of the order of the Tab key.
  if (!element.hasAttribute("tabindex")) element.tabIndex = -1;
  element.focus({ preventScroll: true });
}
