import { createFileRoute } from "@tanstack/react-router";

import { RunnerPage } from "../../features/runners/RunnerPage";

export const Route = createFileRoute("/coureurs/$id")({
  component: Coureur,
});

function Coureur() {
  return <RunnerPage id={Route.useParams().id} />;
}
