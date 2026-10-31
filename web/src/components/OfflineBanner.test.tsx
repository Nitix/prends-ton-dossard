import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { OfflineBanner } from "./OfflineBanner";

afterEach(() => {
  vi.restoreAllMocks();
});

function renderBanner() {
  return render(
    <I18nProvider languages={["fr"]}>
      <OfflineBanner />
    </I18nProvider>,
  );
}

test("OfflineBanner — apparaît après un événement offline, disparaît après online", async () => {
  const screen = await renderBanner();
  await expect.element(screen.getByText(fr.common.offline)).not.toBeInTheDocument();

  window.dispatchEvent(new Event("offline"));
  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.common.offline);

  window.dispatchEvent(new Event("online"));
  await expect.element(screen.getByText(fr.common.offline)).not.toBeInTheDocument();
});

test("OfflineBanner — est affichée dès le départ quand le navigateur est déjà hors connexion", async () => {
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);

  const screen = await renderBanner();

  await expect.element(screen.getByRole("status")).toHaveTextContent(fr.common.offline);
});
