import { createFileRoute, redirect } from "@tanstack/react-router";

// /admin has no page of its own: the first of the admin pages is the one it leads to.
export const Route = createFileRoute("/admin/")({
  beforeLoad: () => {
    throw redirect({ to: "/admin/membres", replace: true });
  },
});
