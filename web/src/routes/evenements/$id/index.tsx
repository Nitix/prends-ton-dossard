import { createFileRoute } from "@tanstack/react-router";

import { EventPage } from "../../../features/events/EventPage";

export const Route = createFileRoute("/evenements/$id/")({
  component: Evenement,
});

function Evenement() {
  return <EventPage id={Route.useParams().id} />;
}
