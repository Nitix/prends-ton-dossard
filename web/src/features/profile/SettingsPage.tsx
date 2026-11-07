import { useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { RecordAuthResponse } from "pocketbase";
import { useActionState } from "react";

import { AvatarPicker } from "../../components/AvatarPicker";
import { PRIMARY, SECONDARY } from "../../components/buttons";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { translateError } from "../../i18n/errors";
import { useI18n } from "../../i18n/I18nProvider";
import { pb } from "../../lib/pb";
import type { RunnerRecord, UserRecord } from "../../lib/types";
import { logout, useSession } from "../auth/session";
import { CalendarSection } from "../calendar/CalendarSection";
import { McpSection } from "../mcp/McpSection";
import { InstallSection } from "../pwa/InstallSection";
import { RemindersSection } from "../reminders/RemindersSection";
import { AppearanceSection } from "./AppearanceSection";
import { failureOf, text, type Failure } from "./forms";
import { PasskeyList } from "./PasskeyList";
import { Section } from "./Section";

const BUTTON = `${PRIMARY} self-start`;

/**
 * The settings of the signed-in user, which the profile leads to: the photo and
 * the name the group sees, the email and the password of the account, the
 * passkeys, the theme of the app on this device, the calendar link, the tokens
 * of the AI assistants, how to install the app, and the sign-out. An account
 * that is not a member's (the super-admin of PocketBase) has the theme and the
 * sign-out only. A link at the top goes back to the profile. The app shell
 * around it owns the page's `<main>`.
 */
export function SettingsPage() {
  const { t } = useI18n();
  const { user, runner, signedIn } = useSession();

  // The pages behind the sign-in are only shown to somebody signed in: this
  // is the instant between a sign-out and the move to the login page.
  if (!signedIn) return null;

  return (
    <div className="flex flex-col gap-5">
      <Link to="/profil" className={`${SECONDARY} inline-flex items-center self-start`}>
        {t.profile.backToProfile}
      </Link>
      <h1 tabIndex={-1} className="page-title">
        {t.profile.settings}
      </h1>
      {/* An account that is not a member's (the super-admin of PocketBase) has none of these. */}
      {user !== null && <AccountSections user={user} runner={runner} />}
      {/* The look of the app is a choice of this device, not of the account: whoever is signed in has it. */}
      <AppearanceSection />
      {user !== null && <AppSections />}
      <button type="button" onClick={logout} className={`${SECONDARY} self-start`}>
        {t.profile.logout}
      </button>
    </div>
  );
}

/** What a member sets of their account: their photo and name, their email and password, their passkeys. */
function AccountSections({ user, runner }: { user: UserRecord; runner: RunnerRecord | null }) {
  const { t } = useI18n();

  return (
    <>
      <Section title={t.avatar.title}>
        {runner === null ? <output>{t.common.loading}</output> : <AvatarPicker runner={runner} />}
      </Section>
      <Section title={t.profile.nameTitle}>
        {runner === null ? (
          <output>{t.common.loading}</output>
        ) : (
          // The key starts the form over for another runner.
          <NameForm key={runner.id} runner={runner} />
        )}
      </Section>
      <Section title={t.profile.emailTitle}>
        <EmailForm user={user} />
      </Section>
      <Section title={t.profile.passwordTitle}>
        <PasswordForm user={user} />
      </Section>
      <PasskeyList userId={user.id} />
    </>
  );
}

/**
 * What a member has after the look of the app: their reminders, the link of their calendar, the
 * tokens of their AI assistants (absent on the demo), and how to install the app.
 */
function AppSections() {
  return (
    <>
      <RemindersSection />
      <CalendarSection />
      <McpSection />
      <InstallSection />
    </>
  );
}

// React empties an uncontrolled form once its action is over. Each form below
// keeps what was typed in its state and hands it back as `defaultValue`, so
// that a refused form keeps its values. The passwords are only kept in memory,
// until the form succeeds or the page goes away.

/** The form-level message of a failure that is not about one of the fields. */
function FormError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-sm font-medium text-red-700">
      {message}
    </p>
  );
}

// --- The name ---

type NameState = { name: string; failure: Failure<"name"> | null };

function NameForm({ runner }: { runner: RunnerRecord }) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  const [state, submit, pending] = useActionState(
    async (_previous: NameState, form: FormData): Promise<NameState> => {
      const name = text(form, "name").trim();
      if (name === "") return { name, failure: { code: "validation_required", field: "name" } };
      try {
        await pb.collection("runners").update(runner.id, { name });
      } catch (err) {
        return { name, failure: failureOf(err, ["name"]) };
      }
      // The name is shown all over the app: every page reads it again.
      await queryClient.invalidateQueries();
      toast.show(t.profile.nameSaved);
      return { name, failure: null };
    },
    { name: runner.name, failure: null },
  );

  const message = state.failure === null ? null : translateError(t, state.failure.code);
  return (
    <form action={submit} className="flex flex-col gap-4">
      <TextField
        label={t.profile.name}
        name="name"
        autoComplete="nickname"
        defaultValue={state.name}
        hint={t.profile.nameHint}
        error={state.failure?.field === "name" ? message : null}
      />
      <FormError message={state.failure?.field === null ? message : null} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? t.auth.saving : t.common.save}
      </button>
    </form>
  );
}

