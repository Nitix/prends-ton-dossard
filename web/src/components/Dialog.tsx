import { useEffect, useId, useRef, type ReactNode } from "react";

import { useI18n } from "../i18n/I18nProvider";

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

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // The native "close" event also follows a close made by the parent: only
      // a close the user asked for (open is still true) is reported.
      onClose={() => {
        if (open) onClose();
      }}
      // Tailwind's reset zeroes the margin that centres a dialog.
      className="m-auto max-h-[90dvh] w-[min(32rem,calc(100%-2rem))] overflow-y-auto rounded-xl bg-white p-0 text-neutral-900 shadow-xl backdrop:bg-black/50"
    >
      {open && (
        <div className="p-4">
          <div className="mb-4 flex items-start justify-between gap-2">
            <h2 id={titleId} className="text-lg font-semibold">
              {title}
            </h2>
            <button
              type="button"
              onClick={onClose}
              aria-label={t.common.close}
              className="-mt-2 -mr-2 flex size-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none hover:bg-neutral-100"
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
