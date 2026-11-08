import { useRef, useState } from "react";

import { SECONDARY } from "../../components/buttons";
import { ShareIcon } from "../../components/icons";
import { useI18n } from "../../i18n/I18nProvider";
import { useToday } from "../../lib/useToday";
import type { EventView } from "./api";
import { shareText } from "./share";
import { ShareDialog } from "./ShareDialog";

/**
 * « Partager »: the text of the race through the share sheet of the device when
 * the browser has one (`navigator.share`, with the address in the text, not in
 * `url`); closing the sheet is not a failure. Without one (Firefox on a
 * computer), or when the browser refuses, a window to copy the text or to send
 * it on WhatsApp. `className` is the look of the action it sits among.
 */
export function ShareButton({ view, className }: { view: EventView; className?: string }) {
  const { t, f } = useI18n();
  const today = useToday();
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  // Set on the spot: a second tap while the share sheet is open must not start another.
  const sharing = useRef(false);
  const text = shareText(view, location.origin, today, f, t);

  async function share() {
    if (sharing.current) return;
    const data = { title: view.event.name, text };
    if (typeof navigator.share === "function") {
      // A browser that has a share sheet may still not be able to share this.
      if (typeof navigator.canShare !== "function" || navigator.canShare(data)) {
        sharing.current = true;
        try {
          await navigator.share(data);
          return;
        } catch (err) {
          // Closing the share sheet without choosing anything is not a failure, nor is a sheet already open.
          if (
            err instanceof DOMException &&
            (err.name === "AbortError" || err.name === "InvalidStateError")
          ) {
            return;
          }
        } finally {
          sharing.current = false;
        }
      }
    }
    setOpen(true);
  }

  return (
    <>
      <button
        ref={button}
        type="button"
        data-action="share"
        onClick={() => void share()}
        className={className ?? SECONDARY}
      >
        <ShareIcon className="size-[1.125rem] shrink-0 text-iris-600" />
        {t.share.button}
      </button>
      <ShareDialog
        open={open}
        onClose={() => {
          setOpen(false);
          // The browser gives the focus back too, but not all of them to a button that was tapped.
          button.current?.focus();
        }}
        text={text}
      />
    </>
  );
}
