import { expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../i18n/I18nProvider";
import { usePageTitle } from "./usePageTitle";

function Page({ title }: { title: string | null }) {
  usePageTitle(title);
  return <p>page</p>;
}

const app = (languages: string[], title: string | null) => (
  <I18nProvider languages={languages}>
    <Page title={title} />
  </I18nProvider>
);

test("usePageTitle — pose et change le titre", async () => {
  const screen = await render(app(["fr"], "Agenda"));
  expect(document.title).toBe("Agenda · Prends ton dossard");

  await screen.rerender(app(["fr"], "Trail des Crêtes"));
  expect(document.title).toBe("Trail des Crêtes · Prends ton dossard");

  // No title yet: the name of the app alone.
  await screen.rerender(app(["fr"], null));
  expect(document.title).toBe("Prends ton dossard");

  // A name typed by a member is text, never markup.
  await screen.rerender(app(["fr"], "<b>Trail</b> & co"));
  expect(document.title).toBe("<b>Trail</b> & co · Prends ton dossard");
});

test("usePageTitle — la page qui s'en va rend le nom de l'application", async () => {
  const screen = await render(app(["fr"], "Agenda"));
  expect(document.title).toBe("Agenda · Prends ton dossard");

  await screen.unmount();
  expect(document.title).toBe("Prends ton dossard");
});
