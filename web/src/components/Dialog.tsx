import { useEffect, useId, useRef, type ReactNode } from "react";

import { useI18n } from "../i18n/I18nProvider";

/**
 * The last thing a pointer pressed that takes the focus. Safari (and Firefox on
 * a Mac) do not focus a button or a link that is clicked: the focus stays on
 * the page, so when a dialog closes, the browser has no element to give it
 * back to. The dialog uses this one instead.
 */
let lastPressed: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener(
    "click",
    (event) => {
      const target = event.target instanceof Element ? event.target : null;
      lastPressed =
        target?.closest<HTMLElement>("button, a[href], summary, [role='button']") ?? null;
    },
    true,
  );
}

/**
 * The browser gives the focus back to what had it, which is nothing when the
 * click did not focus the opener (Safari), and WebKit then leaves it on the
 * closed dialog itself: the opener has it, or the page (the body), as a parent
 * that looks for a place for it (useRestoreFocus) expects.
 */
function giveFocusBack(dialog: HTMLDialogElement, opener: HTMLElement | null) {
  const active = document.activeElement;
  if (!(active === document.body || dialog.contains(active))) return;
  if (opener?.isConnected) opener.focus();
  else if (active instanceof HTMLElement) active.blur();
}

/**
 * A modal window, on the native `<dialog>`: it gets the focus trap, the Esc
 * key and the backdrop from the browser.
 *
 * `onClose` is called when the user closes it (Esc or the close button); the
 * parent then sets `open` to false. It is not called when the parent closes
 * it. The children are only rendered while it is open, so they start fresh
 * each time.
 */
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  // What had the focus when the dialog opened, to give it back when it closes.
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      const active = document.activeElement;
      opener.current =
        active instanceof HTMLElement && active !== document.body ? active : lastPressed;
      dialog.showModal();
    }
    if (!open && dialog.open) {
      dialog.close();
      giveFocusBack(dialog, opener.current);
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // The native "close" event also follows a close made by the parent: only
      // a close the user asked for (open is still true) is reported. React
      // makes the event of a dialog inside this one go up through this one
      // too, though the browser does not: it is not a close of this dialog.
      onClose={(event) => {
        if (event.target !== event.currentTarget || !open) return;
        giveFocusBack(event.currentTarget, opener.current);
        onClose();
      }}
      // Tailwind's reset zeroes the margin that centres a dialog.
      className="dialog m-auto max-h-[90dvh] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-[1.75rem] border border-rim bg-raised p-0 text-ink shadow-[0_30px_80px_-20px_var(--shade-dialog)] backdrop:bg-scrim backdrop:backdrop-blur-[3px]"
    >
      {open && (
        <div className="dialog-content relative p-5">
          {/* A glow of sunrise at the top of the window. */}
          <span
            aria-hidden="true"
            className="dialog-glow pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-blush-100/70 via-iris-50/40 to-transparent"
          />
          <span
            aria-hidden="true"
            className="dialog-band absolute inset-x-6 top-0 h-1 rounded-b-full bg-dawn"
          />
          <div className="dialog-head relative mb-4 flex items-start justify-between gap-2">
            <h2
              id={titleId}
              className="dialog-title pt-1.5 font-display text-xl font-extrabold display-title"
            >
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.common.close}
              className="dialog-close press -mt-1 -mr-1 flex size-11 shrink-0 items-center justify-center rounded-full bg-raised/80 text-2xl leading-none text-neutral-700 shadow-[0_1px_3px_rgb(36_27_53/0.12)] hover:bg-iris-50 hover:text-ink"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          <div className="dialog-body relative">{children}</div>
        </div>
      )}
    </dialog>
  );
}
