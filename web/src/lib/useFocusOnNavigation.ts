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
 * second; after that, `<main>` itself takes the focus.
 *
 * It never takes the focus from the user who has already put it in the page
 * (a field they started to fill while the page was loading). Focus is the
 * user's when it is inside `<main>`, is not `<main>` itself (which only this
 * hook focuses), and is not what had it when the navigation started: a link
 * of the page that stays on screen, like the menu of the admin pages, keeps
 * the focus it got from the tap that went to the other page, and that is not
 * a choice of the user in the new page.
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
    let focusedBefore: Element | null = null;
    let stopWaiting: (() => void) | undefined;

    // Without a `fromLocation`, this is the first page of the app.
    const unsubscribeStart = router.subscribe(
      "onBeforeNavigate",
      ({ fromLocation, pathChanged }) => {
        if (fromLocation === undefined || !pathChanged) return;
        focusedBefore = document.activeElement;
      },
    );
    const unsubscribeEnd = router.subscribe("onResolved", ({ fromLocation, pathChanged }) => {
      if (fromLocation === undefined || !pathChanged) return;
      // A navigation that follows another one while the page was still
      // loading: the page that counts is the last.
      stopWaiting?.();
      stopWaiting = focusPage(focusedBefore);
    });
    return () => {
      unsubscribeStart();
      unsubscribeEnd();
      stopWaiting?.();
    };
  }, [router]);
}

/**
 * Gives the focus to the title of the page, as soon as it is there. Returns
 * the function that stops waiting for it. `focusedBefore` is what had the
 * focus when the navigation started.
 */
function focusPage(focusedBefore: Element | null): () => void {
  let observer: MutationObserver | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const stop = () => {
    observer?.disconnect();
    clearTimeout(timer);
  };

  if (focusTitle(focusedBefore)) return stop;

  // A title that comes with the data of the page: look again at each change of the page.
  observer = new MutationObserver(() => {
    if (focusTitle(focusedBefore)) stop();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  timer = setTimeout(() => {
    stop();
    const main = document.querySelector("main");
    if (main !== null && !userIsIn(main, focusedBefore)) focus(main);
  }, TITLE_WAIT_MS);
  return stop;
}

/**
 * Focuses the title of the page if it is there. `true` when there is nothing
 * more to wait for: the title has the focus, or the user has put it elsewhere
 * in the page. `false` when there is no title yet, or when it did not take the
 * focus (it is not shown yet): the next change of the page is another try.
 */
function focusTitle(focusedBefore: Element | null): boolean {
  const main = document.querySelector("main");
  if (main === null) return false;
  if (userIsIn(main, focusedBefore)) return true;
  const title = main.querySelector<HTMLElement>("h1");
  return title !== null && focus(title);
}

/**
 * The user has put the focus in the page: on a field, a button, anything inside
 * `<main>` but `<main>` itself, and not what had it before the navigation.
 */
function userIsIn(main: HTMLElement, focusedBefore: Element | null): boolean {
  const active = document.activeElement;
  return active !== null && active !== main && active !== focusedBefore && main.contains(active);
}

/**
 * Gives the focus to `element`, and says whether it landed. Only an element
 * with a `tabindex` can take the focus when it is not a control, as a title or
 * `<main>`: `-1` keeps it out of the order of the Tab key. A `tabindex` that
 * this adds is removed when the element loses the focus, so that `<main>`
 * does not stay a stop of the page for the rest of the session.
 */
function focus(element: HTMLElement): boolean {
  const added = !element.hasAttribute("tabindex");
  if (added) element.tabIndex = -1;
  element.focus({ preventScroll: true });
  const landed = document.activeElement === element;
  if (added) {
    if (landed) {
      element.addEventListener("blur", () => element.removeAttribute("tabindex"), { once: true });
    } else {
      element.removeAttribute("tabindex");
    }
  }
  return landed;
}
