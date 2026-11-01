import { useNavigate } from "@tanstack/react-router";
import { useId, type ReactNode } from "react";

import { INPUT } from "../../components/Field";
import { useI18n } from "../../i18n/I18nProvider";
import { useSession } from "../auth/session";
import { useRaceTypes, useRunners } from "./api";
import type { ListSearch } from "./search";

/** The person and the type, as `applyFilters` takes them. */
export type FilterCriteria = { personne?: string; type?: string };

/**
 * The person and the type of the URL, resolved: `moi` is the runner of the
 * signed-in user. `ready` is false while that runner is loading, and the
 * criteria must not be applied then (they would show everybody's events for
 * an instant).
 */
export function useFilterCriteria(search: ListSearch): {
  criteria: FilterCriteria;
  ready: boolean;
} {
  const { runner } = useSession();
  const me = search.personne === "moi";
  return {
    criteria: { personne: me ? runner?.id : search.personne, type: search.type },
    ready: !me || runner !== null,
  };
}

/**
 * The filters of the list and of the calendar: a person, a race type and,
 * unless `withPeriod` is false, a period. They are written in the search
 * parameters of the page they are on (`personne`, `type`, `periode`), and the
 * other parameters of the page are kept. The default of each (everybody, every
 * type, upcoming) leaves the URL.
 *
 * The page reads them back from the URL and passes them as `search`.
 */
export function Filters({
  search,
  withPeriod = true,
}: {
  search: ListSearch;
  withPeriod?: boolean;
}) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const runners = useRunners();
  const raceTypes = useRaceTypes();

  // A filter is a view of the page, not a place of its own: no history entry.
  const write = (patch: ListSearch) => {
    void navigate({ to: ".", replace: true, search: (previous) => ({ ...previous, ...patch }) });
  };

  return (
    <fieldset className="card flex flex-wrap gap-3 p-3.5">
      <legend className="sr-only">{t.filters.title}</legend>
      <Select
        label={t.filters.person}
        value={search.personne ?? ""}
        onChange={(value) => {
          write({ personne: value === "" ? undefined : value });
        }}
      >
        <option value="">{t.filters.everyone}</option>
        <option value="moi">{t.filters.me}</option>
        {runners.data?.map((runner) => (
          <option key={runner.id} value={runner.id}>
            {runner.name}
          </option>
        ))}
      </Select>
      <Select
        label={t.filters.type}
        value={search.type ?? ""}
        onChange={(value) => {
          write({ type: value === "" ? undefined : value });
        }}
      >
        <option value="">{t.filters.allTypes}</option>
        {raceTypes.data?.map((raceType) => (
          <option key={raceType.id} value={raceType.id}>
            {raceType.label}
          </option>
        ))}
      </Select>
      {withPeriod && (
        <Select
          label={t.filters.period}
          value={search.periode ?? "a-venir"}
          onChange={(value) => {
            write({ periode: value === "passees" ? "passees" : undefined });
          }}
        >
          <option value="a-venir">{t.filters.upcoming}</option>
          <option value="passees">{t.filters.past}</option>
        </Select>
      )}
    </fieldset>
  );
}

/** A labelled native select: the browser gives the picker, the keyboard and the screen reader support. */
function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-40 flex-1 flex-col gap-1">
      <label htmlFor={id} className="eyebrow">
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
        className={INPUT}
      >
        {children}
      </select>
    </div>
  );
}
