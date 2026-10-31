import { Component, type ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider, useI18n } from "./I18nProvider";

function Probe() {
  const { lang, formatLocale, t, f } = useI18n();
  return (
    <p data-testid="probe">
      {lang} {formatLocale} {t.nav.home} {f.inDays(45)}
    </p>
  );
}

/** Shows the message of the error its children throw while rendering. */
class Catch extends Component<{ children: ReactNode }, { message?: string }> {
  override state: { message?: string } = {};

  static getDerivedStateFromError(error: Error) {
    return { message: error.message };
  }

  override render() {
    return this.state.message === undefined ? (
      this.props.children
    ) : (
      <p data-testid="caught">{this.state.message}</p>
    );
  }
}

afterEach(() => {
  document.documentElement.lang = "";
  vi.restoreAllMocks();
});

test("serves the dictionary and formatters of the detected language", async () => {
  const screen = await render(
    <I18nProvider languages={["en-GB", "fr"]}>
      <Probe />
    </I18nProvider>,
  );

  await expect.element(screen.getByTestId("probe")).toHaveTextContent("en en-GB Home in 45 days");
});

test("falls back to French when no language is handled", async () => {
  const screen = await render(
    <I18nProvider languages={["de-DE"]}>
      <Probe />
    </I18nProvider>,
  );

  await expect
    .element(screen.getByTestId("probe"))
    .toHaveTextContent("fr fr-FR Accueil dans 45 jours");
});

test("sets the lang attribute of the page", async () => {
  await render(
    <I18nProvider languages={["en-US"]}>
      <Probe />
    </I18nProvider>,
  );

  expect(document.documentElement.lang).toBe("en");
});

test("reads navigator.languages when none are given", async () => {
  vi.spyOn(Navigator.prototype, "languages", "get").mockReturnValue(["en-GB"]);

  const screen = await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );

  await expect.element(screen.getByTestId("probe")).toHaveTextContent("en en-GB Home in 45 days");
});

test("fails loudly outside the provider", async () => {
  // React logs the error it hands to the boundary.
  vi.spyOn(console, "error").mockImplementation(() => {});

  const screen = await render(
    <Catch>
      <Probe />
    </Catch>,
  );

  await expect
    .element(screen.getByTestId("caught"))
    .toHaveTextContent("useI18n must be used inside an I18nProvider");
});
