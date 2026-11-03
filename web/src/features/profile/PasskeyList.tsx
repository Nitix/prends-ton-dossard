import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useActionState, useState } from "react";

import { DANGER, PRIMARY, SECONDARY } from "../../components/buttons";
import { Dialog } from "../../components/Dialog";
import { TextField } from "../../components/TextField";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import { PARIS } from "../../lib/dates";
import { pb } from "../../lib/pb";
import type { PasskeyRecord } from "../../lib/types";
import { passkeysSupported, registerPasskey } from "../auth/passkeys";
import { describeError, text } from "./forms";
import { Section } from "./Section";

/** What a dialog is open for: a new passkey, or one of the list to rename or delete. */
type Mode = "add" | "rename" | "remove";

/**
 * "My passkeys": the passkeys of the signed-in user, to add, rename or delete.
 * Adding one is left out in a browser that has no WebAuthn; the list stays,
 * since a passkey made elsewhere can still be deleted from here.
 */
export function PasskeyList({ userId }: { userId: string }) {
  const { t, formatLocale } = useI18n();
  const supported = passkeysSupported();

  const query = useQuery({
    queryKey: ["passkeys", userId],
    // An admin may read everybody's passkeys: this is the list of one's own.
    queryFn: () =>
      pb.collection("passkeys").getFullList<PasskeyRecord>({
        filter: pb.filter("user = {:id}", { id: userId }),
        sort: "-created",
      }),
  });

  const [mode, setMode] = useState<Mode | null>(null);
  // The passkey of the rename and delete dialogs: kept once they close, they
  // do not render it then.
  const [target, setTarget] = useState<PasskeyRecord | null>(null);
  const close = () => setMode(null);
  const open = (next: "rename" | "remove", passkey: PasskeyRecord) => {
    setTarget(passkey);
    setMode(next);
  };

  return (
    <Section title={t.passkeys.title}>
      <p className="text-sm text-neutral-600">{t.passkeys.intro}</p>
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
      {query.isSuccess && query.data.length === 0 && <p className="text-sm">{t.passkeys.empty}</p>}
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
              <div className="flex gap-2">
                {/* The name of the key is in the accessible name only: the
                    buttons of a list would otherwise sound the same. It starts
                    with the visible text, as an accessible name should. */}
                <button
                  type="button"
                  onClick={() => open("rename", passkey)}
                  aria-label={`${t.passkeys.rename} ${passkey.name}`}
                  className={SECONDARY}
                >
                  {t.passkeys.rename}
                </button>
                <button
                  type="button"
                  onClick={() => open("remove", passkey)}
                  aria-label={`${t.common.delete} ${passkey.name}`}
                  className={SECONDARY}
                >
                  {t.common.delete}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {supported && (
        <button type="button" onClick={() => setMode("add")} className={`${PRIMARY} self-start`}>
          {t.passkeys.add}
        </button>
      )}

      <AddDialog open={mode === "add"} onClose={close} userId={userId} />
      <RenameDialog open={mode === "rename"} onClose={close} userId={userId} passkey={target} />
      <RemoveDialog open={mode === "remove"} onClose={close} userId={userId} passkey={target} />
    </Section>
  );
}

/** The day of a PocketBase date-time (UTC, `YYYY-MM-DD HH:MM:SS.sssZ`), in Paris, as the locale writes it. */
export function day(formatLocale: string, dateTime: string): string {
  return new Date(dateTime.replace(" ", "T")).toLocaleDateString(formatLocale, {
    dateStyle: "medium",
    timeZone: PARIS,
  });
}

// --- Naming a passkey: adding one, renaming one ---

/** How saving a name went: it worked, the user turned a prompt down, or it failed for this reason. */
type SaveResult = { status: "saved" | "cancelled" } | { status: "failed"; message: string };

type NameState = { name: string; message: string | null };

function NameDialog({
  open,
  onClose,
  title,
  submitLabel,
  initialName,
  hint,
  save,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  initialName: string;
  hint?: string;
  save: (name: string) => Promise<SaveResult>;
}) {
  return (
    <Dialog open={open} onClose={onClose} title={title}>
      <NameForm
        onClose={onClose}
        submitLabel={submitLabel}
        initialName={initialName}
        hint={hint}
        save={save}
      />
    </Dialog>
  );
}

