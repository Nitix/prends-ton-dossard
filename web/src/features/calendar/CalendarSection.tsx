import { useEffect, useId, useRef, useState, type FormEvent, type RefObject } from "react";

import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { READ_ONLY_INPUT } from "../../components/Field";
import { LoadFailure } from "../../components/LoadFailure";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { describeError } from "../profile/forms";
import { Section } from "../profile/Section";
import { useCalendarStatus, useCreateCalendar, useDeleteCalendar, type CalendarScope } from "./api";

/** What the window that asks first is about: a new link, or no link at all. */
type Asking = "renew" | "remove";

/**
 * "Calendar" on the settings page: the links that a calendar app subscribes to,
 * in two blocks that are the same component: "Mes courses" (the races of the
 * member) and "Les courses du groupe" (every race where somebody goes, with who;
 * absent where the server has no such link, which is the demo).
 *
 * The title of the section takes the focus when a link goes and its button with
 * it: it is the `heading` of each block.
 */
export function CalendarSection() {
  const { t } = useI18n();
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <Section title={t.calendar.title} headingRef={heading}>
      <CalendarLinkBlock scope="mine" heading={heading} />
      <CalendarLinkBlock scope="group" heading={heading} />
    </Section>
  );
}

/**
 * One calendar link of the settings page: the link that a calendar app subscribes
 * to, of the kind `scope`. Without a link, a button makes one, and the link is
 * shown at once, in a field to copy it from. With a link, the page says so and
 * offers to show it again (the server keeps it, and the status carries its
 * address), a new one (the old one stops working) or to delete it, the last two
 * after a confirmation, and always: also when the link has just been made. A link
 * made before the server kept the address cannot be shown: the page says so, and
 * the member makes a new one. The other kind of link is never touched.
 *
 * The focus never falls to the page. A link that is shown takes it, selected,
 * as the next thing to do is to copy it (the button that was tapped to show it
 * is gone); when the link is deleted, the button that had it goes, and the title
 * of the section takes it; when the status could not be read and the member asks
 * again, the title takes it as they tap (see `LoadFailure`), and not when the
 * status comes back, which can be on its own when the window is focused again:
 * the page must not scroll to the title then; cancelling a confirmation gives it
 * back to the button that opened it.
 */
function CalendarLinkBlock({
  scope,
  heading,
}: {
  scope: CalendarScope;
  heading: RefObject<HTMLHeadingElement | null>;
}) {
  const { t, lang } = useI18n();
  const status = useCalendarStatus(scope);
  const create = useCreateCalendar(scope);
  const remove = useDeleteCalendar(scope);
  const titleId = useId();
  const group = scope === "group";
  const title = group ? t.calendar.group : t.calendar.mine;
  // Whether the member has the link on screen: they asked for it, or made it.
  // The address is the one of the status, which a new link replaces.
  const [shown, setShown] = useState(false);
  const [asking, setAsking] = useState<Asking | null>(null);
  const field = useRef<HTMLInputElement>(null);
  // The button that opened the window that asks first.
  const opener = useRef<HTMLElement | null>(null);

  // The address that the field is to take the focus for, once it shows it: the
  // one that was asked for, or that has just been made. The status takes the
  // address of a new link a moment after the answer, so that the field can have
  // the old one when the member asks for the new one: it waits for the right one.
  const focusFor = useRef<string | null>(null);

  // From the section, not from the field: the window that asked first closes in
  // its own effect, which runs before this one. A modal window makes the page
  // behind it inert, and the field cannot take the focus until it is closed.
  const url = status.data?.url ?? "";
  useEffect(() => {
    if (!shown || asking !== null || url === "" || focusFor.current !== url) return;
    focusFor.current = null;
    field.current?.focus();
    field.current?.select();
  }, [shown, asking, url]);

  const unreadable = status.isError && status.data === undefined;
  // The browser gives the focus back to the button that opened a window when it
  // closes, but not to one that never had it (Safari does not focus a button that
  // is tapped), nor to one that is gone: then the title has it.
  useRestoreFocus(asking !== null, () =>
    opener.current?.isConnected ? opener.current : heading.current,
  );

  const open = (event: { currentTarget: HTMLElement }, which: Asking) => {
    opener.current = event.currentTarget;
    setAsking(which);
  };
  const cancel = () => {
    setAsking(null);
  };
  const show = () => {
    focusFor.current = url;
    setShown(true);
  };
  const makeLink = async () => {
    const made = await create.mutateAsync(lang);
    focusFor.current = made.url;
    setShown(true);
  };
  // Both states change in the same step, so that the page draws once: the window
  // is closed by the time the field takes the focus (see the effect above).
  const renew = async () => {
    const made = await create.mutateAsync(lang);
    focusFor.current = made.url;
    setShown(true);
    setAsking(null);
  };
  const deleteLink = async () => {
    await remove.mutateAsync();
    setShown(false);
    setAsking(null);
  };

  // The server has no link of this kind to give (the group's, on the demo): the
  // block is not there at all.
  if (status.data === null) return null;

  return (
    <fieldset aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <h3 id={titleId} className="eyebrow">
        {title}
      </h3>
      {group && <p className="text-sm text-neutral-600">{t.calendar.groupHelp}</p>}
      {status.data?.exists === true && (
        <>
          <p>{group ? t.calendar.groupExists : t.calendar.exists}</p>
          {shown && url !== "" && <LinkField url={url} label={title} inputRef={field} />}
          {url === "" && <p>{t.calendar.legacy}</p>}
          <div className="flex flex-wrap gap-2">
            {!shown && url !== "" && (
              <button type="button" onClick={show} className={PRIMARY}>
                {t.calendar.show}
              </button>
            )}
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
      {status.data?.exists === false && (
        <CreateLink make={makeLink} label={group ? t.calendar.groupCreate : t.calendar.create} />
      )}
      {unreadable && <LoadFailure onRetry={status.refetch} heading={heading} />}
      {status.data === undefined && !unreadable && <output>{t.common.loading}</output>}

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
    </fieldset>
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
function CreateLink({ make, label }: { make: () => Promise<void>; label: string }) {
  const { run, busy, message } = useAction(make);

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        aria-disabled={busy || undefined}
        className={`${PRIMARY} self-start ${busy ? "opacity-60" : ""}`}
      >
        {label}
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
 * The link, in a field that cannot be typed in, with a button to copy it and
 * what to do with it. If the browser cannot copy (it refuses, or has no
 * clipboard), the text is selected for the member to copy it by hand, and
 * nothing says it was copied.
 */
function LinkField({
  url,
  label,
  inputRef,
}: {
  url: string;
  /** What the field is called: the block it is in. */
  label: string;
  inputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18n();
  const toast = useToast();
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
    <div className="field flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label={label}
          aria-describedby={helpId}
          className={`${READ_ONLY_INPUT} min-w-0 flex-1`}
        />
        <button type="button" onClick={() => void copy()} className={SECONDARY}>
          {t.calendar.copy}
        </button>
      </div>
      <p id={helpId} className="field-hint text-sm text-neutral-600">
        {t.calendar.help}
      </p>
    </div>
  );
}
