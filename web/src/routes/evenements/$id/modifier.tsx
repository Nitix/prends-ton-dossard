import { createFileRoute } from "@tanstack/react-router";

import { Provisional } from "../../../components/Provisional";

// The edit page, until it exists: the page of an event links to it.
export const Route = createFileRoute("/evenements/$id/modifier")({
  component: Provisional,
});
