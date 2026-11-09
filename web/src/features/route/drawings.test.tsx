import { useState } from "react";
import { describe, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";
import { userEvent } from "vitest/browser";

import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { emulateMedia, resetMedia } from "../../test/media";
import { ElevationProfile } from "./ElevationProfile";
import { simplify, toTrack, type TrackPoint } from "./gpx";
import type { KmRange } from "./range";
import { SLOPE_COLORS, SLOPE_COLORS_DARK, SLOPE_FILLS, SLOPE_ZONES, type SlopeZone } from "./slope";

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

/** 5 km, a kilometer in each zone of the slope: 2, 7, 12, 20 then 30 %, a point every 100 m. */
function everyZone(): TrackPoint[] {
  const grades = [2, 7, 12, 20, 30];
  let ele = 500;
  return Array.from({ length: 51 }, (_, i) => {
    if (i > 0) ele += grades[Math.floor((i - 1) / 10)] ?? 0;
    return { lat: 45 + i / 1000, lon: 6, km: i / 10, ele };
  });
}

const COUNT = (texts: string[], unit: RegExp) => texts.filter((text) => unit.test(text)).length;

// Intl separates a number from its unit with a no-break space: tests read the
// text as it looks.
const seen = (s: string | null | undefined) => (s ?? "").replace(/\p{Zs}/gu, " ");

/** A colour "#rrggbb" as the browser gives it back from a style. */
const rgb = (hex: string) =>
  `rgb(${[1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(", ")})`;

/** The figures over the drawing: the summit's altitude, or the cursor's reading in its place. */
/** The UTF-16 codes of the first characters of a text, to see a space that is not the usual one. */
const hex = (text: string) =>
  text
    .split("")
    .slice(0, 40)
    .map((c) => c.charCodeAt(0).toString(16))
    .join(" ");

const pill = (container: HTMLElement) => seen(container.querySelector("p")?.textContent);

/**
 * Each band of the profile: the zone it is drawn for (its fill is the colour of
 * that zone in the theme, `var(--color-slope-N)`) and the colour it is painted
 * with.
 */
function paintedBands(container: Element): { zone: SlopeZone; painted: string }[] {
  return [...container.querySelectorAll<SVGElement>("g[clip-path] rect")].map((rect) => {
    const zone = SLOPE_ZONES.find((candidate) => rect.style.fill === SLOPE_FILLS[candidate]);
    if (zone === undefined) throw new Error(`a band is filled with ${rect.style.fill}`);
    return { zone, painted: getComputedStyle(rect).fill };
  });
}

/** A colour of the system (CanvasText, ButtonText…) as the browser paints it now. */
function systemColour(name: string): string {
  const probe = document.createElement("span");
  probe.style.color = name;
  document.body.append(probe);
  const colour = getComputedStyle(probe).color;
  probe.remove();
  return colour;
}

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

  test("ElevationProfile — chaque bande est peinte de la couleur de sa zone, dans la palette du jour puis dans celle de la nuit", async () => {
    // Every zone on the way, one kilometer each, not only the two ends of a wall.
    try {
      for (const [theme, palette] of [
        ["light", SLOPE_COLORS],
        ["dark", SLOPE_COLORS_DARK],
      ] as const) {
        document.documentElement.dataset.theme = theme;
        const screen = await render(
          <I18nProvider languages={["fr"]}>
            <ElevationProfile points={everyZone()} label="Profil" />
          </I18nProvider>,
        );
        await expect.element(screen.getByRole("img", { name: "Profil" })).toBeVisible();
        const drawn = paintedBands(screen.container);
        expect(new Set(drawn.map(({ zone }) => zone)), `zones (${theme})`).toEqual(
          new Set(SLOPE_ZONES),
        );
        expect(
          drawn.map(({ painted }) => painted),
          `colours (${theme})`,
        ).toEqual(drawn.map(({ zone }) => rgb(palette[zone])));
        await screen.unmount();
      }
    } finally {
      delete document.documentElement.dataset.theme;
    }
  });

  test("ElevationProfile — en couleurs forcées, la ligne, le sommet et les graduations sont dans la couleur du texte, et la légende garde ses couleurs, quel que soit le thème choisi", async () => {
    // The system paints a high contrast page in its own colours, but not an
    // SVG drawing: a line in the colour of the theme (white at night) would
    // vanish on the white page of a light high contrast theme. The legend
    // keeps the colours of the bands, which the system would otherwise wipe.
    await emulateMedia({ forcedColors: "active" });
    try {
      for (const [theme, palette] of [
        ["light", SLOPE_COLORS],
        ["dark", SLOPE_COLORS_DARK],
      ] as const) {
        document.documentElement.dataset.theme = theme;
        const screen = await render(
          <I18nProvider languages={["fr"]}>
            <ElevationProfile points={flatThenWall()} label="Profil" />
          </I18nProvider>,
        );
        await expect.element(screen.getByRole("img", { name: "Profil" })).toBeVisible();
        const text = systemColour("CanvasText");
        const line = screen.container.querySelector("path[fill=none]");
        const summit = screen.container.querySelector("circle");
        expect.soft(line && getComputedStyle(line).stroke, `the line (${theme})`).toBe(text);
        expect.soft(summit && getComputedStyle(summit).fill, `the summit (${theme})`).toBe(text);
        const labels = [...screen.container.querySelectorAll("svg text")];
        expect(labels.length).toBeGreaterThan(2);
        for (const label of labels) {
          expect.soft(getComputedStyle(label).fill, `${label.textContent} (${theme})`).toBe(text);
        }
        const legend = screen.getByText(fr.route.slope, { exact: true }).element().parentElement;
        const swatches = [...(legend?.children ?? [])]
          .slice(1)
          .map((entry) => getComputedStyle(entry.firstElementChild ?? entry).backgroundColor);
        expect
          .soft(swatches, `the legend (${theme})`)
          .toEqual(SLOPE_ZONES.map((zone) => rgb(palette[zone])));
        await screen.unmount();
      }
    } finally {
      delete document.documentElement.dataset.theme;
      await resetMedia();
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

    // Positions that are not round, all on the flat (it ends at 2 km; the slope is read over 75 m
    // on each side), put on the range the same way in every engine (an arrow moves it by a step
    // that is not the same everywhere: Firefox's runs along the wall). What a screen reader
    // hears, then what the pill shows.
    const input = cursor.element();
    if (!(input instanceof HTMLInputElement)) throw new Error("not an input");
    const valueProperty = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
    const readings: string[] = [];
    for (let step = 0; step < 60; step++) {
      const km = ((step + 0.37) / 60) * 1.9;
      valueProperty?.set?.call(input, String(km));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      // The reading is the one of this position (it shows one decimal).
      await vi.waitFor(() => {
        const said = Number.parseFloat(
          seen(input.getAttribute("aria-valuetext")).replace(",", "."),
        );
        expect(Math.abs(said - km)).toBeLessThanOrEqual(0.06);
      });
      readings.push(`${seen(input.getAttribute("aria-valuetext"))} | ${pill(screen.container)}`);
    }
    // The first offending readings are in the message: what an engine writes is what is wanted.
    const negative = readings.filter((reading) => /[-−]\s*0/.test(reading));
    expect(
      negative.length,
      `${negative.length} readings with a minus zero: ${JSON.stringify(negative.slice(0, 1))}`,
    ).toBe(0);
    const other = readings.filter((reading) => !/pente 0 % \| .* · 0 %$/.test(reading));
    expect(
      other.length,
      `${other.length} readings not « pente 0 % | … · 0 % »: ${JSON.stringify(other.slice(0, 1))} codes ${hex(other[0] ?? "")}`,
    ).toBe(0);
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

  test("ElevationProfile — un téléphone et un grand écran lisent la même pente : elle ne dépend pas de la largeur du dessin", async () => {
    // 30 km on the flat, then a last climb of 400 m at 20 %: a point every 100 m.
    const track: TrackPoint[] = Array.from({ length: 305 }, (_, i) => ({
      lat: 45 + i / 1000,
      lon: 6,
      km: i / 10,
      ele: i <= 300 ? 500 : 500 + (i - 300) * 20,
    }));
    const screen = await render(
      <I18nProvider languages={["fr"]}>
        <div data-testid="phone" style={{ width: 320 }}>
          <ElevationProfile points={track} label="Profil" />
        </div>
        <div data-testid="wide" style={{ width: 900 }}>
          <ElevationProfile points={track} label="Profil" />
        </div>
      </I18nProvider>,
    );
    /** At the finish (End), what the cursor says, and the zone of the last band. */
    const atFinish = async (id: string) => {
      const box = screen.getByTestId(id);
      const cursor = box.getByRole("slider", { name: fr.route.profileCursor });
      await userEvent.click(cursor);
      await userEvent.keyboard("{End}");
      return {
        reading: seen(cursor.element().getAttribute("aria-valuetext")),
        lastZone: paintedBands(box.element()).at(-1)?.zone,
      };
    };
    const phone = await atFinish("phone");
    const wide = await atFinish("wide");
    expect(phone).toEqual(wide);
    expect(phone).toEqual({ reading: "30,4 km, altitude 580 m, pente 20 %", lastZone: 4 });
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

// Zooming on a portion of the profile.

/** The zone under the cursor at a kilometer, with the portion given. */
async function zoneAt(km: number, range: KmRange | null): Promise<SlopeZone | null> {
  const zones: (SlopeZone | null)[] = [];
  function Probe() {
    const [last, setLast] = useState<SlopeZone | null>(null);
    zones.push(last);
    return (
      <ElevationProfile
        points={everyZone()}
        label="Profil"
        range={range}
        cursorKm={km}
        onCursorZone={setLast}
      />
    );
  }
  await render(
    <I18nProvider languages={["fr"]}>
      <Probe />
    </I18nProvider>,
  );
  await expect.poll(() => zones.at(-1)).not.toBeNull();
  return zones.at(-1) ?? null;
}

/** How many points the line of the profile goes through. */
const pathPoints = (container: Element) =>
  (container.querySelector(".profile-line")?.getAttribute("d") ?? "").split(/[ML]/).length - 1;
/** A pointer event on an element, as a mouse, a pen or a finger sends it. */
function pointer(
  element: Element,
  type: "pointerdown" | "pointermove" | "pointerup" | "pointercancel",
  x: number,
  { id = 1, kind = "mouse" }: { id?: number; kind?: "mouse" | "touch" | "pen" } = {},
) {
  element.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: x,
      clientY: 80,
      pointerId: id,
      pointerType: kind,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      isPrimary: true,
    }),
  );
}

type OnRange = ReturnType<typeof vi.fn<(range: KmRange | null) => void>>;

/** The profile of a track; it keeps its portion itself (unless `range` is given) and tells where it goes. */
async function renderZoom(points: TrackPoint[], props: { range?: KmRange | null } = {}) {
  const onRange: OnRange = vi.fn<(range: KmRange | null) => void>();
  const screen = await render(
    <I18nProvider languages={["fr"]}>
      <ElevationProfile points={points} label="Profil" onRange={onRange} {...props} />
    </I18nProvider>,
  );
  const cursor = screen.getByRole("slider", { name: fr.route.profileCursor });
  /** The x of a fraction of the cursor's box. */
  const at = (fraction: number) => {
    const rect = cursor.element().getBoundingClientRect();
    return rect.left + rect.width * fraction;
  };
  return { screen, onRange, cursor, at };
}

const button = (screen: Awaited<ReturnType<typeof render>>, name: string) =>
  screen.getByRole("button", { name });

const lastRange = (spy: OnRange) => spy.mock.calls.at(-1)?.[0];
const lengthOf = (range: KmRange | null | undefined) => (range ? range.to - range.from : NaN);

test("ElevationProfile — glisser choisit une portion", async () => {
  const { screen, onRange, cursor, at } = await renderZoom(mountain());
  const slider = cursor.element();
  const lastKm = mountain().at(-1)?.km ?? 0;

  pointer(slider, "pointerdown", at(0.25));
  pointer(slider, "pointermove", at(0.5));
  // The band is drawn while the pointer is down, in the colour of the theme.
  await expect.poll(() => screen.container.querySelector(".profile-selection")).not.toBeNull();
  const band = screen.container.querySelector<SVGRectElement>(".profile-selection");
  // The fill is the theme's (a class, so that forced colours can take it over).
  expect(band && getComputedStyle(band).fill).not.toBe("rgb(0, 0, 0)");
  expect(band?.getAttribute("style")).toBeNull();
  expect(onRange).not.toHaveBeenCalled();

  pointer(slider, "pointerup", at(0.5));
  await expect.poll(() => onRange.mock.calls.length).toBe(1);
  const chosen = lastRange(onRange);
  expect(Math.abs((chosen?.from ?? 0) - lastKm * 0.25)).toBeLessThan(1.2);
  expect(Math.abs((chosen?.to ?? 0) - lastKm * 0.5)).toBeLessThan(1.2);
  // The band goes, the profile is limited to the portion and says it.
  await expect.poll(() => screen.container.querySelector(".profile-selection")).toBeNull();
  await expect
    .poll(() => seen(screen.container.querySelector("output")?.textContent))
    .toMatch(/^Du km \d+,\d au km \d+,\d$/);
  const words = seen(screen.container.querySelector("output")?.textContent);
  await expect
    .element(screen.getByRole("img", { name: new RegExp(`^Profil, ${words}$`) }))
    .toBeVisible();
  // The graduations are the portion's: none beyond it.
  const kilometers = [...screen.container.querySelectorAll("text")]
    .map((text) => seen(text.textContent))
    .filter((text) => /\skm$/.test(text))
    .map((text) => Number.parseFloat(text.replace(",", ".")));
  expect(kilometers.length).toBeGreaterThan(0);
  for (const km of kilometers) {
    expect(km).toBeGreaterThanOrEqual((chosen?.from ?? 0) - 0.01);
    expect(km).toBeLessThanOrEqual((chosen?.to ?? 0) + 0.01);
  }
});

test("ElevationProfile — un clic sans glisser place le curseur", async () => {
  const { screen, onRange, cursor, at } = await renderZoom(flatThenWall());
  const slider = cursor.element();
  pointer(slider, "pointerdown", at(0.5));
  pointer(slider, "pointerup", at(0.5));
  await expect.poll(() => pill(screen.container)).toBe("1,5 km · 500 m · 0 %");
  expect(onRange).not.toHaveBeenCalled();
  await expect.poll(() => screen.container.querySelector(".profile-selection")).toBeNull();
});

test("ElevationProfile — une portion trop courte ne zoome pas", async () => {
  // 40 km: 5 px are long enough for 200 m but not for 8 px.
  const long = await renderZoom(mountain());
  pointer(long.cursor.element(), "pointerdown", long.at(0.4));
  pointer(long.cursor.element(), "pointermove", long.at(0.4) + 5);
  pointer(long.cursor.element(), "pointerup", long.at(0.4) + 5);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(long.onRange).not.toHaveBeenCalled();
  await long.screen.unmount();
  // 5 km: more than 8 px, but 150 m.
  const short = await renderZoom(everyZone());
  const dx = (0.15 / 5) * short.cursor.element().getBoundingClientRect().width;
  pointer(short.cursor.element(), "pointerdown", short.at(0.4));
  pointer(short.cursor.element(), "pointermove", short.at(0.4) + dx);
  pointer(short.cursor.element(), "pointerup", short.at(0.4) + dx);
  // A mouse that is cancelled (the browser took the gesture) chooses nothing either.
  pointer(short.cursor.element(), "pointerdown", short.at(0.1));
  pointer(short.cursor.element(), "pointermove", short.at(0.9));
  pointer(short.cursor.element(), "pointercancel", short.at(0.9));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(short.onRange).not.toHaveBeenCalled();
});

test("ElevationProfile — pincer zoome", async () => {
  const { screen, onRange, cursor, at } = await renderZoom(mountain());
  const slider = cursor.element();
  const lastKm = mountain().at(-1)?.km ?? 0;
  // Two fingers 20 % of the profile apart, which spread to 40 %: twice shorter.
  pointer(slider, "pointerdown", at(0.4), { id: 1, kind: "touch" });
  pointer(slider, "pointerdown", at(0.6), { id: 2, kind: "touch" });
  pointer(slider, "pointermove", at(0.3), { id: 1, kind: "touch" });
  pointer(slider, "pointermove", at(0.7), { id: 2, kind: "touch" });
  await expect.poll(() => onRange.mock.calls.length).toBeGreaterThan(0);
  const zoomed = lastRange(onRange);
  expect(lengthOf(zoomed)).toBeGreaterThan(lastKm * 0.4);
  expect(lengthOf(zoomed)).toBeLessThan(lastKm * 0.6);
  // Around the middle of the fingers (the middle of the track).
  const middle = ((zoomed?.from ?? 0) + (zoomed?.to ?? 0)) / 2;
  expect(middle).toBeGreaterThan(lastKm * 0.4);
  expect(middle).toBeLessThan(lastKm * 0.6);
  pointer(slider, "pointerup", at(0.3), { id: 1, kind: "touch" });
  pointer(slider, "pointerup", at(0.7), { id: 2, kind: "touch" });
  expect(screen.container.querySelector(".profile-selection")).toBeNull();

  // Fingers that draw together zoom out.
  const calls = onRange.mock.calls.length;
  pointer(slider, "pointerdown", at(0.3), { id: 3, kind: "touch" });
  pointer(slider, "pointerdown", at(0.7), { id: 4, kind: "touch" });
  pointer(slider, "pointermove", at(0.4), { id: 3, kind: "touch" });
  pointer(slider, "pointermove", at(0.6), { id: 4, kind: "touch" });
  await expect.poll(() => onRange.mock.calls.length).toBeGreaterThan(calls);
  const out = lastRange(onRange);
  expect(out === null || lengthOf(out) > lengthOf(zoomed)).toBe(true);
});

test("ElevationProfile — les boutons Zoomer, Dézoomer et Vue entière", async () => {
  const { screen, onRange } = await renderZoom(mountain());
  const zoomIn = button(screen, fr.route.zoomProfileInLabel);
  const zoomOut = button(screen, fr.route.zoomProfileOutLabel);
  const whole = button(screen, fr.route.zoomProfileAllLabel);
  const lastKm = mountain().at(-1)?.km ?? 0;

  // On the whole profile there is nothing to zoom out of.
  await expect.element(zoomIn).not.toHaveAttribute("aria-disabled");
  await expect.element(zoomOut).toHaveAttribute("aria-disabled", "true");
  await expect.element(whole).toHaveAttribute("aria-disabled", "true");
  // A tap on a button that says it is off does nothing (the driver would wait for it to be enabled).
  zoomOut.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  whole.element().dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(onRange).not.toHaveBeenCalled();
  // They are tap targets.
  for (const target of [zoomIn, zoomOut, whole]) {
    expect(target.element().getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  }

  await zoomIn.click();
  expect(lengthOf(lastRange(onRange))).toBeCloseTo(lastKm / 2, 6);
  await expect.element(zoomOut).not.toHaveAttribute("aria-disabled");
  await expect.element(whole).not.toHaveAttribute("aria-disabled");
  await zoomIn.click();
  expect(lengthOf(lastRange(onRange)) * 4).toBeCloseTo(lastKm, 6);
  await zoomOut.click();
  expect(lengthOf(lastRange(onRange)) * 2).toBeCloseTo(lastKm, 6);
  await whole.click();
  expect(lastRange(onRange)).toBeNull();
  await expect.element(whole).toHaveAttribute("aria-disabled", "true");
  // The reset is said (the live region is throttled: a moment after the last change).
  await expect
    .poll(() => screen.container.querySelector("output")?.textContent, { timeout: 2000 })
    .toBe(fr.route.profileWhole);
});

test("ElevationProfile — la portion n'est pas dite à chaque pas d'un geste", async () => {
  const { screen, cursor } = await renderZoom(mountain());
  const output = screen.container.querySelector("output");
  const said: string[] = [];
  const watch = new MutationObserver(() => said.push(output?.textContent ?? ""));
  if (output) watch.observe(output, { childList: true, characterData: true, subtree: true });
  // Five zooms in a row, as fast as a pinch moves.
  cursor.element().focus();
  for (let i = 0; i < 5; i++) {
    cursor
      .element()
      .dispatchEvent(new KeyboardEvent("keydown", { key: i % 2 ? "+" : "-", bubbles: true }));
    cursor.element().dispatchEvent(new KeyboardEvent("keydown", { key: "+", bubbles: true }));
  }
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(said.length).toBeLessThanOrEqual(2);
  // The last portion is said in the end.
  await expect.poll(() => output?.textContent, { timeout: 2000 }).toMatch(/^Du km /);
  watch.disconnect();
});

test("ElevationProfile — la bande, en couleurs forcées, n'a que son contour, dans la couleur du texte", async () => {
  await emulateMedia({ forcedColors: "active" });
  try {
    const { screen, cursor, at } = await renderZoom(mountain());
    pointer(cursor.element(), "pointerdown", at(0.25));
    pointer(cursor.element(), "pointermove", at(0.5));
    await expect.poll(() => screen.container.querySelector(".profile-selection")).not.toBeNull();
    const band = screen.container.querySelector(".profile-selection");
    if (!band) throw new Error("no band");
    const style = getComputedStyle(band);
    expect(style.stroke).toBe(systemColour("CanvasText"));
    expect(style.fill).toBe("rgba(0, 0, 0, 0)");
  } finally {
    await resetMedia();
  }
});

test("ElevationProfile — les touches + et −", async () => {
  const { onRange, cursor } = await renderZoom(mountain());
  const lastKm = mountain().at(-1)?.km ?? 0;
  await userEvent.tab();
  expect(document.activeElement).toBe(cursor.element());
  await userEvent.keyboard("+");
  // Around the cursor, which is at the start: the portion starts there too.
  expect(lengthOf(lastRange(onRange))).toBeCloseTo(lastKm / 2, 6);
  expect(lastRange(onRange)?.from).toBeCloseTo(0, 6);
  await userEvent.keyboard("-");
  expect(lastRange(onRange)).toBeNull();
  // The true minus sign too (a keyboard can type it).
  await userEvent.keyboard("+");
  cursor.element().dispatchEvent(new KeyboardEvent("keydown", { key: "−", bubbles: true }));
  await expect.poll(() => lastRange(onRange)).toBeNull();
  // The keys that were already there keep their role.
  await userEvent.keyboard("{End}");
  expect(seen(cursor.element().getAttribute("aria-valuetext"))).toMatch(/^41,4 km/);
});

test("ElevationProfile — la portion est dite : « Du km 12,4 au km 18,0 »", async () => {
  const { screen } = await renderZoom(mountain(), { range: { from: 12.4, to: 18 } });
  expect(seen(screen.container.querySelector("output")?.textContent)).toBe("Du km 12,4 au km 18,0");
  await expect
    .element(screen.getByRole("img", { name: "Profil, Du km 12,4 au km 18,0" }))
    .toBeVisible();
  // The cursor stays in the portion.
  const slider = screen.getByRole("slider", { name: fr.route.profileCursor }).element();
  if (!(slider instanceof HTMLInputElement)) throw new Error("the cursor is not a range");
  expect(Number(slider.min)).toBeGreaterThan(12);
  expect(Number(slider.max)).toBeLessThan(18.6);
});

/** 42 km flat at 500 m, a point every 15 m, with one ramp of 150 m at 20 % at km 20. */
function flatWithARamp(): TrackPoint[] {
  return Array.from({ length: 2801 }, (_, i) => {
    const km = (i * 15) / 1000;
    const ele = 500 + 200 * Math.min(0.15, Math.max(0, km - 20));
    return { lat: 45 + km / 111, lon: 6, km, ele };
  });
}

/** The zones of the bands drawn, from the first to the last, as the painted bands say them. */
const zonesDrawn = (container: Element) => paintedBands(container).map((band) => band.zone);

test("ElevationProfile — zoomé sur une rampe de 150 m à 20 %, la bande ≥ 15 % apparaît", async () => {
  const track = flatWithARamp();
  // Whole: a slope is read over 846 m, which turns the ramp into 3,5 %.
  const whole = await renderZoom(track);
  expect(Math.max(...zonesDrawn(whole.screen.container))).toBe(1);
  // Zoomed on it, the slope is read over 50 m: the ramp has its own colour.
  const zoomed = await renderZoom(track, { range: { from: 19.9, to: 20.3 } });
  expect(zonesDrawn(zoomed.screen.container)).toContain(4);
  expect(zonesDrawn(zoomed.screen.container)).toContain(1);
});

test("ElevationProfile — sur une trace de 5 km, la vue entière lit la pente sur 75 m de chaque côté, comme avant", async () => {
  // 5 km flat, a point every 5 m, with a ramp of 60 m at 20 % in the middle (12 m up).
  const track: TrackPoint[] = Array.from({ length: 1001 }, (_, i) => {
    const km = i / 200;
    const ele = 500 + 200 * Math.min(0.06, Math.max(0, km - 2.47));
    return { lat: 45 + km / 111, lon: 6, km, ele };
  });
  // Whole: read over 150 m, the 12 m make 8 % at most (5–10 %, zone 2). Read over
  // 100 m, as the 25 m floor alone would, they would make 12 % (zone 3).
  const whole = await renderZoom(track);
  expect(Math.max(...zonesDrawn(whole.screen.container))).toBe(2);
  // Zoomed on it, the slope is read over 50 m, and the ramp is steeper.
  const zoomed = await renderZoom(track, { range: { from: 2.3, to: 2.7 } });
  expect(Math.max(...zonesDrawn(zoomed.screen.container))).toBeGreaterThanOrEqual(4);
});

test("ElevationProfile — la couleur de la vue entière est celle d'une pente lue sur 1 % de la trace", async () => {
  // A kilometer in each zone, a point every 100 m: the middle of each, whole.
  for (const [i, km] of [0.5, 1.5, 2.5, 3.5, 4.5].entries()) {
    expect(await zoneAt(km, null)).toBe(SLOPE_ZONES[i]);
  }
  // And zoomed on a few hundred meters, a kilometer of one slope keeps its colour.
  for (const [i, km] of [0.5, 1.5, 2.5, 3.5, 4.5].entries()) {
    expect(await zoneAt(km, { from: km - 0.4, to: km + 0.4 })).toBe(SLOPE_ZONES[i]);
  }
});

test("ElevationProfile — Ctrl + molette zoome autour du pointeur, la molette seule ne fait rien", async () => {
  const { onRange, cursor, at } = await renderZoom(mountain());
  const lastKm = mountain().at(-1)?.km ?? 0;
  const wheel = (init: WheelEventInit) => {
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientY: 80,
      ...init,
    });
    cursor.element().dispatchEvent(event);
    return event;
  };

  // The wheel alone belongs to the page: it scrolls it.
  const plain = wheel({ deltaY: -100, clientX: at(0.75) });
  expect(plain.defaultPrevented).toBe(false);
  expect(onRange).not.toHaveBeenCalled();

  // Ctrl + wheel up: the step of the buttons, around the pointer, and not the page.
  const zoomIn = wheel({ deltaY: -100, ctrlKey: true, clientX: at(0.75) });
  expect(zoomIn.defaultPrevented).toBe(true);
  const zoomed = lastRange(onRange);
  expect(lengthOf(zoomed)).toBeCloseTo(lastKm / 2, 6);
  // The kilometer under the pointer stays at the same place of the portion.
  const under = (zoomed?.from ?? 0) + lengthOf(zoomed) * 0.75;
  expect(Math.abs(under - lastKm * 0.75)).toBeLessThan(lastKm * 0.03);

  // The ⌘ key does the same, and wheel down zooms out (after the pause between two steps).
  await new Promise((resolve) => setTimeout(resolve, 200));
  const zoomOut = wheel({ deltaY: 100, metaKey: true, clientX: at(0.75) });
  expect(zoomOut.defaultPrevented).toBe(true);
  expect(lastRange(onRange)).toBeNull();

  // On the whole track there is nothing to zoom out of, and the page is still not zoomed.
  await new Promise((resolve) => setTimeout(resolve, 200));
  const nothing = wheel({ deltaY: 100, ctrlKey: true, clientX: at(0.5) });
  expect(nothing.defaultPrevented).toBe(true);
  expect(lastRange(onRange)).toBeNull();
});

test("ElevationProfile — zoomé, le détail de la trace apparaît", async () => {
  // 20 000 points over about 40 km: the whole track is drawn with 1 000 of them.
  const dense = mountain(20_000);
  const range = { from: 10, to: 14 };
  const whole = await renderZoom(dense);
  expect(pathPoints(whole.screen.container)).toBeLessThanOrEqual(1000);
  const zoomed = await renderZoom(dense, { range });
  const inPortion = simplify(dense).filter((p) => p.km >= range.from && p.km <= range.to);
  expect(pathPoints(zoomed.screen.container)).toBeGreaterThan(inPortion.length * 3);
  expect(pathPoints(zoomed.screen.container)).toBeLessThanOrEqual(1000);
  expect(zoomed.screen.container.innerHTML).not.toContain("NaN");
});

test("ElevationProfile — dans Safari, un clic donne le focus au curseur, qui ne le prend pas à l'appui", async () => {
  const { cursor } = await renderZoom(mountain());
  // Safari does not focus a range that is clicked: Chromium does, unless the press is cancelled.
  cursor.element().addEventListener("mousedown", (event) => {
    event.preventDefault();
  });

  await userEvent.click(cursor);

  expect(document.activeElement).toBe(cursor.element());
});
