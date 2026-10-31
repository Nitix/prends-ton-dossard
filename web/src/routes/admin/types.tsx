import { createFileRoute } from "@tanstack/react-router";

import { TypesPage } from "../../features/admin/TypesPage";

export const Route = createFileRoute("/admin/types")({
  component: TypesPage,
});
