import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ElevationProfile } from "./ElevationProfile";
import { toTrack, type TrackPoint } from "./gpx";

// The colours are classes of Tailwind, which the styles load.
import "../../styles.css";

/** A winding track of n points that climbs from 450 m to 750 m and goes back down, about 40 km. */
function mountain(n = 400): TrackPoint[] {
  return toTrack(
    Array.from({ length: n }, (_, i) => {
      const progress = i / (n - 1);
      return {
        lat: 45.9 + 0.2 * progress,
        lon: 6.1 + 0.3 * progress + 0.02 * Math.sin(progress * 30),
        ele: 450 + 300 * Math.sin(Math.PI * progress),
      };
    }),
  );
}

/** The same, with no altitude. */
function flatMap(): TrackPoint[] {
  return mountain().map(({ ele: _ele, ...point }) => point);
}

const COUNT = (texts: string[], unit: RegExp) => texts.filter((text) => unit.test(text)).length;

describe("ElevationProfile", () => {
  test("ElevationProfile — graduations et aria-label", async () => {
    const label = "Profil de dénivelé : 450 à 750 m";
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={mountain()} label={label} />
      </I18nProvider>,
    );

    const drawing = screen.getByRole("img", { name: label });
    await expect.element(drawing).toBeVisible();

    // The area under the curve and the curve: two paths.
    const paths = screen.container.querySelectorAll("path");
    expect(paths).toHaveLength(2);
    for (const path of paths) expect(path.getAttribute("d")).not.toContain("NaN");

    // 4 to 6 graduations in kilometers, 3 to 5 in meters, written in French.
    const texts = [...screen.container.querySelectorAll("text")].map((t) => t.textContent ?? "");
    const kilometers = COUNT(texts, /\skm$/);
    const meters = COUNT(texts, /\sm$/);
    expect(kilometers).toBeGreaterThanOrEqual(4);
    expect(kilometers).toBeLessThanOrEqual(6);
    expect(meters).toBeGreaterThanOrEqual(3);
    expect(meters).toBeLessThanOrEqual(5);
    expect(texts).toHaveLength(kilometers + meters);
    // Round numbers: the altitudes go from 450 to 750 m, the scale from 400 to 800 m.
    expect(texts.some((text) => /^0\skm$/.test(text))).toBe(true);
    expect(texts.some((text) => /^400\sm$/.test(text))).toBe(true);
    expect(texts.some((text) => /^800\sm$/.test(text))).toBe(true);
  });

  test("ElevationProfile — les graduations suivent la langue", async () => {
    const screen = await render(
      <I18nProvider languages={["en-GB"]}>
        <ElevationProfile points={mountain()} label="Elevation profile" />
      </I18nProvider>,
    );
    const texts = [...screen.container.querySelectorAll("text")].map((t) => t.textContent ?? "");
    // English formatting has no space before the unit.
    expect(texts).toContain("800 m");
    expect(texts.some((text) => /^\d+(\.\d)? km$/.test(text))).toBe(true);
  });

  test("ElevationProfile — rien sans altitude", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatMap()} label="Profil" />
      </I18nProvider>,
    );
    expect(screen.container.querySelector("svg")).toBeNull();
    expect(screen.container.querySelector("[role=img]")).toBeNull();
    expect(screen.container.textContent).toBe("");
  });

  test("ElevationProfile — rien d'une trace sans longueur", async () => {
    const stuck = toTrack([
      { lat: 45, lon: 6, ele: 100 },
      { lat: 45, lon: 6, ele: 120 },
    ]);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={stuck} label="Profil" />
      </I18nProvider>,
    );
    expect(screen.container.querySelector("svg")).toBeNull();
  });

  test("ElevationProfile — une trace plate se dessine, sans NaN", async () => {
    const plain = toTrack(
      Array.from({ length: 50 }, (_, i) => ({ lat: 45 + i / 1000, lon: 6, ele: 200 })),
    );
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={plain} label="Profil" />
      </I18nProvider>,
    );
    expect(screen.container.querySelector("svg")).not.toBeNull();
    expect(screen.container.innerHTML).not.toContain("NaN");
  });

  test("ElevationProfile — des altitudes absurdes ne bloquent pas le dessin", async () => {
    // Not what a file read by parseGpx can give, but what a caller could pass.
    const absurd = toTrack([
      { lat: 45, lon: 6, ele: -1e308 },
      { lat: 45.01, lon: 6, ele: 1e308 },
      { lat: 45.02, lon: 6, ele: 0 },
    ]);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={absurd} label="Profil" />
      </I18nProvider>,
    );
    expect(screen.container.querySelector("svg")).not.toBeNull();
    expect(screen.container.innerHTML).not.toMatch(/NaN|Infinity/);
  });

  test("ElevationProfile — des points sans altitude parmi d'autres sont passés", async () => {
    const mixed = mountain(100).map((point, i) => {
      if (i % 3 !== 0) return point;
      const { ele: _ele, ...withoutAltitude } = point;
      return withoutAltitude;
    });
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={mixed} label="Profil" />
      </I18nProvider>,
    );
    expect(screen.container.querySelectorAll("path")).toHaveLength(2);
    expect(screen.container.innerHTML).not.toContain("NaN");
  });
});
