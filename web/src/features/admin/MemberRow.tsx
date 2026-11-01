import { useState } from "react";

import { Avatar } from "../../components/Avatar";
import { DANGER_TEXT, SECONDARY } from "../../components/buttons";
import { useToast } from "../../components/Toast";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import type { Formatters } from "../../lib/format";
import type { RunnerRecord } from "../../lib/types";
import { useMemberActions } from "./api";
import { adminError } from "./errors";
import type { MemberDialog } from "./MemberDialogs";
import { expiryDay, type Member } from "./memberState";

/** The id of the name of a runner in the list: where the focus goes when what had it is gone. */
export function memberHeadingId(runnerId: string): string {
  return `member-${runnerId}`;
}

/** What a runner is, in words: its state, and the role of its account. Never told by colour alone. */
function stateLine(t: Messages, f: Formatters, { state, user, invitation }: Member): string {
  if (state === "invited" && invitation) {
    return t.admin.stateInvited(f.dateLong(expiryDay(invitation.expires_at)));
  }
  if (user && (state === "active" || state === "disabled")) {
    const label = state === "active" ? t.admin.stateActive : t.admin.stateDisabled;
    return `${label} · ${t.admin.roles[user.role]}`;
  }
  return t.admin.stateNoAccount;
}

/**
 * A runner of the list: its photo and its name, what it is (no account,
 * invited, active or disabled, and the role of the account), and what the
 * admin can do with it, which depends on that. Most actions ask the page to
 * open a dialog; making somebody admin and enabling an account again happen at
 * once, since they take nothing away.
 */
export function MemberRow({
  member,
  onOpen,
}: {
  member: Member;
  onOpen: (dialog: MemberDialog) => void;
}) {
  const { t, f } = useI18n();
  const toast = useToast();
  const actions = useMemberActions();
  const [busy, setBusy] = useState(false);
  const { runner, user, state, invitation, reset } = member;

  async function change(run: () => Promise<void>, done: string) {
    setBusy(true);
    try {
      await run();
      toast.show(done);
    } catch (err) {
      toast.show(adminError(t, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="card flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        <Avatar
          runner={runner}
          thumb="96x96"
          className="avatar-soft size-12 shrink-0 text-lg font-bold"
        />
        <div className="min-w-0">
          {/* It can take the focus (it is not in the tab order): it is where the focus goes when the button that had it is gone. */}
          <h2
            id={memberHeadingId(runner.id)}
            tabIndex={-1}
            className="card-title text-lg break-words"
          >
            {runner.name}
          </h2>
          <p className="text-sm">{stateLine(t, f, member)}</p>
          {user && <p className="text-sm break-all text-neutral-600">{user.email}</p>}
          {reset && (
            <p className="text-sm">
              {t.admin.resetPending(f.dateLong(expiryDay(reset.expires_at)))}
            </p>
          )}
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Action
          runner={runner}
          label={t.admin.rename}
          onClick={() => onOpen({ kind: "rename", runner })}
        />
        {/* Everybody has one, an account or not: it is the admin who puts a photo on a runner who has none. */}
        <Action
          runner={runner}
          label={t.avatar.title}
          onClick={() => onOpen({ kind: "avatar", runner })}
        />
        {(state === "no_account" || state === "invited") && (
          // The same button for both: it keeps the focus when the runner gets invited.
          <Action
            runner={runner}
            label={invitation ? t.admin.regenerate : t.admin.invite}
            onClick={() => onOpen({ kind: "link", member, linkKind: "invite" })}
          />
        )}
        {invitation && (
          <Action
            runner={runner}
            label={t.admin.revokeInvite}
            danger
            onClick={() => onOpen({ kind: "revoke", runner, invitation })}
          />
        )}
        {user && (
          <>
            <Action
              runner={runner}
              label={t.admin.resetLink}
              onClick={() => onOpen({ kind: "link", member, linkKind: "reset" })}
            />
            {reset && (
              <Action
                runner={runner}
                label={t.admin.revokeReset}
                danger
                onClick={() => onOpen({ kind: "revoke", runner, invitation: reset })}
              />
            )}
            <Action
              runner={runner}
              label={user.role === "admin" ? t.admin.removeAdmin : t.admin.makeAdmin}
              busy={busy}
              onClick={() => {
                if (user.role === "admin") {
                  onOpen({ kind: "demote", runner, user });
                } else {
                  void change(() => actions.setRole(user.id, "admin"), t.admin.roleChanged);
                }
              }}
            />
            <Action
              runner={runner}
              label={user.disabled ? t.admin.enable : t.admin.disable}
              busy={busy}
              onClick={() => {
                if (user.disabled) {
                  void change(() => actions.setDisabled(user.id, false), t.admin.enabledDone);
                } else {
                  onOpen({ kind: "disable", runner, user });
                }
              }}
            />
            <Action
              runner={runner}
              label={t.admin.passkeys}
              onClick={() => onOpen({ kind: "passkeys", runner, user })}
            />
          </>
        )}
        {/* A runner with an account is not deleted (the server refuses): its account is disabled instead. */}
        {!user && (
          <Action
            runner={runner}
            label={t.common.delete}
            danger
            onClick={() => onOpen({ kind: "delete", runner })}
          />
        )}
      </div>
    </li>
  );
}

/**
 * A button of a row. Its accessible name starts with its text and goes on
 * with the runner it is about, since the buttons of a list would otherwise
 * all sound the same. While `busy` it ignores taps, but stays focusable: a
 * disabled button would drop the focus to the page.
 */
function Action({
  runner,
  label,
  onClick,
  danger = false,
  busy = false,
}: {
  runner: RunnerRecord;
  label: string;
  onClick: () => void;
  danger?: boolean;
  busy?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t.admin.forRunner(label, runner.name)}
      aria-disabled={busy || undefined}
      onClick={() => {
        if (!busy) onClick();
      }}
      className={`${SECONDARY} ${danger ? DANGER_TEXT : ""} ${busy ? "opacity-60" : ""}`}
    >
      {label}
    </button>
  );
}
