import { createFileRoute } from "@tanstack/react-router";

import { InvitationPage } from "../features/auth/InvitationPage";

// The token of the link is in the fragment (`/invitation#<token>`), which the
// page reads and removes from the address: it is not a path or a search
// parameter, so the route has none.
export const Route = createFileRoute("/invitation")({
  component: InvitationPage,
});
