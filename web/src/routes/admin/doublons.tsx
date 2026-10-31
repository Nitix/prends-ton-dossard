import { createFileRoute } from "@tanstack/react-router";

import { DuplicatesPage } from "../../features/admin/DuplicatesPage";

export const Route = createFileRoute("/admin/doublons")({
  component: DuplicatesPage,
});
