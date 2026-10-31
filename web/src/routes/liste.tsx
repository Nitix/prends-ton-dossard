import { createFileRoute } from "@tanstack/react-router";

import { ListPage } from "../features/events/ListPage";
import { validateListSearch } from "../features/events/search";

export const Route = createFileRoute("/liste")({
  // The filters (`personne`, `type`, `periode`) are in the URL.
  validateSearch: validateListSearch,
  component: Liste,
});

function Liste() {
  return <ListPage search={Route.useSearch()} />;
}
