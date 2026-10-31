// The filters of the list (and of the calendar) live in the URL, so that a
// filtered view can be shared and survives a reload.

/**
 * The search parameters of the list:
 * - `personne`: a runner id, or `moi` for the runner of the signed-in user
 *   (resolved by `useFilterCriteria`); absent means everybody;
 * - `type`: a race type id; absent means every type;
 * - `periode`: `a-venir` when absent.
 */
export type ListSearch = {
  personne?: string;
  type?: string;
  periode?: "a-venir" | "passees";
};

/**
 * Reads the search parameters of the URL, which anybody can write by hand:
 * what is not understood is dropped, which leaves the default.
 */
export function validateListSearch(search: Record<string, unknown>): ListSearch {
  const { personne, type, periode } = search;
  return {
    personne: typeof personne === "string" && personne !== "" ? personne : undefined,
    type: typeof type === "string" && type !== "" ? type : undefined,
    periode: periode === "a-venir" || periode === "passees" ? periode : undefined,
  };
}
