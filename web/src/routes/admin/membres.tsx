import { createFileRoute } from "@tanstack/react-router";

import { MembersPage } from "../../features/admin/MembersPage";

export const Route = createFileRoute("/admin/membres")({
  component: MembersPage,
});
