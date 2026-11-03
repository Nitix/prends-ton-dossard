import { useRef, useState } from "react";

import { SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { PasskeyRecord, RunnerRecord, UserRecord } from "../../lib/types";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { day } from "../profile/PasskeyList";
import { useMemberActions, usePasskeys } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";

/** What the dialog is about: the account of a runner. */
export type UserPasskeysTarget = { runner: RunnerRecord; user: UserRecord };

/**
 * The passkeys of an account, for an admin to delete (not to add or rename:
 * only their owner does that, in their profile). It is open while it has a
 * target.
 */
export function UserPasskeys({
  target,
  onClose,
}: {
  target: UserPasskeysTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target === null ? "" : t.admin.passkeysTitle(target.runner.name)}
    >
      {target !== null && <PasskeyRows runner={target.runner} user={target.user} />}
    </Dialog>
  );
}

function PasskeyRows({ runner, user }: UserPasskeysTarget) {
  const { t, formatLocale } = useI18n();
  const toast = useToast();
  const actions = useMemberActions();
  const query = usePasskeys(user.id);
  const [removing, setRemoving] = useState<PasskeyRecord | null>(null);

  // A key that is deleted takes its button with it, and its confirmation
  // closes: the focus goes to the text above the list, which stays.
  const intro = useRef<HTMLParagraphElement>(null);
  useRestoreFocus(removing !== null, () => intro.current);

  return (
    <div className="flex flex-col gap-4">
      <p ref={intro} tabIndex={-1} className="text-sm text-neutral-600">
        {t.admin.passkeysIntro(runner.name)}
      </p>
      {query.isPending && <output>{t.common.loading}</output>}
      {query.isError && (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      )}
      {query.isSuccess && query.data.length === 0 && <p>{t.admin.passkeysEmpty}</p>}
      {query.isSuccess && query.data.length > 0 && (
        <ul className="flex flex-col gap-2">
          {query.data.map((passkey) => (
            <li
              key={passkey.id}
              className="passkey-row flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-neutral-50 p-3.5 ring-1 ring-neutral-100"
            >
              <div className="min-w-0">
                <p className="font-medium break-words">{passkey.name}</p>
                <p className="text-sm text-neutral-600">
                  {t.passkeys.created(day(formatLocale, passkey.created))}
                  {" · "}
                  {passkey.last_used_at
                    ? t.passkeys.lastUsed(day(formatLocale, passkey.last_used_at))
                    : t.passkeys.neverUsed}
                </p>
              </div>
              {/* The name of the key is in the accessible name only: the buttons of a list would otherwise sound the same. */}
              <button
                type="button"
                onClick={() => setRemoving(passkey)}
                aria-label={`${t.common.delete} ${passkey.name}`}
                className={SECONDARY}
              >
                {t.common.delete}
              </button>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        target={removing}
        onClose={() => setRemoving(null)}
        title={t.passkeys.removeTitle}
        confirmLabel={t.common.delete}
        run={async (passkey) => {
          await actions.deletePasskey(user.id, passkey.id);
          toast.show(t.passkeys.removed);
        }}
      >
        {(passkey) => <p>{t.admin.passkeyRemoveWarning(passkey.name, runner.name)}</p>}
      </ConfirmDialog>
    </div>
  );
}
