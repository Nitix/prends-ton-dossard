import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type ChangeEvent } from "react";

import { describeError } from "../features/profile/forms";
import { useI18n } from "../i18n/I18nProvider";
import { removeAvatar, uploadAvatar } from "../lib/avatar";
import { ImageDecodeError, toAvatarBlob } from "../lib/resizeImage";
import type { RunnerRecord } from "../lib/types";
import { Avatar } from "./Avatar";
import { SECONDARY } from "./buttons";
import { useToast } from "./Toast";

/** What the picker tells: a state (`status`, said politely) or a refusal (`alert`). */
type Message = { role: "status" | "alert"; text: string };

/**
 * Changes or removes the photo of a runner: the photo, as it is now, the
 * button to choose another, and the button to take it away when there is one.
 *
 * A picked file is read by the browser, reduced and encoded (see
 * `toAvatarBlob`) before it is sent: a photo from a phone is several
 * megabytes, and the server would refuse a file over 5 MB. One that the
 * browser cannot read (HEIC, outside Safari) is told to the user, and nothing
 * is sent.
 *
 * The runner is the one of the screen, which reads it again after a change:
 * the picker follows what it is given and keeps no copy of its own.
 *
 * The field is a label around a file input that is hidden from sight, so that
 * it has the size and the look of a button: the label is what is tapped, and
 * what shows the focus.
 */
export function AvatarPicker({ runner }: { runner: RunnerRecord }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const field = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  /**
   * Makes a change, then has the app read the runner again (it is shown all
   * over, as when it is renamed) before saying that it is done. `working` is
   * what to say while it goes on, if there is anything to say.
   */
  async function change(
    make: () => Promise<unknown>,
    done: string,
    working: string | null,
  ): Promise<boolean> {
    setBusy(true);
    setMessage(working === null ? null : { role: "status", text: working });
    try {
      await make();
    } catch (err) {
      setMessage({
        role: "alert",
        text: err instanceof ImageDecodeError ? t.avatar.decodeFailed : describeError(t, err),
      });
      setBusy(false);
      return false;
    }
    await queryClient.invalidateQueries();
    setMessage({ role: "status", text: done });
    // The window of a dialog covers the toasts: the message above is for it.
    toast.show(done);
    setBusy(false);
    return true;
  }

  function choose(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    // Emptied, so that the same file can be chosen again, after a refusal.
    event.currentTarget.value = "";
    if (file === undefined || busy) return;
    void change(
      async () => {
        await uploadAvatar(runner.id, await toAvatarBlob(file));
      },
      t.avatar.saved,
      t.avatar.preparing,
    );
  }

  async function remove() {
    if (busy) return;
    if (await change(() => removeAvatar(runner.id), t.avatar.removed, null)) {
      // The button is gone with the photo, and the focus with it.
      field.current?.focus();
    }
  }

  return (
    <div className="flex flex-col items-start gap-3">
      <Avatar
        runner={runner}
        thumb="256x256"
        className="size-32 shrink-0 bg-neutral-200 text-4xl font-semibold text-neutral-700"
      />
      <div className="flex flex-wrap gap-2">
        <label
          className={`${SECONDARY} inline-flex cursor-pointer items-center has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-neutral-900 ${
            busy ? "opacity-60" : ""
          }`}
        >
          {t.avatar.change}
          <input
            ref={field}
            type="file"
            accept="image/*"
            aria-disabled={busy || undefined}
            onChange={choose}
            className="sr-only"
          />
        </label>
        {runner.avatar && (
          <button
            type="button"
            aria-disabled={busy || undefined}
            onClick={() => void remove()}
            className={`${SECONDARY} ${busy ? "opacity-60" : ""}`}
          >
            {t.avatar.remove}
          </button>
        )}
      </div>
      {message?.role === "status" && <output>{message.text}</output>}
      {message?.role === "alert" && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message.text}
        </p>
      )}
    </div>
  );
}
