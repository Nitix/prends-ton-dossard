import { createFileRoute } from "@tanstack/react-router";

import { LoginPage } from "../features/auth/LoginPage";

export const Route = createFileRoute("/connexion")({
  // `redirect` is the page to go back to once signed in (see __root.tsx).
  validateSearch: (search: Record<string, unknown>): { redirect?: string } => ({
    redirect: typeof search.redirect === "string" ? search.redirect : undefined,
  }),
  component: Connexion,
});

function Connexion() {
  const { redirect } = Route.useSearch();
  return <LoginPage redirect={redirect} />;
}
