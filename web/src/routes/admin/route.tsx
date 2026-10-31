import { createFileRoute, redirect } from "@tanstack/react-router";

import { isAdminSession } from "../../features/auth/session";

// The layout of every page under /admin. It only keeps a member from landing
// on a page that is not for them: the server is what refuses their requests.
export const Route = createFileRoute("/admin")({
  beforeLoad: () => {
    if (!isAdminSession()) throw redirect({ to: "/" });
  },
});
