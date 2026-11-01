import { AvatarPicker } from "../../components/AvatarPicker";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { InvitationKind, InvitationRecord, RunnerRecord, UserRecord } from "../../lib/types";
import { useMemberActions, useMembers, type ShareLink } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { CreateLinkDialog } from "./CreateLinkDialog";
import type { Member } from "./memberState";
import { RunnerNameDialog } from "./RunnerNameDialog";
import { ShareLinkDialog } from "./ShareLinkDialog";
import { UserPasskeys } from "./UserPasskeys";

/** The dialog that is open on the members page, and what it is about. At most one is open. */
export type MemberDialog =
  | { kind: "create" }
  | { kind: "rename"; runner: RunnerRecord }
  | { kind: "avatar"; runner: RunnerRecord }
  | { kind: "delete"; runner: RunnerRecord }
  | { kind: "link"; member: Member; linkKind: InvitationKind }
  | { kind: "share"; runner: RunnerRecord; linkKind: InvitationKind; link: ShareLink }
  | { kind: "revoke"; runner: RunnerRecord; invitation: InvitationRecord }
  | { kind: "demote"; runner: RunnerRecord; user: UserRecord }
  | { kind: "disable"; runner: RunnerRecord; user: UserRecord }
  | { kind: "passkeys"; runner: RunnerRecord; user: UserRecord };

/** The id of the runner a dialog is about: there is none when a runner is being created. */
export function runnerIdOf(dialog: MemberDialog): string | null {
  if (dialog.kind === "create") return null;
  return "member" in dialog ? dialog.member.runner.id : dialog.runner.id;
}

/**
 * Every dialog of the members page. They are always there, closed, and the
 * one that `dialog` names is open: a dialog that is open for good, and not
 * taken out of the page, is what lets the browser give the focus back to the
 * button that opened it.
 *
 * Making a link (a dialog) leads to showing it (another): `onChange` replaces
 * the open dialog.
 */
export function MemberDialogs({
  dialog,
  onChange,
  onClose,
}: {
  dialog: MemberDialog | null;
  onChange: (next: MemberDialog) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const actions = useMemberActions();

  const nameTarget = dialog?.kind === "create" || dialog?.kind === "rename" ? dialog : null;
  const linkTarget = dialog?.kind === "link" ? dialog : null;
  const share = dialog?.kind === "share" ? dialog : null;
  const revoke = dialog?.kind === "revoke" ? dialog : null;

  return (
    <>
      <RunnerNameDialog target={nameTarget} onClose={onClose} />

      <AvatarDialog target={dialog?.kind === "avatar" ? dialog.runner : null} onClose={onClose} />

      <ConfirmDialog
        target={dialog?.kind === "delete" ? dialog.runner : null}
        onClose={onClose}
        title={t.admin.deleteTitle}
        confirmLabel={t.common.delete}
        run={async (runner) => {
          await actions.deleteRunner(runner.id);
          toast.show(t.admin.deleted);
        }}
      >
        {(runner) => <p>{t.admin.deleteWarning(runner.name)}</p>}
      </ConfirmDialog>

      <CreateLinkDialog
        target={linkTarget && { member: linkTarget.member, kind: linkTarget.linkKind }}
        onCreated={(target, link) =>
          onChange({
            kind: "share",
            runner: target.member.runner,
            linkKind: target.kind,
            link,
          })
        }
        onClose={onClose}
      />

      <ShareLinkDialog
        open={share !== null}
        onClose={onClose}
        url={share?.link.url ?? ""}
        expiresAt={share?.link.expiresAt ?? ""}
        kind={share?.linkKind ?? "invite"}
        runnerName={share?.runner.name ?? ""}
      />

      <ConfirmDialog
        target={revoke}
        onClose={onClose}
        title={revoke ? t.admin.revoke[revoke.invitation.kind].title : ""}
        confirmLabel={t.admin.revokeConfirm}
        run={async ({ invitation }) => {
          await actions.revokeInvitation(invitation.id);
          toast.show(t.admin.revoke[invitation.kind].done);
        }}
      >
        {({ runner, invitation }) => <p>{t.admin.revoke[invitation.kind].warning(runner.name)}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        target={dialog?.kind === "demote" ? dialog : null}
        onClose={onClose}
        title={t.admin.demoteTitle}
        confirmLabel={t.admin.removeAdmin}
        run={async ({ user }) => {
          await actions.setRole(user.id, "member");
          toast.show(t.admin.roleChanged);
        }}
      >
        {({ runner }) => <p>{t.admin.demoteWarning(runner.name)}</p>}
      </ConfirmDialog>

      <ConfirmDialog
        target={dialog?.kind === "disable" ? dialog : null}
        onClose={onClose}
        title={t.admin.disableTitle}
        confirmLabel={t.admin.disable}
        run={async ({ user }) => {
          await actions.setDisabled(user.id, true);
          toast.show(t.admin.disabledDone);
        }}
      >
        {({ runner }) => <p>{t.admin.disableWarning(runner.name)}</p>}
      </ConfirmDialog>

      <UserPasskeys target={dialog?.kind === "passkeys" ? dialog : null} onClose={onClose} />
    </>
  );
}

/**
 * The photo of a runner, in a window of its own: the admin changes the photo
 * of any runner, which is the only way for a runner who has no account. It is
 * open while it has a target.
 */
function AvatarDialog({ target, onClose }: { target: RunnerRecord | null; onClose: () => void }) {
  const { t } = useI18n();
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target === null ? "" : t.avatar.titleFor(target.name)}
    >
      {target !== null && <CurrentAvatarPicker runner={target} />}
    </Dialog>
  );
}

/**
 * The window stays open after a change, and must show it. The runner the
 * dialog was opened with is the one of that moment: the picker is given the
 * one of the list, which is read again after each change.
 */
function CurrentAvatarPicker({ runner }: { runner: RunnerRecord }) {
  const members = useMembers();
  const current = members.data?.find((member) => member.runner.id === runner.id)?.runner;
  return <AvatarPicker runner={current ?? runner} />;
}
