import { useActionState } from "react";

import { PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { fieldErrors } from "../../i18n/errors";
import type { Messages } from "../../i18n/fr";
import { useI18n } from "../../i18n/I18nProvider";
import type { RaceTypeRecord } from "../../lib/types";
import { text } from "../profile/forms";
import { useRaceTypeActions } from "./api";
import { adminError } from "./errors";

/** What the dialog is for: a new race type, or the new name of one. */
export type RaceTypeTarget = { kind: "create" } | { kind: "rename"; raceType: RaceTypeRecord };

/**
 * Names a race type: a new one, or an existing one that is renamed. It is
 * open while it has a target. The name has to be unique, whatever its case:
 * the server says when it is not, under the field.
 */
export function RaceTypeDialog({
  target,
  onClose,
}: {
  target: RaceTypeTarget | null;
  onClose: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={target !== null}
      onClose={onClose}
      title={target?.kind === "rename" ? t.admin.renameTypeTitle : t.admin.createTypeTitle}
    >
      {target !== null && <LabelForm target={target} onClose={onClose} />}
    </Dialog>
  );
}

type FormState = { label: string; message: string | null };

/** A name that is taken has a message of its own: «cette valeur» says nothing about which one. */
function labelMessage(t: Messages, err: unknown): string {
  return fieldErrors(err).label === "validation_not_unique"
    ? t.admin.typeExists
    : adminError(t, err);
}

function LabelForm({ target, onClose }: { target: RaceTypeTarget; onClose: () => void }) {
  const { t } = useI18n();
  const toast = useToast();
  const actions = useRaceTypeActions();

  // The name stays in the form after a refusal.
  const [state, submit, pending] = useActionState(
    async (_previous: FormState, form: FormData): Promise<FormState> => {
      const label = text(form, "label").trim();
      if (label === "") return { label, message: t.errors.validation_required };
      try {
        if (target.kind === "rename") {
          await actions.renameType(target.raceType.id, label);
        } else {
          await actions.createType(label);
        }
      } catch (err) {
        return { label, message: labelMessage(t, err) };
      }
      toast.show(target.kind === "rename" ? t.admin.typeRenamed : t.admin.typeCreated);
      onClose();
      return { label, message: null };
    },
    { label: target.kind === "rename" ? target.raceType.label : "", message: null },
  );

  return (
    <form action={submit} className="flex flex-col gap-4">
      <TextField
        label={t.admin.typeLabel}
        name="label"
        autoComplete="off"
        defaultValue={state.label}
        hint={t.admin.typeLabelHint}
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
