import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ElevationProfile } from "./ElevationProfile";
import { toTrack, type TrackPoint } from "./gpx";
import { TrackShape } from "./TrackShape";

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

describe("TrackShape", () => {
  test("TrackShape — un chemin, départ et arrivée, aria-label", async () => {
    const label = "Tracé du parcours : 42,2 km";
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <TrackShape points={mountain()} label={label} />
      </I18nProvider>,
    );

    // One drawing, named for a screen reader.
    const drawing = screen.getByRole("img", { name: label });
    await expect.element(drawing).toBeVisible();
    await expect.element(drawing).toHaveAttribute("viewBox");

    // One path: the track.
    const paths = screen.container.querySelectorAll("path");
    expect(paths).toHaveLength(1);
    const d = paths[0]?.getAttribute("d") ?? "";
    expect(d).toMatch(/^M[\d.]+ [\d.]+( L[\d.]+ [\d.]+)+$/);
    expect(d).not.toContain("NaN");

    // The start and the finish are marked, and said in words: the two marks
    // differ by their shape, not by their colour.
    await expect.element(screen.getByText("Départ")).toBeVisible();
    await expect.element(screen.getByText("Arrivée")).toBeVisible();
    const marks = drawing.element().querySelectorAll("circle");
    expect(marks).toHaveLength(2);
    expect(marks[0]?.getAttribute("fill")).not.toBe(marks[1]?.getAttribute("fill"));
  });

  test("TrackShape — tout reste dans le cadre, le nord en haut, sans déformer", async () => {
    // A track that goes north and a little east: the north is up (a smaller y).
    const points = toTrack([
      { lat: 45.0, lon: 6.0 },
      { lat: 45.1, lon: 6.0 },
      { lat: 45.2, lon: 6.05 },
    ]);
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <TrackShape points={points} label="Tracé" />
      </I18nProvider>,
    );
    const svg = screen.container.querySelector("svg");
    const [x0, y0, width, height] = (svg?.getAttribute("viewBox") ?? "").split(" ").map(Number);
    const coordinates = [
      ...(screen.container.querySelector("path")?.getAttribute("d") ?? "").matchAll(
        /[ML]([\d.-]+) ([\d.-]+)/g,
      ),
    ].map(([, x, y]) => [Number(x), Number(y)] as const);
    expect(coordinates).toHaveLength(3);
    for (const [x, y] of coordinates) {
      expect(x).toBeGreaterThan(x0 ?? 0);
      expect(x).toBeLessThan((x0 ?? 0) + (width ?? 0));
      expect(y).toBeGreaterThan(y0 ?? 0);
      expect(y).toBeLessThan((y0 ?? 0) + (height ?? 0));
    }
    expect(coordinates[2]?.[1]).toBeLessThan(coordinates[0]?.[1] ?? 0);
    // A degree of longitude at 45° is cos(45°) = 0.71 of one of latitude: the
    // east-west spread (0.05° of longitude) is 0.05 × 0.71 / 0.2 = 18 % of the
    // north-south one.
    const spreadX = Math.abs((coordinates[2]?.[0] ?? 0) - (coordinates[0]?.[0] ?? 0));
    const spreadY = Math.abs((coordinates[2]?.[1] ?? 0) - (coordinates[0]?.[1] ?? 0));
    expect(spreadX / spreadY).toBeGreaterThan(0.15);
    expect(spreadX / spreadY).toBeLessThan(0.2);
  });

  test("TrackShape — une trace d'un point ou sans étendue se dessine quand même", async () => {
    for (const points of [
      toTrack([{ lat: 45, lon: 6 }]),
      toTrack([
        { lat: 45, lon: 6 },
        { lat: 45, lon: 6 },
      ]),
    ]) {
      const screen = await render(
        <I18nProvider languages={["fr"]}>
          <TrackShape points={points} label="Tracé" />
        </I18nProvider>,
      );
      expect(screen.container.innerHTML).not.toContain("NaN");
      expect(screen.container.querySelectorAll("path")).toHaveLength(1);
      await screen.unmount();
    }
  });

  test("TrackShape — réduit à 1 000 points un tracé de 20 000", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <TrackShape points={mountain(20_000)} label="Tracé" />
      </I18nProvider>,
    );
    const d = screen.container.querySelector("path")?.getAttribute("d") ?? "";
    expect(d.match(/[ML]/g)?.length).toBeLessThanOrEqual(1000);
  });
});

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
