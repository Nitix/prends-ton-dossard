import { describe, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ElevationProfile } from "./ElevationProfile";
import { toTrack, type TrackPoint } from "./gpx";
import { SLOPE_COLORS, SLOPE_COLORS_DARK, SLOPE_ZONES } from "./slope";

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

/** 2 km flat at 500 m, then a wall: 1 km that climbs to 800 m (30 %), a point every 100 m. */
function flatThenWall(): TrackPoint[] {
  return Array.from({ length: 31 }, (_, i) => ({
    lat: 45 + i / 1000,
    lon: 6,
    km: i / 10,
    ele: i <= 20 ? 500 : 500 + (i - 20) * 30,
  }));
}

const COUNT = (texts: string[], unit: RegExp) => texts.filter((text) => unit.test(text)).length;

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const seen = (s: string | null | undefined) => (s ?? "").replace(/\p{Zs}/gu, " ");

/** A colour "#rrggbb" as the browser gives it back from a style. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

/** The figures over the drawing: the summit's altitude, or the cursor's reading in its place. */
const pill = (container: HTMLElement) => seen(container.querySelector("p")?.textContent);

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

  test("ElevationProfile — la pente colore les bandes, et la légende dit chaque couleur en mots", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatThenWall()} label="Profil" />
      </I18nProvider>,
    );
    await expect.element(screen.getByRole("img", { name: "Profil" })).toBeVisible();

    // Flat, then a wall: the first band is in the gentlest zone, the last in the steepest
    // (the colour as the band is painted: it comes from the theme).
    const fills = [...screen.container.querySelectorAll("g[clip-path] rect")].map(
      (rect) => getComputedStyle(rect).fill,
    );
    expect(fills.at(0)).toBe(rgb(SLOPE_COLORS[1]));
    expect(fills.at(-1)).toBe(rgb(SLOPE_COLORS[5]));

    // The legend: each colour of the bands, in order, with what it means.
    const legend = screen.getByText(fr.route.slope, { exact: true }).element().parentElement;
    const entries = [...(legend?.children ?? [])].slice(1);
    expect(entries.map((entry) => seen(entry.textContent))).toEqual([
      "< 5 %",
      "5–10 %",
      "10–15 %",
      "15–25 %",
      "≥ 25 %",
    ]);
    expect(
      entries.map((entry) => getComputedStyle(entry.firstElementChild ?? entry).backgroundColor),
    ).toEqual(SLOPE_ZONES.map((zone) => rgb(SLOPE_COLORS[zone])));
  });

  test("ElevationProfile — la nuit, les bandes et la légende prennent les couleurs de la nuit, la ligne est blanche", async () => {
    document.documentElement.dataset.theme = "dark";
    try {
      const screen = await render(
        <I18nProvider languages={["fr"]}>
          <ElevationProfile points={flatThenWall()} label="Profil" />
        </I18nProvider>,
      );
      await expect.element(screen.getByRole("img", { name: "Profil" })).toBeVisible();
      const fills = [...screen.container.querySelectorAll("g[clip-path] rect")].map(
        (rect) => getComputedStyle(rect).fill,
      );
      expect(fills.at(0)).toBe(rgb(SLOPE_COLORS_DARK[1]));
      expect(fills.at(-1)).toBe(rgb(SLOPE_COLORS_DARK[5]));
      const line = screen.container.querySelector("path[fill=none]");
      expect(line && getComputedStyle(line).stroke).toBe("rgb(255, 255, 255)");
      const legend = screen.getByText(fr.route.slope, { exact: true }).element().parentElement;
      const swatches = [...(legend?.children ?? [])]
        .slice(1)
        .map((entry) => getComputedStyle(entry.firstElementChild ?? entry).backgroundColor);
      expect(swatches).toEqual(SLOPE_ZONES.map((zone) => rgb(SLOPE_COLORS_DARK[zone])));
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  test("ElevationProfile — les aplats de pente sont pleins : la couleur dessinée est celle qui a 3:1 sur la carte", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatThenWall()} label="Profil" />
      </I18nProvider>,
    );
    // A band drawn at 85 % would be paler than the colour of its zone, and the
    // 3:1 measured on that colour would not be the one the eye gets.
    const bands = [...screen.container.querySelectorAll("g[clip-path] rect")];
    expect(bands.length).toBeGreaterThan(0);
    for (const band of bands) {
      for (
        let node: Element | null = band;
        node && node !== screen.container;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        expect(style.opacity).toBe("1");
        expect(style.fillOpacity).toBe("1");
      }
    }
  });

  test("ElevationProfile — au clavier, le curseur dit la distance, l'altitude et la pente", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatThenWall()} label="Profil" />
      </I18nProvider>,
    );
    const cursor = screen.getByRole("slider", { name: fr.route.profileCursor });
    const reading = () => seen(cursor.element().getAttribute("aria-valuetext"));
    // Before the cursor, the summit is named over the drawing.
    expect(pill(screen.container)).toBe("800 m");

    // Tab reaches it, with a ring to show it (drawn, wide and coloured); it starts at the start.
    await userEvent.tab();
    expect(document.activeElement).toBe(cursor.element());
    const ring = getComputedStyle(cursor.element());
    expect(ring.outlineStyle).not.toBe("none");
    expect(Number.parseFloat(ring.outlineWidth)).toBeGreaterThan(0);
    expect(ring.outlineColor).not.toMatch(/^(transparent|rgba\(.*,\s*0\))$/);
    expect(reading()).toBe("0 km, altitude 500 m, pente 0 %");
    expect(pill(screen.container)).toBe("0 km · 500 m · 0 %");

    // End goes to the finish, at the top of the wall; Home back to the start.
    await userEvent.keyboard("{End}");
    expect(reading()).toBe("3 km, altitude 800 m, pente 30 %");
    expect(pill(screen.container)).toBe("3 km · 800 m · 30 %");
    await userEvent.keyboard("{Home}");
    expect(reading()).toBe("0 km, altitude 500 m, pente 0 %");

    // Escape puts the cursor away: the summit is named again, the focus stays.
    await userEvent.keyboard("{End}{Escape}");
    expect(pill(screen.container)).toBe("800 m");
    expect(document.activeElement).toBe(cursor.element());
  });

  test("ElevationProfile — sur le plat, le curseur dit « pente 0 % », jamais « -0 % »", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatThenWall()} label="Profil" />
      </I18nProvider>,
    );
    const cursor = screen.getByRole("slider", { name: fr.route.profileCursor });
    await userEvent.tab();

    // An arrow moves the cursor by a hundredth of the range: positions that are
    // not round, all on the flat (it ends at 2 km; the slope is read over 75 m
    // on each side). What a screen reader hears, then what the pill shows.
    const readings: string[] = [];
    for (let step = 0; step < 60; step++) {
      await userEvent.keyboard("{ArrowRight}");
      readings.push(
        `${seen(cursor.element().getAttribute("aria-valuetext"))} | ${pill(screen.container)}`,
      );
    }
    expect(readings.filter((reading) => /[-−]\s*0/.test(reading))).toEqual([]);
    expect(readings.filter((reading) => !/pente 0 % \| .* · 0 %$/.test(reading))).toEqual([]);
    // The cursor did go along the flat.
    expect(Number.parseFloat(readings.at(-1)?.replace(",", ".") ?? "")).toBeGreaterThan(1.5);
  });

  test("ElevationProfile — le curseur suit le pointeur, et s'en va avec lui", async () => {
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <ElevationProfile points={flatThenWall()} label="Profil" />
      </I18nProvider>,
    );
    const cursor = screen.getByRole("slider", { name: fr.route.profileCursor });

    // The middle of the range is the middle of the track: 1.5 km, still on the flat.
    await userEvent.hover(cursor);
    expect(pill(screen.container)).toBe("1,5 km · 500 m · 0 %");

    await userEvent.unhover(cursor);
    expect(pill(screen.container)).toBe("800 m");
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
