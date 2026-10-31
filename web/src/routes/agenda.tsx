import { createFileRoute } from "@tanstack/react-router";

import { AgendaPage } from "../features/agenda/AgendaPage";
import { validateAgendaSearch } from "../features/agenda/search";

export const Route = createFileRoute("/agenda")({
  // The filters (`personne`, `type`), the month and the day are in the URL.
  validateSearch: validateAgendaSearch,
  component: Agenda,
});

function Agenda() {
  return <AgendaPage search={Route.useSearch()} />;
}
