import { createFileRoute } from "@tanstack/react-router";

import { SettingsPage } from "../../features/profile/SettingsPage";

export const Route = createFileRoute("/profil/reglages")({
  component: SettingsPage,
});
