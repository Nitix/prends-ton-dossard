import { createFileRoute } from "@tanstack/react-router";

import { Provisional } from "../../../components/Provisional";

// The page of an event, until it exists: the cards of the list link to it.
export const Route = createFileRoute("/evenements/$id/")({
  component: Provisional,
});
