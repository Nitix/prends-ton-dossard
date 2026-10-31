import { useId, useState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { INPUT } from "../../components/Field";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { InvitationKind } from "../../lib/types";
import { expiryDay } from "./memberState";

/**
 * Shows the link of an invitation or of a reset, to send to the person it is
 * for. The token is in the link and the server keeps no copy of it: this
 * dialog is the only place the link can be read, hence the field to copy it
 * from by hand when the buttons cannot.
 *
 * Where the browser has a share sheet (a phone), « Partager » opens it; it
 * works in any browser to « Copier » the link.
 *
 * `url` and `expiresAt` (RFC 3339) are only read while the dialog is open.
 */
export function ShareLinkDialog({
  open,
  onClose,
  url,
  expiresAt,
  kind,
  runnerName,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  expiresAt: string;
  kind: InvitationKind;
  runnerName: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.admin.shareTitle[kind](runnerName)}>
      <ShareForm url={url} expiresAt={expiresAt} kind={kind} runnerName={runnerName} />
    </Dialog>
  );
}

function ShareForm({
  url,
  expiresAt,
  kind,
  runnerName,
}: {
  url: string;
  expiresAt: string;
  kind: InvitationKind;
  runnerName: string;
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const inputId = useId();
  // What the last press of a button came to. The toast says it too, but a modal
  // dialog makes the rest of the page (the toast) inert, and a screen reader
  // does not read it out: the line below the buttons is inside the dialog.
  const [message, setMessage] = useState<string | null>(null);

  function report(text: string) {
    setMessage(text);
    toast.show(text);
  }

  // Most computers have no share sheet, and a browser that has one may still
  // refuse to share this: the button is only there when it would work.
  const canShare = typeof navigator.canShare === "function" && navigator.canShare({ url });

  async function share() {
    // Cleared first, so that the same message said twice is read out twice.
    setMessage(null);
    try {
      await navigator.share({ url, title: t.admin.shareSubject[kind] });
    } catch (err) {
      // Closing the share sheet without choosing anything is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      report(t.admin.shareFailed);
    }
  }

  async function copy() {
    setMessage(null);
    try {
      // The clipboard is only there on a page served over HTTPS (or localhost).
      await navigator.clipboard.writeText(url);
    } catch {
      report(t.admin.copyFailed);
      return;
    }
    report(t.admin.copied);
  }

  return (
    <div className="flex flex-col gap-4">
      <p>{t.admin.shareIntro[kind](runnerName)}</p>
      <div className="flex flex-col gap-1">
        <label htmlFor={inputId} className="text-sm font-medium">
          {t.admin.link}
        </label>
        <input
          id={inputId}
          readOnly
          value={url}
          autoComplete="off"
          spellCheck={false}
          // One touch selects all of it, for a copy by hand.
          onFocus={(event) => event.currentTarget.select()}
          className={`${INPUT} w-full font-mono text-sm`}
        />
      </div>
      <p className="text-sm">{t.admin.expires(f.dateLong(expiryDay(expiresAt)))}</p>
      <p className="text-sm text-neutral-600">{t.admin.shareOnce}</p>
      <div className="flex flex-wrap justify-end gap-2">
        {canShare && (
          <button type="button" onClick={() => void share()} className={PRIMARY}>
            {t.admin.share}
          </button>
        )}
        <button
          type="button"
          onClick={() => void copy()}
          className={canShare ? SECONDARY : PRIMARY}
        >
          {t.admin.copy}
        </button>
      </div>
      {/* An <output> is a live region (role status). Always there, empty at first: a live region only reads out what is put into it. */}
      <output className="block min-h-5 text-sm font-medium">{message}</output>
    </div>
  );
}
