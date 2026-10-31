import { createFileRoute } from "@tanstack/react-router";

import { EditEventPage } from "../../../features/events/EventForm";

export const Route = createFileRoute("/evenements/$id/modifier")({
  component: Modifier,
});

function Modifier() {
  return <EditEventPage id={Route.useParams().id} />;
}
