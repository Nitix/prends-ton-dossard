import { useActionState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import type { InvitationKind, Role } from "../../lib/types";
import { useMemberActions, type ShareLink } from "./api";
import { adminError } from "./errors";
import type { Member } from "./memberState";

/** What the dialog is for: a link of this kind for this runner. */
export type CreateLinkTarget = { member: Member; kind: InvitationKind };

const ROLES: readonly Role[] = ["member", "admin"];

function isRole(value: FormDataEntryValue | null): value is Role {
  return value === "member" || value === "admin";
}

/**
 * Makes a link for a runner: an invitation to create an account, with the
 * role it will have, or a link to choose a new password. A link that is
 * already waiting for the runner stops working once this one is made, and the
 * dialog says so. It is open while it has a target. The link made is handed
 * to `onCreated`, which shows it.
 */
export function CreateLinkDialog({
  target,
  onCreated,
  onClose,
}: {
  target: CreateLinkTarget | null;
  onCreated: (target: CreateLinkTarget, link: ShareLink) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const name = target?.member.runner.name ?? "";
  const title =
    target?.kind === "reset"
      ? t.admin.resetTitle(name)
      : target?.member.invitation
        ? t.admin.regenerateTitle(name)
        : t.admin.inviteTitle(name);

  return (
    <Dialog open={target !== null} onClose={onClose} title={title}>
      {target !== null && <LinkForm target={target} onCreated={onCreated} onClose={onClose} />}
    </Dialog>
  );
}

type FormState = { role: Role; message: string | null };

function LinkForm({
  target,
  onCreated,
  onClose,
}: {
  target: CreateLinkTarget;
  onCreated: (target: CreateLinkTarget, link: ShareLink) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const actions = useMemberActions();
  const { member, kind } = target;
  const replaces = kind === "invite" ? member.invitation !== undefined : member.reset !== undefined;

  // The role stays chosen after a refusal; a new invitation starts from the role of the old one.
  const [state, submit, pending] = useActionState(
    async (_previous: FormState, form: FormData): Promise<FormState> => {
      const chosen = form.get("role");
      const role = isRole(chosen) ? chosen : "member";
      try {
        const link = await actions.createLink(
          kind === "invite"
            ? { runnerId: member.runner.id, kind, role }
            : { runnerId: member.runner.id, kind },
        );
        onCreated(target, link);
        return { role, message: null };
      } catch (err) {
        return { role, message: adminError(t, err) };
      }
    },
    { role: member.invitation?.role === "admin" ? "admin" : "member", message: null },
  );

  return (
    <form action={submit} className="flex flex-col gap-4">
      <p>{kind === "invite" ? t.admin.inviteIntro : t.admin.resetIntro}</p>
      {kind === "invite" && (
        <fieldset className="flex flex-col">
          <legend className="eyebrow mb-2">{t.admin.role}</legend>
          {ROLES.map((role) => (
            <label key={role} className="flex min-h-11 items-center gap-3">
              <input
                type="radio"
                name="role"
                value={role}
                defaultChecked={state.role === role}
                className="size-5"
              />
              {t.admin.roles[role]}
            </label>
          ))}
        </fieldset>
      )}
      {replaces && <p className="text-sm text-neutral-600">{t.admin.regenerateWarning}</p>}
      {state.message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {state.message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t.admin.creating : t.admin.createLink}
        </button>
      </div>
    </form>
  );
}
