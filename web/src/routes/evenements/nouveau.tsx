import { createFileRoute } from "@tanstack/react-router";

import { EventForm } from "../../features/events/EventForm";

export const Route = createFileRoute("/evenements/nouveau")({
  component: EventForm,
});
