import { createFileRoute } from "@tanstack/react-router";

import { validateStatsSearch } from "../features/stats/search";
import { StatsPage } from "../features/stats/StatsPage";

export const Route = createFileRoute("/stats")({
  // The year is in the URL (`annee`).
  validateSearch: validateStatsSearch,
  component: Stats,
});

function Stats() {
  return <StatsPage search={Route.useSearch()} />;
}
