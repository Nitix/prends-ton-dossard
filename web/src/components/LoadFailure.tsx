import { useRef, useState, type RefObject } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { SECONDARY } from "./buttons";

/**
 * A request that failed, with nothing to show instead: the message, and the
 * button that asks again.
 *
 * The block is gone as soon as the new request starts (the page says it is
 * loading again), and the button with it. So the focus goes to `heading`, the
 * title of the page or of the section, which has `tabIndex={-1}`, when the
 * button is tapped, before the request: after a retry it is never left on the
 * `<body>`. It is done in the tap and not when the block goes, so that a block
 * that goes by itself (the window is focused again, the request is made again
 * and succeeds) neither moves the focus nor scrolls to the title.
 *
 * The button says it is busy while the request is on its way (`aria-disabled`)
 * and is never `disabled`. A second tap, which can come before the page has
 * drawn the busy state, is ignored: a ref is set on the spot.
 */
export function LoadFailure({
  onRetry,
  heading,
}: {
  /** Asks again. The button is busy until it settles, whichever way. */
  onRetry: () => Promise<unknown> | void;
  /** The title that takes the focus. */
  heading: RefObject<HTMLElement | null>;
}) {
  const { t } = useI18n();
  const asking = useRef(false);
  const [busy, setBusy] = useState(false);

  async function retry() {
    if (asking.current) return;
    asking.current = true;
    setBusy(true);
    heading.current?.focus();
    try {
      await onRetry();
    } catch {
      // Whatever the request says is the page's to show: this only gives the button back.
    } finally {
      asking.current = false;
      setBusy(false);
    }
  }

  return (
    <div className="load-failure flex flex-col gap-3">
      <p role="alert" className="text-sm font-medium text-red-700">
        {t.errors.generic}
      </p>
      <button
        type="button"
        onClick={() => void retry()}
        aria-disabled={busy || undefined}
        className={`${SECONDARY} self-start ${busy ? "opacity-60" : ""}`}
      >
        {t.common.retry}
      </button>
    </div>
  );
}
