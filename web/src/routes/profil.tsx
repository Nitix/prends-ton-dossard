import { createFileRoute } from "@tanstack/react-router";

import { Provisional } from "../components/Provisional";

export const Route = createFileRoute("/profil")({
  component: Provisional,
});
