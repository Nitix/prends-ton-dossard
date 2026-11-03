import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { AMBIENT_KEY, chooseAmbient, readAmbient } from "./ambient";

// The animated background of the skins that have one (src/skins/README.md,
// « Motion »): on by default, and a person can turn it off. It is kept on the
// device, in the local storage, like the theme: here, without a browser, with a
// stand-in storage that can refuse, as it does in some private windows. That a
// motif stands still when it is off is the test of the motifs
// (src/skins/carnet/motifs.test.tsx); the switch, that of the settings.

let stored: Map<string, string>;
let refuse: boolean;

const storage = {
  getItem: (key: string) => {
    if (refuse) throw new DOMException("The storage is off", "SecurityError");
    return stored.get(key) ?? null;
  },
  setItem: (key: string, value: string) => {
    if (refuse) throw new DOMException("The storage is full", "QuotaExceededError");
    stored.set(key, value);
  },
  removeItem: (key: string) => {
    if (refuse) throw new DOMException("The storage is off", "SecurityError");
    stored.delete(key);
  },
};

beforeEach(() => {
  stored = new Map();
  refuse = false;
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("window", { addEventListener() {}, removeEventListener() {} });
});

afterEach(() => {
  chooseAmbient(true);
  vi.unstubAllGlobals();
});

test("ambient — le fond animé est allumé par défaut", () => {
  expect(readAmbient()).toBe(true);
});

test("ambient — éteint, c'est gardé sur l'appareil ; rallumé, il n'y a plus rien de gardé", () => {
  chooseAmbient(false);
  expect(stored.get(AMBIENT_KEY)).toBe("off");
  expect(readAmbient()).toBe(false);

  chooseAmbient(true);
  expect(stored.has(AMBIENT_KEY)).toBe(false);
  expect(readAmbient()).toBe(true);
});

test("ambient — une valeur inconnue dans le stockage, c'est allumé", () => {
  for (const value of ["", "on", "OFF", "false", "0", '"off"']) {
    stored.set(AMBIENT_KEY, value);
    expect(readAmbient(), `kept: ${value}`).toBe(true);
  }
});

test("ambient — un stockage qui refuse ne casse rien : allumé à la lecture, le choix vaut pour la page", () => {
  refuse = true;
  expect(readAmbient()).toBe(true);
  expect(() => {
    chooseAmbient(false);
  }).not.toThrow();
  // Not kept, but the page has it.
  expect(readAmbient()).toBe(false);
  expect(() => {
    chooseAmbient(true);
  }).not.toThrow();
  expect(readAmbient()).toBe(true);
});
