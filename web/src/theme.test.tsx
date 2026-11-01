import { afterEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { applyTheme } from "./lib/theme";
import { emulateMedia, resetMedia } from "./test/media";

import "./styles.css";

// The dark theme in a real browser: the stylesheet follows the setting of the
// phone when nothing is chosen, a choice wins over it, and the sky of the
// header stays the dawn whatever the theme. The numbers of the colours are
// tested in src/dark.test.ts.

afterEach(async () => {
  await resetMedia();
  applyTheme("auto");
  document.documentElement.style.colorScheme = "";
});

/** The colours of the page as it paints them now: the sheet, a card, the ink. */
function painted() {
  const probe = document.createElement("div");
  probe.className = "bg-neutral-50";
  probe.innerHTML = '<p class="bg-card text-ink">texte</p>';
  document.body.append(probe);
  const card = probe.firstElementChild ?? probe;
  const colours = {
    sheet: getComputedStyle(probe).backgroundColor,
    card: getComputedStyle(card).backgroundColor,
    ink: getComputedStyle(card).color,
    scheme: getComputedStyle(document.documentElement).colorScheme,
  };
  probe.remove();
  return colours;
}

test("theme — auto suit le réglage du système : la page est sombre quand le téléphone l'est", async () => {
  applyTheme("auto");
  const day = painted();
  expect(day.scheme).toBe("light dark");

  await emulateMedia({ colorScheme: "dark" });
  const followed = painted();
  expect(followed.sheet).not.toBe(day.sheet);
  expect(followed.card).not.toBe(day.card);
  expect(followed.ink).not.toBe(day.ink);

  // The same colours as when « Sombre » is chosen.
  applyTheme("dark");
  expect(painted()).toEqual({ ...followed, scheme: "dark" });

  // « Clair » wins over a phone in dark.
  applyTheme("light");
  expect(painted()).toEqual({ ...day, scheme: "light" });
});

test("theme — « Sombre » choisi sur un téléphone en clair", async () => {
  await emulateMedia({ colorScheme: "light" });
  applyTheme("auto");
  const day = painted();
  applyTheme("dark");
  const night = painted();
  expect(night.sheet).not.toBe(day.sheet);
  expect(night.scheme).toBe("dark");
  // The stylesheet says the same without the inline style: the attribute is enough.
  document.documentElement.style.colorScheme = "";
  expect(painted()).toEqual(night);
});

test("theme — le ciel de l'entête et des bandeaux ne change pas la nuit", async () => {
  const screen = await render(
    <header data-testid="header" className="on-dawn bg-dawn-sky text-white">
      <p data-testid="sky" className="glass text-ink">
        Navette depuis la gare
      </p>
      <a data-testid="pill" href="/x" className="bg-white text-iris-700">
        S'inscrire
      </a>
    </header>,
  );
  const look = () => {
    const header = screen.getByTestId("header").element();
    const note = screen.getByTestId("sky").element();
    const pill = screen.getByTestId("pill").element();
    return [
      getComputedStyle(header).backgroundImage,
      getComputedStyle(header).color,
      getComputedStyle(note).backgroundColor,
      getComputedStyle(note).color,
      getComputedStyle(pill).backgroundColor,
      getComputedStyle(pill).color,
    ];
  };
  applyTheme("light");
  const day = look();
  applyTheme("dark");
  expect(look()).toEqual(day);
});
