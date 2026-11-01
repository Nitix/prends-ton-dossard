import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { describeError } from "../profile/forms";
import { Section } from "../profile/Section";
import { useCalendarStatus, useCreateCalendar, useDeleteCalendar } from "./api";

/** What the window that asks first is about: a new link, or no link at all. */
type Asking = "renew" | "remove";

/**
 * "Calendar" on the profile page: the link that a calendar app subscribes to.
 * Without a link, a button makes one. The link is shown when it is made, in a
 * field to copy it from, for as long as the page stays open: the server keeps
 * its fingerprint only, so it cannot say it again. After that the page only says
 * that there is one, and offers a new one (the old one stops working) or to
 * delete it, each after a confirmation.
 *
 * The focus never falls to the page. A new link takes it, selected, as the
 * next thing to do is to copy it; when the link is deleted, or the status could
 * not be read and was asked for again, the button that had it goes, and the
 * title of the section takes it; cancelling a confirmation gives it back to the
 * button that opened it.
 */
export function CalendarSection() {
  const { t, lang } = useI18n();
  const status = useCalendarStatus();
  const create = useCreateCalendar();
  const remove = useDeleteCalendar();
  // The address of the link that has just been made. It is kept in this state
  // only, and goes with the page.
  const [link, setLink] = useState<string | null>(null);
  const [asking, setAsking] = useState<Asking | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const field = useRef<HTMLInputElement>(null);
  // The button that opened the window that asks first.
  const opener = useRef<HTMLElement | null>(null);

  // From the section, not from the field: the window that asked first closes in
  // its own effect, which runs before this one. A modal window makes the page
  // behind it inert, and the field cannot take the focus until it is closed.
  useEffect(() => {
    if (link === null) return;
    field.current?.focus();
    field.current?.select();
  }, [link]);

  const unreadable = status.isError && status.data === undefined;
  // The browser gives the focus back to the button that opened a window when it
  // closes, but not to one that never had it (Safari does not focus a button that
  // is tapped), nor to one that is gone: then the title has it.
  useRestoreFocus(asking !== null, () =>
    opener.current?.isConnected ? opener.current : heading.current,
  );
  // The button to read the status again is gone as soon as the request starts.
  useRestoreFocus(unreadable, () => heading.current);

  const open = (event: { currentTarget: HTMLElement }, which: Asking) => {
    opener.current = event.currentTarget;
    setAsking(which);
  };
  const cancel = () => {
    setAsking(null);
  };
  const makeLink = async () => {
    const made = await create.mutateAsync(lang);
    setLink(made.url);
  };
  // Both states change in the same step, so that the page draws once: the window
  // is closed by the time the field takes the focus (see the effect above).
  const renew = async () => {
    const made = await create.mutateAsync(lang);
    setLink(made.url);
    setAsking(null);
  };
  const deleteLink = async () => {
    await remove.mutateAsync();
    setAsking(null);
  };

  return (
    <Section title={t.calendar.title} headingRef={heading}>
      {link !== null && <LinkField url={link} inputRef={field} />}
      {link === null && status.data?.exists === true && (
        <>
          <p>{t.calendar.exists}</p>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={(event) => {
                open(event, "renew");
              }}
              className={SECONDARY}
            >
              {t.calendar.renew}
            </button>
            <button
              type="button"
              onClick={(event) => {
                open(event, "remove");
              }}
              className={`${SECONDARY} ${DANGER_TEXT}`}
            >
              {t.calendar.remove}
            </button>
          </div>
        </>
      )}
      {link === null && status.data?.exists === false && <CreateLink make={makeLink} />}
      {link === null && unreadable && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void status.refetch()}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      )}
      {link === null && status.data === undefined && !unreadable && (
        <output>{t.common.loading}</output>
      )}

      <Dialog open={asking === "renew"} onClose={cancel} title={t.calendar.renew}>
        <ConfirmForm
          hint={t.calendar.renewHint}
          label={t.calendar.renew}
          action={renew}
          onCancel={cancel}
        />
      </Dialog>
      <Dialog open={asking === "remove"} onClose={cancel} title={t.calendar.remove}>
        <ConfirmForm label={t.calendar.remove} danger action={deleteLink} onCancel={cancel} />
      </Dialog>
    </Section>
  );
}

/**
 * Runs an action that the server may refuse, one at a time, and keeps what it
 * says when it does. A second tap can come before the page has drawn the busy
 * state: the ref is set on the spot. After a success the guard is left shut: it
 * is the end of the component that uses it (the button or the window goes with
 * what the action changed), and a new one starts open.
 */
function useAction(action: () => Promise<void>) {
  const { t } = useI18n();
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function run() {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setMessage(null);
    try {
      await action();
    } catch (err) {
      sending.current = false;
      setBusy(false);
      setMessage(describeError(t, err));
    }
  }

  return { run, busy, message };
}

function ErrorMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm font-medium text-red-700">
      {message}
    </p>
  );
}

/** The button that makes the first link. It says it is busy without losing the focus: it is never disabled. */
function CreateLink({ make }: { make: () => Promise<void> }) {
  const { t } = useI18n();
  const { run, busy, message } = useAction(make);

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        aria-disabled={busy || undefined}
        className={`${PRIMARY} self-start ${busy ? "opacity-60" : ""}`}
      >
        {t.calendar.create}
      </button>
      <ErrorMessage message={message} />
    </>
  );
}

/** The content of a window that asks first: what it is about, if it needs saying, and the two buttons. */
function ConfirmForm({
  hint,
  label,
  danger = false,
  action,
  onCancel,
}: {
  hint?: string;
  label: string;
  danger?: boolean;
  /** What is done when the member says so. The window is closed by the caller once it is done. */
  action: () => Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const { run, busy, message } = useAction(action);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {hint !== undefined && <p>{hint}</p>}
      <ErrorMessage message={message} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={busy || undefined}
          className={`${danger ? DANGER : PRIMARY} ${busy ? "opacity-60" : ""}`}
        >
          {label}
        </button>
      </div>
    </form>
  );
}

/**
 * The link that has just been made, in a field that cannot be typed in, with
 * a button to copy it and what to do with it. If the browser cannot copy (it
 * refuses, or has no clipboard), the text is selected for the member to copy it
 * by hand, and nothing says it was copied.
 */
function LinkField({
  url,
  inputRef,
}: {
  url: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const onceId = useId();
  const helpId = useId();

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      inputRef.current?.focus();
      inputRef.current?.select();
      return;
    }
    toast.show(t.calendar.copied);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label={t.calendar.title}
          aria-describedby={`${onceId} ${helpId}`}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-neutral-300 bg-white px-3 text-base"
        />
        <button type="button" onClick={() => void copy()} className={SECONDARY}>
          {t.calendar.copy}
        </button>
      </div>
      <p id={onceId} className="text-sm font-medium">
        {t.calendar.shownOnce}
      </p>
      <p id={helpId} className="text-sm text-neutral-600">
        {t.calendar.help}
      </p>
    </div>
  );
}
