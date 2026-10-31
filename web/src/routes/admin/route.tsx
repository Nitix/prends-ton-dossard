import { createFileRoute, redirect } from "@tanstack/react-router";

import { AdminLayout } from "../../features/admin/AdminLayout";
import { isAdminSession } from "../../features/auth/session";

// The layout of every page under /admin. It only keeps a member from landing
// on a page that is not for them: the server is what refuses their requests.
// It adds the menu that leads from one admin page to another.
export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    if (!isAdminSession()) throw redirect({ to: "/" });
  },
  component: AdminLayout,
});