// --- The email ---

type EmailField = "email" | "password";
type EmailState = { email: string; password: string; failure: Failure<EmailField> | null };

const EMAIL_FIELDS: readonly EmailField[] = ["email", "password"];

/** The codes of `/api/app/me/email` that are about one field. */
const EMAIL_FIELD_OF_CODE: Readonly<Record<string, EmailField>> = {
  email_invalid: "email",
  email_taken: "email",
  wrong_password: "password",
};

const NO_EMAIL_CHANGE: EmailState = { email: "", password: "", failure: null };

function EmailForm({ user }: { user: UserRecord }) {
  const { t } = useI18n();
  const toast = useToast();

  const [state, submit, pending] = useActionState(
    async (_previous: EmailState, form: FormData): Promise<EmailState> => {
      const email = text(form, "email").trim();
      const password = text(form, "password");
      let session: RecordAuthResponse;
      try {
        session = await pb.send<RecordAuthResponse>("/api/app/me/email", {
          method: "POST",
          body: { email, password },
        });
      } catch (err) {
        return { email, password, failure: failureOf(err, EMAIL_FIELDS, EMAIL_FIELD_OF_CODE) };
      }
      // PocketBase replaced the key of the token with the email: the token of
      // the session is dead, the one of the answer replaces it.
      pb.authStore.save(session.token, session.record);
      toast.show(t.profile.emailSaved);
      return NO_EMAIL_CHANGE;
    },
    NO_EMAIL_CHANGE,
  );

  const message = state.failure === null ? null : translateError(t, state.failure.code);
  const messageFor = (field: EmailField) => (state.failure?.field === field ? message : null);
  return (
    <form action={submit} className="flex flex-col gap-4">
      <p className="text-sm text-neutral-600">{t.profile.currentEmail(user.email)}</p>
      <TextField
        label={t.profile.newEmail}
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        defaultValue={state.email}
        error={messageFor("email")}
      />
      <TextField
        label={t.profile.currentPassword}
        name="password"
        type="password"
        autoComplete="current-password"
        defaultValue={state.password}
        error={messageFor("password")}
      />
      <FormError message={state.failure?.field === null ? message : null} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? t.auth.saving : t.profile.changeEmail}
      </button>
    </form>
  );
}

// --- The password ---

type PasswordField = "oldPassword" | "password" | "passwordConfirm";
type PasswordState = {
  oldPassword: string;
  password: string;
  passwordConfirm: string;
  failure: Failure<PasswordField> | null;
};

const PASSWORD_FIELDS: readonly PasswordField[] = ["oldPassword", "password", "passwordConfirm"];

const NO_PASSWORD_CHANGE: PasswordState = {
  oldPassword: "",
  password: "",
  passwordConfirm: "",
  failure: null,
};

function PasswordForm({ user }: { user: UserRecord }) {
  const { t } = useI18n();
  const toast = useToast();

  const [state, submit, pending] = useActionState(
    async (_previous: PasswordState, form: FormData): Promise<PasswordState> => {
      const oldPassword = text(form, "oldPassword");
      const password = text(form, "password");
      const passwordConfirm = text(form, "passwordConfirm");
      try {
        await pb.collection("users").update(user.id, { oldPassword, password, passwordConfirm });
      } catch (err) {
        return { oldPassword, password, passwordConfirm, failure: failureOf(err, PASSWORD_FIELDS) };
      }

      // PocketBase replaced the key of the token with the password: the token
      // of this session is dead from now on. Signing in again with the new
      // password is the very next request, before anything else is asked of
      // the server with the dead token: a 401 would end the session (see
      // lib/pb.ts). The queries are not invalidated here for that reason.
      try {
        await pb.collection("users").authWithPassword(user.email, password);
      } catch {
        logout();
        toast.show(t.profile.passwordSignInAgain);
        return NO_PASSWORD_CHANGE;
      }
      toast.show(t.profile.passwordSaved);
      return NO_PASSWORD_CHANGE;
    },
    NO_PASSWORD_CHANGE,
  );

  const message = state.failure === null ? null : translateError(t, state.failure.code);
  const messageFor = (field: PasswordField) => (state.failure?.field === field ? message : null);
  return (
    <form action={submit} className="flex flex-col gap-4">
      <TextField
        label={t.profile.currentPassword}
        name="oldPassword"
        type="password"
        autoComplete="current-password"
        defaultValue={state.oldPassword}
        error={messageFor("oldPassword")}
      />
      <TextField
        label={t.profile.newPassword}
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
      <FormError message={state.failure?.field === null ? message : null} />
      <button type="submit" disabled={pending} className={BUTTON}>
        {pending ? t.auth.saving : t.auth.changePassword}
      </button>
    </form>
  );
}
