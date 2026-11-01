import { useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { useI18n } from "../../i18n/I18nProvider";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { useSession } from "../auth/session";
import { useMembers } from "./api";
import { MemberDialogs, runnerIdOf, type MemberDialog } from "./MemberDialogs";
import { MemberRow, memberHeadingId } from "./MemberRow";

/**
 * The members page of the admin: every runner with what it is (no account,
 * invited, active, disabled) and what the admin can do with it. The server is
 * what refuses a member who gets here: the route sends them away, and every
 * request they made would be refused anyway. The app shell around this owns
 * the page's `<main>`.
 *
 * The title of the page can take the focus (it is not in the tab order): it is
 * where the focus goes when a dialog closes and the button that opened it is
 * gone, if the runner it was about is gone too.
 */
export function MembersPage() {
  const { t } = useI18n();
  const { user, isAdmin } = useSession();
  const navigate = useNavigate();
  const members = useMembers();
  const title = useRef<HTMLHeadingElement>(null);

  // An admin who gives up their own role has nothing left to do here. (A
  // sign-out is not that: the app takes care of sending somebody to log in.)
  useEffect(() => {
    if (user !== null && !isAdmin) void navigate({ to: "/", replace: true });
  }, [user, isAdmin, navigate]);

  const [dialog, setDialog] = useState<MemberDialog | null>(null);
  // The runner of the last dialog: it stays known once the dialog is closed.
  const lastRunnerId = useRef<string | null>(null);
  const show = (next: MemberDialog) => {
    lastRunnerId.current = runnerIdOf(next);
    setDialog(next);
  };
  const close = () => setDialog(null);

  useRestoreFocus(dialog !== null, () => {
    const id = lastRunnerId.current;
    return (id === null ? null : document.getElementById(memberHeadingId(id))) ?? title.current;
  });

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={title} tabIndex={-1} className="text-2xl font-semibold">
        {t.admin.membersTitle}
      </h1>
      <button
        type="button"
        onClick={() => show({ kind: "create" })}
        className={`${PRIMARY} self-start`}
      >
        {t.admin.addRunner}
      </button>
      {/* A refresh that fails keeps what the list already shows. */}
      {members.data ? (
        members.data.length === 0 ? (
          <p>{t.admin.empty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {members.data.map((member) => (
              <MemberRow key={member.runner.id} member={member} onOpen={show} />
            ))}
          </ul>
        )
      ) : members.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void members.refetch()}
            disabled={members.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : (
        <output>{t.common.loading}</output>
      )}
      <MemberDialogs dialog={dialog} onChange={show} onClose={close} />
    </div>
  );
}
