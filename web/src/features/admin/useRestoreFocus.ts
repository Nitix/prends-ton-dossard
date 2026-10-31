import { useEffect, useRef } from "react";

/**
 * Keeps the focus from falling to the `<body>` when a dialog closes. The
 * browser gives the focus back to what had it before the dialog opened, but
 * when that button is gone by then (the action removed it, or removed its
 * whole row) there is nothing to give it back to: `fallback` says where it
 * goes instead. It is only used then, so that cancelling a dialog still
 * lands on the button that opened it.
 *
 * It has to be used by a component that is the parent of the dialog: the
 * dialog closes in its own effect, which runs first.
 */
export function useRestoreFocus(
  open: boolean,
  fallback: () => HTMLElement | null | undefined,
): void {
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) fallback()?.focus();
  }, [open, fallback]);
}
