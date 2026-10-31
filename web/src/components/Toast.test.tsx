import { afterEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ToastProvider, useToast } from "./Toast";

afterEach(() => {
  vi.useRealTimers();
});

function Trigger({ message }: { message: string }) {
  const toast = useToast();
  return (
    <button type="button" onClick={() => toast.show(message)}>
      {message}!
    </button>
  );
}

test("Toast — show affiche le message dans une zone de statut", async () => {
  const screen = await render(
    <ToastProvider>
      <Trigger message="Enregistré" />
    </ToastProvider>,
  );

  await screen.getByRole("button", { name: "Enregistré!" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("Enregistré");
});

test("Toast — le message disparaît tout seul", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const screen = await render(
    <ToastProvider>
      <Trigger message="Enregistré" />
    </ToastProvider>,
  );
  await screen.getByRole("button", { name: "Enregistré!" }).click();
  await expect.element(screen.getByRole("status")).toHaveTextContent("Enregistré");

  await vi.advanceTimersByTimeAsync(10_000);

  await expect.element(screen.getByRole("status")).toBeEmptyDOMElement();
});

test("Toast — plusieurs messages sont empilés", async () => {
  const screen = await render(
    <ToastProvider>
      <Trigger message="Un" />
      <Trigger message="Deux" />
    </ToastProvider>,
  );

  await screen.getByRole("button", { name: "Un!" }).click();
  await screen.getByRole("button", { name: "Deux!" }).click();

  await expect.element(screen.getByRole("status")).toHaveTextContent("UnDeux");
});

test("Toast — useToast hors du fournisseur lève une erreur", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});

  await expect(render(<Trigger message="x" />)).rejects.toThrow(
    "useToast must be used inside a ToastProvider",
  );
});
