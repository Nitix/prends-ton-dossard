import { useActionState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { RunnerRecord } from "../../lib/types";
import { text } from "../profile/forms";
import { useMemberActions } from "./api";
import { adminError } from "./errors";

/** What the dialog is for: a new runner, or the new name of one. */
export type RunnerNameTarget = { kind: "create" } | { kind: "rename"; runner: RunnerRecord };

/**
 * Names a runner: a new one, or an existing one that is renamed. It is open
 * while it has a target. The name has to be unique, whatever its case: the
 * server says when it is not, under the field.
 */
export function RunnerNameDialog({
  target,
  onClose,
}: {
  target: RunnerNameTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target?.kind === "rename" ? t.admin.renameTitle : t.admin.createTitle}
    >
      {target !== null && <NameForm target={target} onClose={onClose} />}
    </Dialog>
  );
}

type FormState = { name: string; message: string | null };

function NameForm({ target, onClose }: { target: RunnerNameTarget; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const actions = useMemberActions();

  // The name stays in the form after a refusal.
  const [state, submit, pending] = useActionState(
    async (_previous: FormState, form: FormData): Promise<FormState> => {
      const name = text(form, "name").trim();
      if (name === "") return { name, message: t.errors.validation_required };
      try {
        if (target.kind === "rename") {
          await actions.renameRunner(target.runner.id, name);
        } else {
          await actions.createRunner(name);
        }
      } catch (err) {
        return { name, message: adminError(t, err) };
      }
      toast.show(target.kind === "rename" ? t.admin.renamed : t.admin.created);
      onClose();
      return { name, message: null };
    },
    { name: target.kind === "rename" ? target.runner.name : "", message: null },
  );

  return (
    <form action={submit} className="flex flex-col gap-4">
      <TextField
        label={t.admin.runnerName}
        name="name"
        autoComplete="off"
        defaultValue={state.name}
        hint={t.admin.runnerNameHint}
        error={state.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending
            ? t.auth.saving
            : target.kind === "rename"
              ? t.common.save
              : t.admin.createSubmit}
        </button>
      </div>
    </form>
  );
}
