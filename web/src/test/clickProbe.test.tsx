import { expect, test } from "vitest";
import { render } from "vitest-browser-react";
import type { Locator } from "vitest/browser";

import { probed, record, type ClickProbe, type PageProbe } from "./clickProbe";

// The probe of round 21 (branch diag/safari-clicks only) times the clicks of WebKit on CI. Its
// parts are tested here on every browser, with a click made slow on purpose.

type Seen = { ms: number; probe: PageProbe | undefined };

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function validate() {
  const screen = await render(<button type="button">Valider</button>);
  return { screen, locator: screen.getByRole("button", { name: "Valider" }) };
}

test("clickProbe — un clic plus long que le seuil laisse un relevé de la page, de l'iframe et de Node", async () => {
  const { screen, locator } = await validate();
  const seen: Seen[] = [];
  // A click of 700 ms, whose pointerdown reaches the page after 400 ms.
  const slow = probed(
    async function (this: Locator) {
      await wait(400);
      this.element().dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      await wait(300);
    },
    (ms, probe) => seen.push({ ms, probe }),
    200,
  );
  await slow.call(locator);
  await screen.unmount();

  expect(seen).toHaveLength(1);
  const { ms, probe } = seen[0] ?? {};
  expect(ms).toBeGreaterThanOrEqual(690);
  expect(probe?.error).toBeUndefined();
  expect(probe?.doc).toEqual({ visibility: "visible", hidden: false, focus: expect.any(Boolean) });
  expect(probe?.top).toEqual({ visibility: "visible", focus: expect.any(Boolean) });
  // The page drew frames and its main thread was free all along.
  expect(probe?.raf.total).toBeGreaterThan(0);
  expect(probe?.raf.per500).toHaveLength(2);
  expect(probe?.timer.total).toBeGreaterThan(10);
  expect(probe?.timer.maxGap).toBeLessThan(200);
  expect(probe?.events.pointerdown).toBeGreaterThanOrEqual(390);
  expect(probe?.frame).toMatch(/^-?\d+,-?\d+ \d+×\d+ dans \d+×\d+/);
  const box = /^-?\d+,-?\d+ \d+×\d+ dans \d+×\d+, défilé -?\d+,-?\d+$/;
  expect(probe?.targetStart).toMatch(box);
  expect(probe?.target).toMatch(box);
  // Node answered: the sampler only runs on WebKit on CI, so it may have no tick.
  expect(probe?.node).toMatchObject({
    maxLag: expect.any(Number),
    samples: expect.any(Number),
    contexts: expect.any(Number),
    rpcMs: expect.any(Number),
  });
});

test("clickProbe — un clic rapide n'est que chronométré", async () => {
  const { screen, locator } = await validate();
  const seen: Seen[] = [];
  await probed(
    async function () {},
    (ms, probe) => seen.push({ ms, probe }),
  ).call(locator);
  await screen.unmount();
  expect(seen).toHaveLength(1);
  expect(seen[0]?.ms).toBeLessThan(1500);
  expect(seen[0]?.probe).toBeUndefined();
});

test("clickProbe — un clic qui échoue laisse son relevé et rend la même erreur", async () => {
  const { screen, locator } = await validate();
  const seen: Seen[] = [];
  const boom = new Error("locator.click: Timeout 5000ms exceeded.\nCall log:\n  - done scrolling");
  const failing = probed(
    async function () {
      throw boom;
    },
    (ms, probe) => seen.push({ ms, probe }),
  );
  await expect(failing.call(locator)).rejects.toBe(boom);
  await screen.unmount();
  expect(seen[0]?.probe?.error).toBe("Error: locator.click: Timeout 5000ms exceeded.");
});

test("clickProbe — record range la durée de chaque clic, et le relevé avec son essai", () => {
  const task: { meta: { clickMs?: number[]; clickProbe?: ClickProbe[] }; result: object } = {
    meta: {},
    result: { retryCount: 1 },
  };
  const probe: PageProbe = {
    ms: 1600,
    doc: { visibility: "visible", hidden: false, focus: true },
    top: null,
    raf: { total: 0, maxGap: 1600, first: null, per500: [0, 0, 0, 0] },
    timer: { total: 0, maxGap: 1600, per500: [0, 0, 0, 0] },
    events: {},
    frame: null,
    targetStart: null,
    target: null,
    node: { error: "pas de réponse en 3 s" },
  };
  record(task, 120.6, undefined);
  record(task, 1600.4, probe);
  expect(task.meta.clickMs).toEqual([121, 1600]);
  expect(task.meta.clickProbe).toEqual([{ attempt: 1, ...probe }]);
  // Outside of a test, nothing.
  expect(() => record(undefined, 1, undefined)).not.toThrow();
});
