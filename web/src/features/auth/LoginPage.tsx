import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { useActionState, useEffect, useId, useRef, useState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { INPUT } from "../../components/Field";
import { errorCode, translateError } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";
import { enterDemo, fetchDemoEnabled } from "./demo";
import { conditionalLoginAvailable, loginWithPasskey, passkeysSupported } from "./passkeys";
import { safeRedirect } from "./session";

type LoginError = "bad_credentials" | "account_disabled" | "generic";

/** What the form shows: the email that was typed, and why the last attempt failed. */
type LoginState = { email: string; error: LoginError | null };

/**
 * PocketBase answers 400 to a wrong email or password, and 403 when the
 * account is disabled (the `authRule` of the collection). Anything else is a
 * failure we cannot explain: no network, a server error, too many attempts.
 */
function loginError(err: unknown): LoginError {
  if (err instanceof ClientResponseError) {
    if (err.status === 400) return "bad_credentials";
    if (err.status === 403) return "account_disabled";
  }
  return "generic";
}

function errorMessage(t: Messages, error: LoginError | null): string | null {
  if (error === null) return null;
  if (error === "bad_credentials") return t.auth.badCredentials;
  if (error === "account_disabled") return t.errors.account_disabled;
  return t.errors.generic;
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/**
 * Signs in with a passkey (see `loginWithPasskey`) and tells the page what
 * came of it: `onSignedIn` when it worked, `onFailed` with the message of
 * what went wrong. A prompt turned down or an aborted request is neither.
 */
async function signInWithPasskey(
  t: Messages,
  opts: { signal?: AbortSignal; conditional?: boolean },
  onSignedIn: () => void,
  onFailed: (message: string) => void,
): Promise<boolean> {
  try {
    if (await loginWithPasskey(opts)) {
      onSignedIn();
      return true;
    }
  } catch (err) {
    onFailed(translateError(t, errorCode(err)));
  }
  return false;
}

/**
 * The email and password form, with the button of the demo above it when the
 * site is one. `redirect` is where to go once signed in.
 */
export function LoginPage({ redirect }: { redirect?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorId = useId();
  const demoNoteId = useId();
  const supported = passkeysSupported();

  // Whether the site is a demo. The button is only there once the answer says
  // so: not while it is awaited, and not when it failed. The answer cannot
  // change while the site runs, and the real site's "no" is kept as well.
  const demoQuery = useQuery({
    queryKey: ["demo"],
    queryFn: ({ signal }) => fetchDemoEnabled(signal),
    retry: false,
    staleTime: Infinity,
  });
  const isDemo = demoQuery.data === true;
  // Why the last entry into the demo failed, as a message.
  const [demoError, setDemoError] = useState<string | null>(null);
  const [demoPending, setDemoPending] = useState(false);
  // A second tap can come before the page has drawn the busy state: the ref is
  // set on the spot.
  const demoSending = useRef(false);

  // Why the last sign-in with a passkey failed, as a message.
  const [passkeyError, setPasskeyError] = useState<string | null>(null);
  const [passkeyPending, setPasskeyPending] = useState(false);
  // The request that waits for a passkey to be picked in the autofill.
  const autofill = useRef<AbortController | null>(null);

  // React empties an uncontrolled form once its action is over, so the email
  // that was typed comes back through the state (and `defaultValue`). The
  // password is not kept: a failed attempt starts it over.
  const [state, submit, pending] = useActionState(
    async (_previous: LoginState, form: FormData): Promise<LoginState> => {
      const email = text(form, "email").trim();
      setPasskeyError(null);
      setDemoError(null);
      try {
        await pb.collection("users").authWithPassword(email, text(form, "password"));
      } catch (err) {
        return { email, error: loginError(err) };
      }
      router.history.push(safeRedirect(redirect));
      return { email, error: null };
    },
    { email: "", error: null },
  );

  // The browser can offer the passkeys in the autofill of the email field:
  // the request waits for one to be picked, and is given up when the page
  // goes away or the button asks for a prompt instead.
  useEffect(() => {
    const controller = new AbortController();
    autofill.current = controller;
    void (async () => {
      // False too when the browser has no passkeys at all.
      if (!(await conditionalLoginAvailable()) || controller.signal.aborted) return;
      await signInWithPasskey(
        t,
        { signal: controller.signal, conditional: true },
        () => router.history.push(safeRedirect(redirect)),
        setPasskeyError,
      );
    })();
    return () => controller.abort();
  }, [t, router, redirect]);

  async function signInWithButton() {
    // Only one request at a time: the autofill gives way to the prompt.
    autofill.current?.abort();
    setPasskeyError(null);
    setDemoError(null);
    setPasskeyPending(true);
    await signInWithPasskey(
      t,
      {},
      () => router.history.push(safeRedirect(redirect)),
      setPasskeyError,
    );
    setPasskeyPending(false);
  }

  async function enterTheDemo() {
    if (demoSending.current) return;
    demoSending.current = true;
    setDemoPending(true);
    setDemoError(null);
    setPasskeyError(null);
    try {
      await enterDemo();
    } catch (err) {
      demoSending.current = false;
      setDemoPending(false);
      setDemoError(translateError(t, errorCode(err)));
      return;
    }
    // After a success the guard is left shut: the page goes away with the
    // navigation, and a new one starts open.
    router.history.push(safeRedirect(redirect));
  }

  const message = passkeyError ?? errorMessage(t, state.error);
  const field = `${INPUT} font-normal`;

  return (
    <div className="flex flex-col gap-4">
      <h1 tabIndex={-1} className="page-title">
        {t.auth.signIn}
      </h1>
      {isDemo && (
        <div className="flex flex-col gap-2 border-b border-neutral-200 pb-5">
          {/* Not `disabled` while it waits: a button that becomes disabled loses the focus. */}
          <button
            type="button"
            aria-disabled={demoPending || undefined}
            aria-describedby={demoNoteId}
            onClick={() => void enterTheDemo()}
            className={`${PRIMARY} ${demoPending ? "opacity-60" : ""}`}
          >
            {demoPending ? t.auth.signingIn : t.auth.demoEnter}
          </button>
          <p id={demoNoteId} className="text-sm text-neutral-600">
            {t.auth.demoNote}
          </p>
          {demoError !== null && (
            <p role="alert" className="text-sm font-medium text-red-700">
              {demoError}
            </p>
          )}
        </div>
      )}
      <form action={submit} className="flex flex-col gap-4">
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t.auth.email}
          <input
            name="email"
            type="email"
            inputMode="email"
            // `webauthn` lets the browser offer the passkeys in this field. It is
            // a token of the HTML specification that the lint rule does not know yet.
            // oxlint-disable-next-line jsx-a11y/autocomplete-valid
            autoComplete="username webauthn"
            required
            defaultValue={state.email}
            aria-invalid={message !== null}
            aria-describedby={message === null ? undefined : errorId}
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          {t.auth.password}
          <input
            name="password"
            type="password"
            autoComplete="current-password"
            required
            aria-invalid={message !== null}
            aria-describedby={message === null ? undefined : errorId}
            className={field}
          />
        </label>
        {message !== null && (
          <p id={errorId} role="alert" className="text-sm font-medium text-red-700">
            {message}
          </p>
        )}
        <button type="submit" disabled={pending} className={`${PRIMARY} mt-2`}>
          {pending ? t.auth.signingIn : t.auth.signIn}
        </button>
        {supported && (
          <button
            type="button"
            disabled={passkeyPending}
            onClick={() => void signInWithButton()}
            className={SECONDARY}
          >
            {passkeyPending ? t.auth.passkeyWaiting : t.auth.passkeyLogin}
          </button>
        )}
      </form>
    </div>
  );
}
