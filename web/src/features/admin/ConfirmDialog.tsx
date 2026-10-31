import { useActionState, type ReactNode } from "react";

import { DANGER, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { useI18n } from "../../i18n/I18nProvider";
import { adminError } from "./errors";

/**
 * Asks before something that cuts somebody off or cannot be taken back. It is
 * open while it has a `target`, the thing it is about, and `children` says
 * what is about to happen to it.
 *
 * `run` does it (and tells the user, if it wants to) and throws when the
 * server refuses: the refusal is said in the dialog, which stays open.
 * Otherwise the dialog closes, by calling `onClose`.
 */
export function ConfirmDialog<Target>({
  target,
  onClose,
  title,
  confirmLabel,
  run,
  children,
}: {
  target: Target | null;
  onClose: () => void;
  /** Only shown while the dialog is open: it may be empty when there is no target. */
  title: string;
  confirmLabel: string;
  run: (target: Target) => Promise<void>;
  children: (target: Target) => ReactNode;
}) {
  return (
    <Dialog open={target !== null} onClose={onClose} title={title}>
      {target !== null && (
        <ConfirmForm onClose={onClose} confirmLabel={confirmLabel} run={() => run(target)}>
          {children(target)}
        </ConfirmForm>
      )}
    </Dialog>
  );
}

function ConfirmForm({
  onClose,
  confirmLabel,
  run,
  children,
}: {
  onClose: () => void;
  confirmLabel: string;
  run: () => Promise<void>;
  children: ReactNode;
}) {
  const { t } = useI18n();

  // The state is the message of the last refusal.
  const [message, confirm, pending] = useActionState(async (): Promise<string | null> => {
    try {
      await run();
    } catch (err) {
      return adminError(t, err);
    }
    onClose();
    return null;
  }, null);

  return (
    <form action={confirm} className="flex flex-col gap-4">
      {children}
      {message !== null && (
        <p role="alert" className="text-sm font-medium text-red-700">
          {message}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={pending} className={DANGER}>
          {confirmLabel}
        </button>
      </div>
    </form>
  );
}
