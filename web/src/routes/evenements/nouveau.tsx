import { createFileRoute } from "@tanstack/react-router";

import { NewEventPage } from "../../features/events/EventForm";

export const Route = createFileRoute("/evenements/nouveau")({
  component: NewEventPage,
});
