import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import { DANGER, DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { READ_ONLY_INPUT } from "../../components/Field";
import { LoadFailure } from "../../components/LoadFailure";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import { PARIS } from "../../lib/dates";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { failureOf, text, type Failure } from "../profile/forms";
import { day } from "../profile/PasskeyList";
import { Section } from "../profile/Section";
import {
  useCreateMcpToken,
  useMcpTokens,
  useRevokeMcpToken,
  type CreatedMcpToken,
  type McpToken,
} from "./api";
import { claudeCommand } from "./command";

/** What the window that is open is about: a new token, or the token of the list that is revoked. */
type Asking = "create" | "revoke";

/**
 * "AI assistant (MCP)" on the settings page: the personal tokens with which an
 * assistant acts on the site as the member, to list, make and revoke. The
 * section is absent when the server has no MCP (the demo).
 *
 * A token is made in a window of two steps: its name, then the token itself,
 * shown once, with the command that adds the site to Claude Code. The token
 * lives in that window and nowhere else: not in a cache of the queries (the list
 * only gets the new token's name and dates), not in the page once the window is
 * closed, by the button or by Escape.
 *
 * The focus never falls to the page. A token that is shown takes it, selected, as
 * the next thing to do is to copy it; when the window closes the button that
 * opened it has it back, or the title of the section if that button is gone (a
 * token that is revoked takes its row and its button with it; the fifth token
 * takes the place of the button that makes one); when the list could not be read
 * and the member asks again, the title takes it as they tap (see `LoadFailure`).
 */
export function McpSection() {
  const { t, formatLocale } = useI18n();
  const status = useMcpTokens();
  const [asking, setAsking] = useState<Asking | null>(null);
  // The token of the window that asks first: kept once the window closes, which does not render it then.
  const [target, setTarget] = useState<McpToken | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  // The button that opened the window.
  const opener = useRef<HTMLElement | null>(null);

  // The browser gives the focus back to the button that opened a window when it
  // closes, but not to one that never had it (Safari does not focus a button that
  // is tapped), nor to one that is gone: then the title has it.
  useRestoreFocus(asking !== null, () =>
    opener.current?.isConnected ? opener.current : heading.current,
  );

  // The server has no MCP: nothing to show, and nothing to say about it.
  if (status.data === null) return null;

  const list = status.data;
  const unreadable = status.isError && list === undefined;
  const close = () => {
    setAsking(null);
  };
  const open = (event: { currentTarget: HTMLElement }, which: Asking) => {
    opener.current = event.currentTarget;
    setAsking(which);
  };

  return (
    <Section title={t.mcp.title} headingRef={heading}>
      {list !== undefined && (
        <>
          <p className="text-sm text-neutral-600">{t.mcp.intro}</p>
          {list.tokens.length === 0 ? (
            <p className="text-sm">{t.mcp.empty}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {list.tokens.map((token) => (
                <li
                  key={token.id}
                  className="passkey-row flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-neutral-50 p-3.5 ring-1 ring-neutral-100"
                >
                  <div className="min-w-0">
                    <p className="font-medium break-words">{token.name}</p>
                    <p className="text-sm text-neutral-600">
                      {t.mcp.created(day(formatLocale, token.created))}
                      {" · "}
                      {token.lastUsedAt === ""
                        ? t.mcp.neverUsed
                        : t.mcp.lastUsed(dayAndTime(formatLocale, token.lastUsedAt))}
                    </p>
                  </div>
                  {/* The name of the token is in the accessible name only: the
                      buttons of a list would otherwise sound the same. It starts
                      with the visible text, as an accessible name should. */}
                  <button
                    type="button"
                    onClick={(event) => {
                      setTarget(token);
                      open(event, "revoke");
                    }}
                    aria-label={t.mcp.revokeLabel(token.name)}
                    className={`${SECONDARY} ${DANGER_TEXT}`}
                  >
                    {t.mcp.revoke}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.tokens.length >= list.max ? (
            <p className="text-sm">{t.mcp.limit(list.max)}</p>
          ) : (
            <button
              type="button"
              onClick={(event) => {
                open(event, "create");
              }}
              className={`${PRIMARY} self-start`}
            >
              {t.mcp.create}
            </button>
          )}
        </>
      )}
      {unreadable && <LoadFailure onRetry={status.refetch} heading={heading} />}
      {list === undefined && !unreadable && <output>{t.common.loading}</output>}

      <Dialog open={asking === "create"} onClose={close} title={t.mcp.createTitle}>
        <CreateToken onClose={close} />
      </Dialog>
      <Dialog open={asking === "revoke"} onClose={close} title={t.mcp.revokeTitle}>
        {target !== null && <RevokeToken token={target} onClose={close} />}
      </Dialog>
    </Section>
  );
}

/** The day and the time of a PocketBase date-time (UTC, `YYYY-MM-DD HH:MM:SS.sssZ`), in Paris, as the locale writes them. */
function dayAndTime(formatLocale: string, dateTime: string): string {
  return new Date(dateTime.replace(" ", "T")).toLocaleString(formatLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: PARIS,
  });
}

/**
 * Runs an action that the server may refuse, one at a time, and keeps what it
 * says when it does. A second tap can come before the page has drawn the busy
 * state: the ref is set on the spot. After a success the guard is left shut: it
 * is the end of the component that uses it (the window goes with what the action
 * did), and a new one starts open. `fields` are the fields of the form that a
 * refusal may be about.
 */
function useAction<Field extends string>(fields: readonly Field[]) {
  const sending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure<Field> | null>(null);

  async function run(action: () => Promise<void>) {
    if (sending.current) return;
    sending.current = true;
    setBusy(true);
    setFailure(null);
    try {
      await action();
    } catch (err) {
      sending.current = false;
      setBusy(false);
      setFailure(failureOf(err, fields));
    }
  }

  return { run, busy, failure, refuse: setFailure };
}

/** The message of the refusal of an action, if there was one. */
function ErrorMessage({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm font-medium text-red-700">
      {message}
    </p>
  );
}

// --- Making a token ---

/**
 * The content of the window that makes a token: its name, then the token. The
 * window renders it while it is open only, so it starts over each time: what the
 * token is kept in is gone with it. The mutation that made it lets go of its
 * answer as soon as the token is here, and again if the window goes first.
 */
function CreateToken({ onClose }: { onClose: () => void }) {
  const { mutateAsync, reset } = useCreateMcpToken();
  const [made, setMade] = useState<CreatedMcpToken | null>(null);

  useEffect(() => reset, [reset]);

  async function make(name: string) {
    const created = await mutateAsync(name);
    // From here the token is in this window alone.
    reset();
    setMade(created);
  }

  if (made !== null) return <ShownToken made={made} onClose={onClose} />;
  return <NameForm make={make} onClose={onClose} />;
}

/** The name of the token. A refusal (a name that is empty, the limit) stays in the window, with what was typed. */
function NameForm({
  make,
  onClose,
}: {
  make: (name: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const { run, busy, failure, refuse } = useAction(["name"]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = text(new FormData(event.currentTarget), "name").trim();
    // The server says the same of a name of spaces: this spares it the request.
    if (name === "") {
      refuse({ code: "validation_required", field: "name" });
      return;
    }
    void run(() => make(name));
  }

  const message = failure === null ? null : translateError(t, failure.code);
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <TextField
        label={t.mcp.name}
        name="name"
        autoComplete="off"
        defaultValue=""
        hint={t.mcp.nameHint}
        error={failure?.field === "name" ? message : null}
      />
      <ErrorMessage message={failure?.field === null ? message : null} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={busy || undefined}
          className={`${PRIMARY} ${busy ? "opacity-60" : ""}`}
        >
          {t.mcp.createSubmit}
        </button>
      </div>
    </form>
  );
}

/**
 * The token, once: in a field to copy it from, with the command that adds the
 * site to Claude Code and what to do for another assistant. What was copied is
 * said in a line of the window as well as by a message: a modal window makes the
 * page behind it inert, and the messages that rise from the corner with it.
 */
function ShownToken({ made, onClose }: { made: CreatedMcpToken; onClose: () => void }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState<string | null>(null);
  const showOnceId = useId();
  const claudeCodeId = useId();

  return (
    <div className="flex flex-col gap-4">
      <p id={showOnceId} className="font-medium">
        {t.mcp.showOnce}
      </p>
      <CopyField
        label={t.mcp.tokenLabel}
        value={made.token}
        copyLabel={t.mcp.copyToken}
        copiedMessage={t.mcp.tokenCopied}
        describedBy={showOnceId}
        takeFocus
        onCopied={setCopied}
      />
      <p id={claudeCodeId}>{t.mcp.claudeCode}</p>
      <CopyField
        label={t.mcp.commandLabel}
        value={claudeCommand(made.url, made.token)}
        copyLabel={t.mcp.copyCommand}
        copiedMessage={t.mcp.commandCopied}
        describedBy={claudeCodeId}
        multiline
        onCopied={setCopied}
      />
      <p className="text-sm text-neutral-600">{t.mcp.otherClients(made.url)}</p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <output className="text-sm font-medium">{copied}</output>
        <button type="button" onClick={onClose} className={PRIMARY}>
          {t.mcp.done}
        </button>
      </div>
    </div>
  );
}

/** Gives the field the focus, with all its text selected: ready to be copied by hand. */
function selectText(field: HTMLInputElement | HTMLTextAreaElement | null) {
  field?.focus();
  field?.select();
}

/**
 * A text in a field that cannot be typed in, with a button to copy it: the
 * token, or the command. `takeFocus` gives the field the focus, with its text
 * selected, when it is shown. If the browser cannot copy (it refuses, or has no
 * clipboard), the text is selected for the member to copy it by hand, and
 * nothing says it was copied. `multiline` is a field of several lines, in
 * which the text wraps.
 */
function CopyField({
  label,
  value,
  copyLabel,
  copiedMessage,
  describedBy,
  multiline = false,
  takeFocus = false,
  onCopied,
}: {
  /** The name of the field: the text above it says what it is for, and describes it. */
  label: string;
  value: string;
  copyLabel: string;
  copiedMessage: string;
  describedBy: string;
  multiline?: boolean;
  takeFocus?: boolean;
  onCopied: (message: string) => void;
}) {
  const toast = useToast();
  const id = useId();
  const field = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const setField = (element: HTMLInputElement | HTMLTextAreaElement | null) => {
    field.current = element;
  };

  useEffect(() => {
    if (takeFocus) selectText(field.current);
  }, [takeFocus]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      selectText(field.current);
      return;
    }
    toast.show(copiedMessage);
    onCopied(copiedMessage);
  }

  return (
    <div className="field flex flex-col gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <div className="flex flex-wrap gap-2">
        {multiline ? (
          <textarea
            ref={setField}
            id={id}
            readOnly
            rows={5}
            spellCheck={false}
            value={value}
            aria-describedby={describedBy}
            className={`${READ_ONLY_INPUT} [field-sizing:content] min-h-24 w-full resize-none py-2.5 font-mono`}
          />
        ) : (
          <input
            ref={setField}
            id={id}
            readOnly
            spellCheck={false}
            value={value}
            aria-describedby={describedBy}
            className={`${READ_ONLY_INPUT} min-w-0 flex-[1_1_12rem] font-mono`}
          />
        )}
        <button type="button" onClick={() => void copy()} className={`${SECONDARY} self-start`}>
          {copyLabel}
        </button>
      </div>
    </div>
  );
}

// --- Revoking a token ---

/** The content of the window that asks first: what the assistant loses, and the two buttons. */
function RevokeToken({ token, onClose }: { token: McpToken; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const revoke = useRevokeMcpToken();
  const { run, busy, failure } = useAction([]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void run(async () => {
      await revoke.mutateAsync(token.id);
      toast.show(t.mcp.revoked);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <p>{t.mcp.revokeWarning(token.name)}</p>
      <ErrorMessage message={failure === null ? null : translateError(t, failure.code)} />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button
          type="submit"
          aria-disabled={busy || undefined}
          className={`${DANGER} ${busy ? "opacity-60" : ""}`}
        >
          {t.mcp.revoke}
        </button>
      </div>
    </form>
  );
}
