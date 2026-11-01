import { useRef } from "react";
import { expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../i18n/en";
import { fr } from "../i18n/fr";
import { I18nProvider } from "../i18n/I18nProvider";
import { buttonOf, clickTwice } from "../test/busyButton";
import { LoadFailure } from "./LoadFailure";

// The tap targets are a matter of the styles, which are not loaded otherwise.
import "../styles.css";

/** A page: its title, which takes the focus, and the failure under it. */
function Page({ onRetry }: { onRetry: () => Promise<unknown> | void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <>
      <h1 ref={heading} tabIndex={-1}>
        Titre de la page
      </h1>
      <LoadFailure onRetry={onRetry} heading={heading} />
    </>
  );
}

function mount(onRetry: () => Promise<unknown> | void, languages: string[] = ["fr"]) {
  return render(
    <I18nProvider languages={languages}>
      <Page onRetry={onRetry} />
    </I18nProvider>,
  );
}

type Screen = Awaited<ReturnType<typeof mount>>;

const retryButton = (screen: Screen, name = fr.common.retry) =>
  screen.getByRole("button", { name, exact: true });
const title = (screen: Screen) => screen.getByRole("heading", { name: "Titre de la page" });

test("LoadFailure — le message, et un bouton Réessayer d'au moins 44 px", async () => {
  const screen = await mount(() => {});

  await expect.element(screen.getByRole("alert")).toHaveTextContent(fr.errors.generic);
  await expect.element(retryButton(screen)).toBeVisible();
  const { width, height } = retryButton(screen).element().getBoundingClientRect();
  expect(width).toBeGreaterThanOrEqual(44);
  expect(height).toBeGreaterThanOrEqual(44);
});

test("LoadFailure — en anglais", async () => {
  const screen = await mount(() => {}, ["en"]);

  await expect.element(screen.getByRole("alert")).toHaveTextContent(en.errors.generic);
  await expect.element(retryButton(screen, en.common.retry)).toBeVisible();
});

test("LoadFailure — Réessayer redemande, et le focus est déjà sur le titre à ce moment-là", async () => {
  // The block goes as soon as the request starts (the page is « loading » again):
  // the focus must be on something that stays by then, never on the page.
  let focused: Element | null = null;
  const retry = vi.fn<() => void>(() => {
    focused = document.activeElement;
  });
  const screen = await mount(retry);

  await retryButton(screen).click();

  expect(retry).toHaveBeenCalledOnce();
  await expect.element(title(screen)).toHaveFocus();
  expect(focused).toBe(title(screen).element());
});

test("LoadFailure — le bouton dit qu'il travaille sans être désactivé, et un double appui ne redemande qu'une fois", async () => {
  const request = Promise.withResolvers<void>();
  const retry = vi.fn<() => Promise<void>>(() => request.promise);
  const screen = await mount(retry);
  const button = buttonOf(retryButton(screen));

  // Two taps in the same tick, as a double tap does.
  clickTwice(button);

  await vi.waitFor(() => {
    expect(button.getAttribute("aria-disabled")).toBe("true");
  });
  // Never `disabled`: a disabled button would drop the focus to the page.
  expect(button.disabled).toBe(false);
  button.click();
  expect(retry).toHaveBeenCalledOnce();

  // The request is over (and failed again: the block is still there): another try is possible.
  request.resolve();
  await vi.waitFor(() => {
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });
  button.click();
  expect(retry).toHaveBeenCalledTimes(2);
});

test("LoadFailure — une demande qui échoue rend le bouton", async () => {
  const retry = vi.fn<() => Promise<void>>(() => Promise.reject(new Error("network")));
  const screen = await mount(retry);
  const button = buttonOf(retryButton(screen));

  button.click();

  await vi.waitFor(() => {
    expect(button.getAttribute("aria-disabled")).toBeNull();
  });
  expect(retry).toHaveBeenCalledOnce();
});
