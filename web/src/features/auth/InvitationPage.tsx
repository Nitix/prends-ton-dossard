import { useQuery } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import type { RecordAuthResponse } from "pocketbase";
import { useActionState, useEffect, useId, useState } from "react";

import { PRIMARY } from "../../components/buttons";
import { INPUT } from "../../components/Field";
import { errorCode, fieldErrors, translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";

/** What the server tells about a link: who it is for, and what it does. */
type Invitation = { runnerName: string; kind: "invite" | "reset" };

/** The fields that can carry an error of their own. */
type Field = "email" | "password" | "passwordConfirm";

/** A refusal of the server: what went wrong, and the field to show it under, if any. */
type Failure = { code: string | undefined; field: Field | null };

/** What the form shows: the values that were typed, and why the last attempt failed. */
type FormState = {
  email: string;
  password: string;
  passwordConfirm: string;
  failure: Failure | null;
};

const EMPTY_FORM: FormState = { email: "", password: "", passwordConfirm: "", failure: null };

/** The codes of the routes of the invitations that are about one field. */
const FIELD_OF_CODE: Readonly<Record<string, Field>> = {
  email_invalid: "email",
  email_taken: "email",
  password_too_short: "password",
  password_mismatch: "passwordConfirm",
};

function isField(name: string): name is Field {
  return name === "email" || name === "password" || name === "passwordConfirm";
}

/**
 * Tells what the server refused, and where to show it. The routes answer with
 * a `{code}`, and a few codes belong to one field. The validation of the
 * account by PocketBase (an email that became taken in the meantime) answers
 * with a code per field instead. Anything else, a network failure included,
 * has no code, hence the generic message.
 */
function failureOf(err: unknown): Failure {
  const code = errorCode(err);
  if (code !== undefined) {
    return {
      code,
      field: Object.hasOwn(FIELD_OF_CODE, code) ? (FIELD_OF_CODE[code] ?? null) : null,
    };
  }
  for (const [name, fieldCode] of Object.entries(fieldErrors(err))) {
    if (isField(name)) return { code: fieldCode, field: name };
  }
  return { code: undefined, field: null };
}

function text(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

/** The token of the link: its fragment, without the `#`. Empty when there is none. */
function tokenFromAddress(): string {
  return window.location.hash.slice(1);
}

/**
 * Takes the fragment out of the address bar. The state of the history entry is
 * the router's own (its position in the history), so it is handed back as it is.
 */
function removeFragment(): void {
  if (window.location.hash === "") return;
  window.history.replaceState(
    window.history.state,
    "",
    window.location.pathname + window.location.search,
  );
}

/**
 * The page the shared links lead to, `/invitation#<token>`: it creates the
 * account of an invitation, or gives a new password for a reset.
 *
 * The token is in the fragment, which the browser never sends to a server. It
 * is kept in the state of the page and taken out of the address bar at once,
 * so that it stays neither in the history nor in a link copied from there.
 */
export function InvitationPage() {
  const { t } = useI18n();

  // Only read here: rendering must not change anything, and React renders
  // twice in development, so the address is cleaned in the effect below.
  const [token, setToken] = useState(tokenFromAddress);

  useEffect(() => {
    removeFragment();

    // A link opened in the tab that shows this page (a new one, after the
    // first was refused) only changes the fragment: the browser does not load
    // the page again, it fires this event.
    function onHashChange() {
      const next = tokenFromAddress();
      if (next !== "") setToken(next);
      removeFragment();
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  const lookup = useQuery({
    queryKey: ["invitation", token],
    queryFn: () =>
      pb.send<Invitation>("/api/app/invitations/lookup", { method: "POST", body: { token } }),
    enabled: token !== "",
    // An unknown token is not a failure to try again, and a known one does
    // not change: it is looked up once, and forgotten with the page.
    retry: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  if (token === "") return <Invalid message={t.errors.invitation_invalid} />;
  if (lookup.isPending) return <output>{t.common.loading}</output>;
  if (lookup.isError) {
    const code = errorCode(lookup.error);
    if (code === "invitation_invalid") return <Invalid message={t.errors.invitation_invalid} />;
    // Reloading the page would lose the token, which is not in the address
    // any more: trying again is up to the button.
    return (
      <div className="flex flex-col gap-4">
        <Invalid message={translateError(t, code)} />
        <button
          type="button"
          onClick={() => void lookup.refetch()}
          disabled={lookup.isFetching}
          className={PRIMARY}
        >
          {t.common.retry}
        </button>
      </div>
    );
  }
  // The key starts the form over for another link.
  return <InvitationForm key={token} token={token} invitation={lookup.data} />;
}

function Invalid({ message }: { message: string }) {
  return (
    <p role="alert" className="text-base font-medium text-red-700">
      {message}
    </p>
  );
}

/** The form of a link that is valid: email and password for an invitation, password only for a reset. */
function InvitationForm({ token, invitation }: { token: string; invitation: Invitation }) {
  const { t } = useI18n();
  const router = useRouter();
  const isInvite = invitation.kind === "invite";

  // React empties an uncontrolled form once its action is over, so what was
  // typed comes back through the state (and `defaultValue`): after a refusal,
  // nobody has to type a new password twice again for an email that is taken.
  const [state, submit, pending] = useActionState(
    async (_previous: FormState, form: FormData): Promise<FormState> => {
      const email = text(form, "email").trim();
      const password = text(form, "password");
      const passwordConfirm = text(form, "passwordConfirm");

      let session: RecordAuthResponse;
      try {
        session = await pb.send<RecordAuthResponse>("/api/app/invitations/accept", {
          method: "POST",
          // A reset has no email: the server would ignore it, so it is not sent.
          body: isInvite
            ? { token, email, password, passwordConfirm }
            : { token, password, passwordConfirm },
        });
      } catch (err) {
        return { email, password, passwordConfirm, failure: failureOf(err) };
      }

      pb.authStore.save(session.token, session.record);
      // The link is used up: coming back to it with the back button is no use.
      await router.navigate({ to: "/", replace: true });
      return EMPTY_FORM;
    },
    EMPTY_FORM,
  );

  const failure = state.failure;
  const message = failure === null ? null : translateError(t, failure.code);
  const messageFor = (field: Field): string | null => (failure?.field === field ? message : null);

  return (
    <form action={submit} className="flex flex-col gap-4">
      <h1 tabIndex={-1} className="page-title">
        {isInvite
          ? t.auth.welcome(invitation.runnerName)
          : t.auth.resetTitle(invitation.runnerName)}
      </h1>
      {isInvite && (
        <TextField
          label={t.auth.email}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          defaultValue={state.email}
          error={messageFor("email")}
        />
      )}
      <TextField
        label={t.auth.password}
        name="password"
        type="password"
        autoComplete="new-password"
        defaultValue={state.password}
        hint={t.auth.passwordHint}
        error={messageFor("password")}
      />
      <TextField
        label={t.auth.passwordConfirm}
        name="passwordConfirm"
        type="password"
        autoComplete="new-password"
        defaultValue={state.passwordConfirm}
        error={messageFor("passwordConfirm")}
      />
      {message !== null && failure?.field === null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <button type="submit" disabled={pending} className={PRIMARY}>
        {pending ? t.auth.saving : isInvite ? t.auth.createAccount : t.auth.changePassword}
      </button>
    </form>
  );
}

/**
 * A labelled input. Its hint and its error are linked to it with
 * `aria-describedby`, so a screen reader reads them with the field.
 */
function TextField({
  label,
  name,
  type,
  inputMode,
  autoComplete,
  defaultValue,
  hint,
  error,
}: {
  label: string;
  name: string;
  type: "email" | "password";
  inputMode?: "email";
  autoComplete: string;
  defaultValue: string;
  hint?: string;
  error: string | null;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy = [hint === undefined ? null : hintId, error === null ? null : errorId]
    .filter((described) => described !== null)
    .join(" ");

  return (
    <div className="field flex flex-col gap-1">
      <label htmlFor={id} className="field-label text-sm font-medium">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        inputMode={inputMode}
        autoComplete={autoComplete}
        required
        defaultValue={defaultValue}
        aria-invalid={error !== null}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        className={`${INPUT} font-normal`}
      />
      {hint !== undefined && (
        <p id={hintId} className="field-hint text-sm text-neutral-600">
          {hint}
        </p>
      )}
      {error !== null && (
        <p id={errorId} role="alert" className="field-error text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