function NameForm({
  onClose,
  submitLabel,
  initialName,
  hint,
  save,
}: {
  onClose: () => void;
  submitLabel: string;
  initialName: string;
  hint?: string;
  save: (name: string) => Promise<SaveResult>;
}) {
  const { t } = useI18n();

  // The name stays in the form after a refusal, or a prompt turned down.
  const [state, submit, pending] = useActionState(
    async (_previous: NameState, form: FormData): Promise<NameState> => {
      const name = text(form, "name").trim();
      if (name === "") return { name, message: t.errors.validation_required };
      const result = await save(name);
      if (result.status === "saved") {
        onClose();
        return { name, message: null };
      }
      return { name, message: result.status === "failed" ? result.message : null };
    },
    { name: initialName, message: null },
  );

  return (
    <form action={submit} className="flex flex-col gap-4">
      <TextField
        label={t.passkeys.name}
        name="name"
        autoComplete="off"
        defaultValue={state.name}
        hint={hint}
        error={state.message}
      />
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className={SECONDARY}>
          {t.common.cancel}
        </button>
        <button type="submit" disabled={pending} className={PRIMARY}>
          {pending ? t.auth.saving : submitLabel}
        </button>
      </div>
    </form>
  );
}

function AddDialog({
  open,
  onClose,
  userId,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  async function save(name: string): Promise<SaveResult> {
    try {
      // False when the user turned the prompt of the browser down.
      if (!(await registerPasskey(name))) return { status: "cancelled" };
    } catch (err) {
      const message =
        err instanceof DOMException && err.name === "InvalidStateError"
          ? t.passkeys.alreadyRegistered
          : describeError(t, err);
      return { status: "failed", message };
    }
    await queryClient.invalidateQueries({ queryKey: ["passkeys", userId] });
    toast.show(t.passkeys.added);
    return { status: "saved" };
  }

  return (
    <NameDialog
      open={open}
      onClose={onClose}
      title={t.passkeys.addTitle}
      submitLabel={t.passkeys.addSubmit}
      initialName=""
      hint={t.passkeys.nameHint}
      save={save}
    />
  );
}

function RenameDialog({
  open,
  onClose,
  userId,
  passkey,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  passkey: PasskeyRecord | null;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  async function save(name: string): Promise<SaveResult> {
    if (passkey === null) return { status: "cancelled" };
    try {
      await pb.collection("passkeys").update(passkey.id, { name });
    } catch (err) {
      return { status: "failed", message: describeError(t, err) };
    }
    await queryClient.invalidateQueries({ queryKey: ["passkeys", userId] });
    toast.show(t.passkeys.renamed);
    return { status: "saved" };
  }

  return (
    <NameDialog
      open={open}
      onClose={onClose}
      title={t.passkeys.renameTitle}
      submitLabel={t.common.save}
      initialName={passkey?.name ?? ""}
      save={save}
    />
  );
}

// --- Deleting a passkey ---

function RemoveDialog({
  open,
  onClose,
  userId,
  passkey,
}: {
  open: boolean;
  onClose: () => void;
  userId: string;
  passkey: PasskeyRecord | null;
}) {
  const { t } = useI18n();
  return (
    <Dialog open={open} onClose={onClose} title={t.passkeys.removeTitle}>
      {passkey !== null && <RemoveForm passkey={passkey} userId={userId} onClose={onClose} />}
    </Dialog>
  );
}

function RemoveForm({
  passkey,
  userId,
  onClose,
}: {
  passkey: PasskeyRecord;
  userId: string;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();

  // The state is the message of the last failure.
  const [message, remove, pending] = useActionState(async (): Promise<string | null> => {
    try {
      await pb.collection("passkeys").delete(passkey.id);
    } catch (err) {
      return describeError(t, err);
    }
    await queryClient.invalidateQueries({ queryKey: ["passkeys", userId] });
    toast.show(t.passkeys.removed);
    onClose();
    return null;
  }, null);

  return (
    <form action={remove} className="flex flex-col gap-4">
      <p>{t.passkeys.removeWarning(passkey.name)}</p>
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
          {t.common.delete}
        </button>
      </div>
    </form>
  );
}
