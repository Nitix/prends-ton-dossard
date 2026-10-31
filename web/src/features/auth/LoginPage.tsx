import { useRouter } from "@tanstack/react-router";
import { ClientResponseError } from "pocketbase";
import { useActionState, useId } from "react";

import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";
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

/** The email and password form. `redirect` is where to go once signed in. */
export function LoginPage({ redirect }: { redirect?: string }) {
  const { t } = useI18n();
  const router = useRouter();
  const errorId = useId();

  // React empties an uncontrolled form once its action is over, so the email
  // that was typed comes back through the state (and `defaultValue`). The
  // password is not kept: a failed attempt starts it over.
  const [state, submit, pending] = useActionState(
    async (_previous: LoginState, form: FormData): Promise<LoginState> => {
      const email = text(form, "email").trim();
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

  const message = errorMessage(t, state.error);
  const field = "min-h-11 rounded-lg border border-neutral-300 bg-white px-3 text-base font-normal";

  return (
    <form action={submit} className="flex flex-col gap-4 pt-8">
      <h1 className="text-2xl font-semibold">{t.auth.signIn}</h1>
      <label className="flex flex-col gap-1 text-sm font-medium">
        {t.auth.email}
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="username"
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
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-lg bg-neutral-900 px-4 font-medium text-white disabled:opacity-60"
      >
        {pending ? t.auth.signingIn : t.auth.signIn}
      </button>
    </form>
  );
}
