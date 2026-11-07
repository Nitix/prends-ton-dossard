import { useEffect, useId, useRef, useState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { READ_ONLY_INPUT } from "../../components/Field";
import { useI18n } from "../../i18n/I18nProvider";
import { whatsappURL } from "./share";

/**
 * Where there is no share sheet (Firefox on a computer): the text of the race
 * in a read-only field, selected and focused, a button to copy it and a link
 * that opens WhatsApp with it. The link to the race only opens after signing
 * in, which the window says.
 */
export function ShareDialog({
  open,
  onClose,
  text,
}: {
  open: boolean;
  onClose: () => void;
  text: string;
}) {
  const { t } = useI18n();
  const field = useRef<HTMLTextAreaElement>(null);
  const fieldId = useId();
  // What the last press of « Copier » came to, in the window: a modal dialog makes the rest of the page inert.
  const [message, setMessage] = useState<string | null>(null);

  const select = () => {
    field.current?.focus();
    field.current?.select();
  };

  // The dialog opens in its own effect, which runs before this one (its child): the field is shown by now.
  useEffect(() => {
    if (!open) return;
    field.current?.focus();
    field.current?.select();
  }, [open]);

  async function copy() {
    // Cleared first, so that the same message said twice is read out twice.
    setMessage(null);
    try {
      // The clipboard is only there on a page served over HTTPS (or localhost).
      await navigator.clipboard.writeText(text);
    } catch {
      setMessage(t.share.copyFailed);
      select();
      return;
    }
    setMessage(t.share.copied);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t.share.title}>
      <div className="flex flex-col gap-4">
        <div className="field flex flex-col gap-1">
          <label htmlFor={fieldId} className="field-label text-sm font-medium">
            {t.share.textLabel}
          </label>
          <textarea
            id={fieldId}
            ref={field}
            readOnly
            value={text}
            rows={Math.min(10, text.split("\n").length + 1)}
            spellCheck={false}
            // One touch selects all of it, for a copy by hand.
            onFocus={(event) => {
              event.currentTarget.select();
            }}
            className={`${READ_ONLY_INPUT} w-full py-2 text-sm`}
          />
        </div>
        <p className="text-sm text-neutral-600">{t.share.signIn}</p>
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={() => void copy()} className={PRIMARY}>
            {t.share.copy}
          </button>
          <a
            href={whatsappURL(text)}
            target="_blank"
            rel="noopener noreferrer"
            className={`${SECONDARY} inline-flex items-center justify-center`}
          >
            {t.share.whatsapp}
            <span className="sr-only"> {t.share.newTab}</span>
          </a>
          <button type="button" onClick={onClose} className={SECONDARY}>
            {t.common.close}
          </button>
        </div>
        {/* An <output> is a live region (role status). Always there, empty at first: a live region only reads out what is put into it. */}
        <output className="block min-h-5 text-sm font-medium">{message}</output>
      </div>
    </Dialog>
  );
}
