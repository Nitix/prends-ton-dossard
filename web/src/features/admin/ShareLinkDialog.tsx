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
 * An invitation comes with a ready message (`message`, which holds the link):
 * it is what is shared or copied unless the link alone is chosen. A reset has
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
  // The choice only exists for an invitation that came with its message.
  const hasMessage =
    kind === "invite" && invitationMessage !== undefined && invitationMessage !== "";
  const [what, setWhat] = useState<"message" | "link">("message");
  const text = hasMessage && what === "message" ? invitationMessage : undefined;
  // What the last press of a button came to. The toast says it too, but a modal
  // dialog makes the rest of the page (the toast) inert, and a screen reader
  // does not read it out: the line below the buttons is inside the dialog.
  const [message, setMessage] = useState<string | null>(null);

  function report(said: string) {
    setMessage(said);
    toast.show(said);
  }

  // Most computers have no share sheet, and a browser that has one may still
  // refuse to share this: the button is only there when it would work.
  const canShare =
    typeof navigator.canShare === "function" &&
    navigator.canShare(text === undefined ? { url } : { text });

  async function share() {
    // Cleared first, so that the same message said twice is read out twice.
    setMessage(null);
    try {
      // The address is inside the text of the message: no `url` beside it, or it would be said twice.
      await navigator.share(
        text === undefined
          ? { url, title: t.admin.shareSubject[kind] }
          : { title: t.admin.shareSubject[kind], text },
      );
    } catch (err) {
      // Closing the share sheet without choosing anything is not a failure.
      if (err instanceof DOMException && err.name === "AbortError") return;
      report(text === undefined ? t.admin.shareFailed : t.admin.messageShareFailed);
    }
  }

  async function copy() {
    setMessage(null);
    try {
      // The clipboard is only there on a page served over HTTPS (or localhost).
      await navigator.clipboard.writeText(text ?? url);
    } catch {
      report(text === undefined ? t.admin.copyFailed : t.admin.messageCopyFailed);
      return;
    }
    report(text === undefined ? t.admin.copied : t.admin.messageCopied);
  }

  return (
    <div className="flex flex-col gap-4">
      <p>{t.admin.shareIntro[kind](runnerName)}</p>
      {hasMessage && (
        <fieldset className="flex flex-col">
          <legend className="eyebrow mb-2">{t.admin.shareWhat}</legend>
          {(["message", "link"] as const).map((choice) => (
            <label key={choice} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="what"
                value={choice}
                checked={what === choice}
                onChange={() => {
                  setWhat(choice);
                  setMessage(null);
                }}
                className="size-5"
              />
              {choice === "message" ? t.admin.shareMessage : t.admin.shareLinkOnly}
            </label>
          ))}
        </fieldset>
      )}
      {text === undefined ? (
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
      ) : (
        <div className="field flex flex-col gap-1">
          <label htmlFor={messageId} className="field-label text-sm font-medium">
            {t.admin.messageLabel}
          </label>
          <textarea
            id={messageId}
            readOnly
            value={text}
            rows={6}
            spellCheck={false}
            // One touch selects all of it, for a copy by hand.
            onFocus={(event) => event.currentTarget.select()}
            className={`${INPUT} w-full text-sm`}
          />
        </div>
      )}
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
