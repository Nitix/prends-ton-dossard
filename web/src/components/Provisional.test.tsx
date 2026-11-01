import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n/I18nProvider";

import "../styles.css";
import { Provisional } from "./Provisional";

test("shows the app name in a heading", async () => {
  const screen = await render(
    <I18nProvider languages={["fr"]}>
      <Provisional />
    </I18nProvider>,
  );

  const heading = screen.getByRole("heading", { name: "Prends ton dossard" });
  await expect.element(heading).toBeVisible();
  // The styles are compiled for the browser tests (the `page-title` of styles.css: extra bold).
  expect(getComputedStyle(heading.element()).fontWeight).toBe("800");
});

test("shows the same app name in English", async () => {
  const screen = await render(
    <I18nProvider languages={["en"]}>
      <Provisional />
    </I18nProvider>,
  );

  await expect.element(screen.getByRole("heading", { name: "Prends ton dossard" })).toBeVisible();
});
