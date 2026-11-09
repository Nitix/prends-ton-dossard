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
 * An invitation comes with a ready message (`message`, which holds the link),
 * shown above the link, each with its own buttons. A reset has
 * only the link.
 *
 * `url`, `message` and `expiresAt` (RFC 3339) are only read while the dialog is open.
 */
export function ShareLinkDialog({
  open,
  onClose,
  url,
  expiresAt,
  kind,
  message,
  runnerName,
}: {
  open: boolean;
  onClose: () => void;
  url: string;
  expiresAt: string;
  kind: InvitationKind;
  message?: string;
  runnerName: string;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.admin.shareTitle[kind](runnerName)}>
      <ShareForm
        url={url}
        expiresAt={expiresAt}
        kind={kind}
        message={message}
        runnerName={runnerName}
      />
    </Dialog>
  );
}

// Most computers have no share sheet, and a browser that has one may still
// refuse to share this: a button is only there when it would work.
function canShareData(data: ShareData): boolean {
  return typeof navigator.canShare === "function" && navigator.canShare(data);
}

function ShareForm({
  url,
  expiresAt,
  kind,
  message: invitationMessage,
  runnerName,
}: {
  url: string;
  expiresAt: string;
  kind: InvitationKind;
  message?: string;
  runnerName: string;
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const inputId = useId();
  const messageId = useId();
  // A reset has only its link; an invitation also shows its ready message.
  const message =
    kind === "invite" && invitationMessage !== undefined && invitationMessage !== ""
      ? invitationMessage
      : undefined;
  // What the last press of a button came to. The toast says it too, but a modal
  // dialog makes the rest of the page (the toast) inert, and a screen reader
  // does not read it out: the line below the buttons is inside the dialog.
  const [report, setReport] = useState<string | null>(null);

  function say(said: string) {
    setReport(said);
    toast.show(said);
  }

  const canShareLink = canShareData({ url });
  const canShareMessage = message !== undefined && canShareData({ text: message });

  async function share(data: ShareData, failed: string) {
    // Cleared first, so that the same message said twice is read out twice.
    setReport(null);
    try {
      await navigator.share(data);
    } catch (err) {
      // Closing the share sheet without choosing anything is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      say(failed);
    }
  }

  async function copy(text: string, done: string, failed: string) {
    setReport(null);
    try {
      // The clipboard is only there on a page served over HTTPS (or localhost).
      await navigator.clipboard.writeText(text);
    } catch {
      say(failed);
      return;
    }
    say(done);
  }

  const title = t.admin.shareSubject[kind];
  // One main button: the first one of the dialog. Without a message, the link's.
  const linkLabels =
    message === undefined
      ? { share: t.admin.share, copy: t.admin.copy }
      : { share: t.admin.shareLinkButton, copy: t.admin.copyLink };
  const linkShareClass = message === undefined && canShareLink ? PRIMARY : SECONDARY;
  const linkCopyClass = message === undefined && !canShareLink ? PRIMARY : SECONDARY;
  const messageCopyClass = canShareMessage ? SECONDARY : PRIMARY;

  return (
    <div className="flex flex-col gap-4">
      <p>{t.admin.shareIntro[kind](runnerName)}</p>
      {message !== undefined && (
        <div className="flex flex-col gap-2">
          <div className="field flex flex-col gap-1">
            <label htmlFor={messageId} className="field-label text-sm font-medium">
              {t.admin.messageLabel}
            </label>
            <textarea
              id={messageId}
              readOnly
              value={message}
              rows={6}
              spellCheck={false}
              // One touch selects all of it, for a copy by hand.
              onFocus={(event) => event.currentTarget.select()}
              className={`${INPUT} w-full text-sm`}
            />
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {canShareMessage && (
              <button
                type="button"
                // The address is inside the text of the message: no `url` beside it, or it would be said twice.
                onClick={() => void share({ title, text: message }, t.admin.messageShareFailed)}
                className={PRIMARY}
              >
                {t.admin.shareMessageButton}
              </button>
            )}
            <button
              type="button"
              onClick={() => void copy(message, t.admin.messageCopied, t.admin.messageCopyFailed)}
              className={messageCopyClass}
            >
              {t.admin.copyMessage}
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <div className="field flex flex-col gap-1">
          <label htmlFor={inputId} className="field-label text-sm font-medium">
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
        <div className="flex flex-wrap justify-end gap-2">
          {canShareLink && (
            <button
              type="button"
              onClick={() => void share({ url, title }, t.admin.shareFailed)}
              className={linkShareClass}
            >
              {linkLabels.share}
            </button>
          )}
          <button
            type="button"
            onClick={() => void copy(url, t.admin.copied, t.admin.copyFailed)}
            className={linkCopyClass}
          >
            {linkLabels.copy}
          </button>
        </div>
      </div>
      <p className="text-sm">{t.admin.expires(f.dateLong(expiryDay(expiresAt)))}</p>
      <p className="text-sm text-neutral-600">{t.admin.shareOnce}</p>
      {/* An <output> is a live region (role status). Always there, empty at first: a live region only reads out what is put into it. */}
      <output className="block min-h-5 text-sm font-medium">{report}</output>
    </div>
  );
}
