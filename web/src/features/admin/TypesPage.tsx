import { useRef, useState } from "react";

import { DANGER_TEXT, PRIMARY, SECONDARY } from "../../components/buttons";
import { useToast } from "../../components/Toast";
import { useI18n } from "../../i18n/I18nProvider";
import type { RaceTypeRecord } from "../../lib/types";
import { usePageTitle } from "../../lib/usePageTitle";
import { useRestoreFocus } from "../../lib/useRestoreFocus";
import { useRaceTypes } from "../events/api";
import { useRaceTypeActions } from "./api";
import { ConfirmDialog } from "./ConfirmDialog";
import { MeasuresDialog } from "./MeasuresDialog";
import { RaceTypeDialog, type RaceTypeTarget } from "./RaceTypeDialog";

/** The dialog that is open on the page, and what it is about. At most one is open. */
type TypeDialog =
  | RaceTypeTarget
  | { kind: "measures"; raceType: RaceTypeRecord }
  | { kind: "delete"; raceType: RaceTypeRecord };

/**
 * The race types page of the admin: the list the formats of the events choose
 * from, which the admin adds to, renames and deletes from. A type that a
 * format uses is not deleted: the server refuses, and the confirmation says
 * so. The app shell around this owns the page's `<main>`.
 *
 * The title of the page can take the focus (it is not in the tab order): it is
 * where the focus goes when a type is deleted, the button that opened the
 * confirmation being gone with its row.
 */
export function TypesPage() {
  const { t } = useI18n();
  usePageTitle(t.titles.raceTypes);
  const toast = useToast();
  const raceTypes = useRaceTypes();
  const actions = useRaceTypeActions();
  const title = useRef<HTMLHeadingElement>(null);
  const [dialog, setDialog] = useState<TypeDialog | null>(null);

  useRestoreFocus(dialog !== null, () => title.current);

  const close = () => {
    setDialog(null);
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 ref={title} tabIndex={-1} className="page-title">
        {t.admin.typesTitle}
      </h1>
      <button
        type="button"
        onClick={() => {
          setDialog({ kind: "create" });
        }}
        className={`${PRIMARY} self-start`}
      >
        {t.admin.addType}
      </button>
      {/* A refresh that fails keeps what the list already shows. */}
      {raceTypes.data ? (
        raceTypes.data.length === 0 ? (
          <p>{t.admin.typesEmpty}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {raceTypes.data.map((raceType) => (
              <li
                key={raceType.id}
                className="type-row card flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <h2 className="card-title min-w-0 break-words">{raceType.label}</h2>
                <div className="flex flex-wrap gap-2">
                  <RowAction
                    label={t.admin.measures}
                    name={raceType.label}
                    onClick={() => {
                      setDialog({ kind: "measures", raceType });
                    }}
                  />
                  <RowAction
                    label={t.admin.rename}
                    name={raceType.label}
                    onClick={() => {
                      setDialog({ kind: "rename", raceType });
                    }}
                  />
                  <RowAction
                    label={t.common.delete}
                    name={raceType.label}
                    danger
                    onClick={() => {
                      setDialog({ kind: "delete", raceType });
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )
      ) : raceTypes.isError ? (
        <div className="flex flex-col gap-3">
          <p role="alert" className="text-sm font-medium text-red-700">
            {t.errors.generic}
          </p>
          <button
            type="button"
            onClick={() => void raceTypes.refetch()}
            disabled={raceTypes.isFetching}
            className={`${SECONDARY} self-start`}
          >
            {t.common.retry}
          </button>
        </div>
      ) : (
        <output>{t.common.loading}</output>
      )}

      <RaceTypeDialog
        target={dialog?.kind === "create" || dialog?.kind === "rename" ? dialog : null}
        onClose={close}
      />
      <MeasuresDialog
        raceType={dialog?.kind === "measures" ? dialog.raceType : null}
        onClose={close}
      />
      <ConfirmDialog
        target={dialog?.kind === "delete" ? dialog : null}
        onClose={close}
        title={t.admin.deleteTypeTitle}
        confirmLabel={t.common.delete}
        run={async ({ raceType }) => {
          await actions.deleteType(raceType.id);
          toast.show(t.admin.typeDeleted);
        }}
      >
        {({ raceType }) => <p>{t.admin.deleteTypeWarning(raceType.label)}</p>}
      </ConfirmDialog>
    </div>
  );
}

/**
 * A button of a row. Its accessible name starts with its text and goes on
 * with the type it is about, since the buttons of a list would otherwise all
 * sound the same.
 */
function RowAction({
  label,
  name,
  onClick,
  danger = false,
}: {
  label: string;
  name: string;
  onClick: () => void;
  danger?: boolean;
}) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t.admin.forItem(label, name)}
      onClick={onClick}
      className={`${SECONDARY} ${danger ? DANGER_TEXT : ""}`}
    >
      {label}
    </button>
  );
}
