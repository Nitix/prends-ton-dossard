import { afterEach, beforeEach, expect, test } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "vitest/browser";

import { SKINS, chooseSkin } from "..";
import { chooseAmbient } from "../../lib/ambient";
import { FRAME } from "../../test/frame";
import { emulateMedia, resetMedia } from "../../test/media";
import { isLinuxWebkit } from "../../test/support";
import { HeaderArt, HeroArt, PageArt } from "./motifs";

import "../../styles.css";

// « Carnet »'s background moves, slowly, as the logbook's did in the v4: the
// patches where its sheet of dots fades out and comes back in, the orbits of
// the data that turn (one ring the other way), a dot that pulses. It is
// decoration (the motifs say nothing to a screen reader: components.test.tsx),
// it only moves for whoever has not asked for less motion, and a person can
// turn it off (« Animer le fond »: lib/ambient.ts).

beforeEach(async () => {
  // The look of the skin: its sheets (motion.css among them) are in the page.
  await chooseSkin("carnet");
});

afterEach(async () => {
  chooseAmbient(true);
  await chooseSkin("crete");
  await resetMedia();
});

/** The middle of an element's box on the screen. */
const middle = (element: Element) => {
  const box = element.getBoundingClientRect();
  return [box.left + box.width / 2, box.top + box.height / 2] as const;
};

/** An animation of CSS: it has a name. (Not `instanceof CSSAnimation`: Playwright's WebKit on Linux has no such global.) */
const isCssAnimation = (animation: Animation): animation is CSSAnimation =>
  "animationName" in animation;

/** What moves in a drawing: its animations of CSS, by name, with how they run. */
function moving(root: Element) {
  return root
    .getAnimations({ subtree: true })
    .filter(isCssAnimation)
    .map((animation) => {
      const timing = animation.effect?.getComputedTiming();
      return {
        name: animation.animationName,
        duration: Number(timing?.duration),
        iterations: timing?.iterations,
        direction: timing?.direction,
        delay: timing?.delay,
      };
    });
}

const names = (root: Element) => moving(root).map(({ name }) => name);

// Linux WebKit on CI: the first skin chosen in a page stays unresolved (docs/TODO.md, « Skins sur WebKit Linux »).
test.skipIf(isLinuxWebkit)(
  "Carnet — la feuille de points du ciel s'efface par plaques qui vont et viennent, lentement, chacune à son rythme",
  async () => {
    const screen = await render(<HeaderArt place="header" sun={false} />);
    const patches = [...screen.container.querySelectorAll(".carnet-veil")];
    expect(patches).toHaveLength(4);

    const fading = moving(screen.container).filter(({ name }) => name === "carnet-veil");
    expect(fading).toHaveLength(4);
    for (const { duration, iterations } of fading) {
      // Slowly (a patch takes more than ten seconds to go and come back), and for ever.
      expect(duration).toBeGreaterThanOrEqual(12_000);
      expect(iterations).toBe(Infinity);
    }
    // Not in step: each has its own period and its own place in it.
    expect(new Set(fading.map(({ duration }) => duration)).size).toBe(4);
    expect(new Set(fading.map(({ delay }) => delay)).size).toBe(4);
    // Cheap to draw: only what the compositor does alone.
    const patch = patches[0];
    if (!patch) throw new Error("no patch");
    const effect = patch.getAnimations()[0]?.effect;
    if (!(effect instanceof KeyframeEffect)) throw new Error("no animation on the patch");
    const keyframes = effect.getKeyframes();
    const properties = new Set(
      keyframes.flatMap((frame) =>
        Object.keys(frame).filter(
          (key) => !["offset", "easing", "composite", "computedOffset"].includes(key),
        ),
      ),
    );
    expect([...properties].toSorted()).toEqual(["opacity", "transform"]);
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — la page de connexion a la même feuille de points, mais immobile : personne n'y a « Animer le fond », qui est dans les réglages",
  async () => {
    // The background is on (the default), and nothing moves there all the same.
    chooseAmbient(true);
    const screen = await render(<HeaderArt place="welcome" />);
    expect(screen.container.querySelectorAll(".carnet-veil")).toHaveLength(4);
    expect(moving(screen.container)).toEqual([]);
    expect(screen.container.querySelector("[data-moving]")).toBeNull();
    // The same sheet in the header of a signed-in page does move.
    const header = await render(<HeaderArt place="header" sun={false} />);
    expect(names(header.container).filter((name) => name === "carnet-veil")).toHaveLength(4);
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — l'orbite des données tourne derrière l'entête d'une page sans bandeau, pas d'une page qui a le sien",
  async () => {
    const plain = await render(<HeaderArt place="header" sun />);
    expect(plain.container.querySelectorAll(".carnet-orbit, .carnet-orbit-back")).not.toHaveLength(
      0,
    );
    expect(names(plain.container)).toContain("carnet-orbit");
    await plain.unmount();

    // The page of an event, of a profile, of a runner: its hero draws the orbit.
    const withHero = await render(<HeaderArt place="header" sun={false} />);
    expect(withHero.container.querySelectorAll(".carnet-orbit, .carnet-orbit-back")).toHaveLength(
      0,
    );
    expect(names(withHero.container)).not.toContain("carnet-orbit");
  },
);

for (const place of ["event", "runner"] as const) {
  test.skipIf(isLinuxWebkit)(
    `Carnet — derrière le bandeau d'${place === "event" ? "un événement" : "un coureur"}, les orbites tournent (160 s le tour, une bague à l'envers) et un point pulse`,
    async () => {
      const screen = await render(<HeroArt place={place} />);
      const running = moving(screen.container);

      const turning = running.filter(({ name }) => name === "carnet-orbit");
      // A ring each way.
      expect(
        turning.map(({ direction }) => String(direction)).toSorted((a, b) => a.localeCompare(b)),
      ).toEqual(["normal", "reverse"]);
      for (const { duration, iterations } of turning) {
        expect(duration).toBe(160_000);
        expect(iterations).toBe(Infinity);
      }
      const pulsing = running.filter(({ name }) => name === "carnet-pulse");
      expect(pulsing).toHaveLength(1);
      expect(pulsing[0]?.duration).toBe(2800);
      expect(pulsing[0]?.iterations).toBe(Infinity);
      // The patches of the dots fade here too.
      expect(running.filter(({ name }) => name === "carnet-veil")).toHaveLength(4);
    },
  );
}

test.skipIf(isLinuxWebkit)(
  "Carnet — chaque bague tourne autour de son milieu, pas autour d'un coin du dessin",
  async () => {
    const screen = await render(<HeroArt place="event" />);
    const turning = screen.container
      .getAnimations({ subtree: true })
      .filter(
        (animation) => isCssAnimation(animation) && animation.animationName === "carnet-orbit",
      );
    expect(turning).toHaveLength(2);
    for (const animation of turning) {
      const group = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
      const ring = group?.querySelector("circle");
      const dot = group?.querySelector("circle:last-of-type");
      if (!ring || !dot) throw new Error("no ring");
      const centre = () => {
        const box = ring.getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
      };
      const where = () => {
        const box = dot.getBoundingClientRect();
        return [box.left + box.width / 2, box.top + box.height / 2];
      };
      animation.pause();
      animation.currentTime = 0;
      const [x0 = 0, y0 = 0] = centre();
      const [dotX0 = 0, dotY0 = 0] = where();
      // A quarter of the way round (40 s of 160): the ring has not moved, its dot has.
      animation.currentTime = 40_000;
      const [x1 = 0, y1 = 0] = centre();
      const [dotX1 = 0, dotY1 = 0] = where();
      expect(Math.hypot(x1 - x0, y1 - y0), "the middle of the ring").toBeLessThan(0.5);
      expect(Math.hypot(dotX1 - dotX0, dotY1 - dotY0), "its dot").toBeGreaterThan(20);
    }
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — la pulsation ne se voit pas au repos : sans animation, il n'y a pas d'anneau",
  async () => {
    chooseAmbient(false);
    const screen = await render(<HeroArt place="event" />);
    const ring = screen.container.querySelector(".carnet-pulse");
    if (!ring) throw new Error("no pulse ring");
    expect(getComputedStyle(ring).opacity).toBe("0");
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — pour qui a demandé moins d'animations, rien ne bouge, mais tout est dessiné",
  async () => {
    await emulateMedia({ reducedMotion: "reduce" });
    const hero = await render(<HeroArt place="event" />);
    const header = await render(<HeaderArt place="header" sun />);
    for (const screen of [hero, header]) {
      expect(moving(screen.container)).toEqual([]);
      expect(screen.container.querySelectorAll(".carnet-veil")).toHaveLength(4);
    }
    expect(hero.container.querySelectorAll(".carnet-orbit")).not.toHaveLength(0);

    // As it was, once the setting is gone.
    await resetMedia();
    expect(names(hero.container)).toContain("carnet-orbit");
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — « Animer le fond » éteint : rien ne bouge, tout est dessiné ; rallumé, ça reprend",
  async () => {
    chooseAmbient(false);
    const hero = await render(<HeroArt place="runner" />);
    const header = await render(<HeaderArt place="header" sun />);
    for (const screen of [hero, header]) {
      expect(moving(screen.container)).toEqual([]);
      expect(screen.container.querySelectorAll(".carnet-veil")).toHaveLength(4);
    }
    expect(hero.container.querySelectorAll(".carnet-orbit")).not.toHaveLength(0);

    // The motifs follow the choice while they are on the page.
    chooseAmbient(true);
    await expect.poll(() => names(hero.container)).toContain("carnet-orbit");
    await expect.poll(() => names(header.container)).toContain("carnet-veil");
    chooseAmbient(false);
    await expect.poll(() => moving(hero.container)).toEqual([]);
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — seul un skin au fond animé le dit : Carnet (et lui seul)",
  () => {
    expect(SKINS.filter((skin) => skin.animatedBackground).map((skin) => skin.id)).toEqual([
      "carnet",
    ]);
  },
);

// --- The sheet of dots behind the pages: the v4's living background ---

/** A page as the app draws it: the art first in a sheet as tall as its content, which scrolls. */
function Sheet({ height = 3000 }: { height?: number }) {
  return (
    <div data-sheet style={{ position: "relative", height }}>
      <PageArt />
    </div>
  );
}

test.skipIf(isLinuxWebkit)(
  "Carnet — la feuille de points de la page : des points fins, et des plaques qui s'effacent et reviennent, nombreuses et lentes",
  async () => {
    const screen = await render(<Sheet />);
    const dots = screen.container.querySelector(".carnet-page-dots");
    if (!dots) throw new Error("no dots");
    // Fine dots, one pixel every four, drawn in a colour of the palette (a mask over a colour).
    const style = getComputedStyle(dots);
    expect(style.maskImage).toMatch(/^url\(/);
    expect(style.maskSize).toBe("4px 4px");

    const patches = [...screen.container.querySelectorAll(".carnet-veil")];
    expect(patches.length).toBeGreaterThanOrEqual(12);
    const fading = moving(screen.container).filter(({ name }) => name === "carnet-veil");
    expect(fading).toHaveLength(patches.length);
    for (const { duration, iterations } of fading) {
      expect(duration).toBeGreaterThanOrEqual(10_000);
      expect(iterations).toBe(Infinity);
    }
    // Not in step: most have a period and a place in it of their own.
    expect(new Set(fading.map(({ duration }) => duration)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(fading.map(({ delay }) => delay)).size).toBeGreaterThanOrEqual(8);
    // The patches are the colour of the paper they fade the dots into.
    const art = screen.container.querySelector(".carnet-art");
    if (!art) throw new Error("no art");
    const ground = getComputedStyle(art);
    expect(ground.getPropertyValue("--carnet-ground").trim()).not.toBe("");
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — la feuille de points reste sous les yeux quand la page défile, et ne dépasse pas la feuille",
  async () => {
    await page.viewport(414, 700);
    try {
      const screen = await render(<Sheet height={3000} />);
      const sheet = screen.container.querySelector<HTMLElement>("[data-sheet]");
      const layer = screen.container.querySelector<HTMLElement>(".carnet-page-sheet");
      if (!sheet || !layer) throw new Error("no sheet");
      const top = sheet.getBoundingClientRect().top + window.scrollY;
      // As tall as the screen: the dots and the patches are always where one looks.
      expect(layer.getBoundingClientRect().height).toBeCloseTo(window.innerHeight, 0);
      for (const at of [0, 900, 1800]) {
        window.scrollTo(0, top + at);
        expect(layer.getBoundingClientRect().top, `scrolled to ${at}`).toBeCloseTo(0, 0);
      }
      // At the foot of the sheet it stops with it: nothing is drawn past it.
      window.scrollTo(0, top + 3000 - window.innerHeight);
      expect(layer.getBoundingClientRect().bottom).toBeLessThanOrEqual(
        sheet.getBoundingClientRect().bottom + 0.5,
      );
      expect(document.documentElement.scrollHeight).toBeLessThanOrEqual(top + 3000 + 1);
    } finally {
      window.scrollTo(0, 0);
      await page.viewport(FRAME.width, FRAME.height);
    }
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — la feuille de points : pour qui a demandé moins d'animations, ou éteinte, rien ne bouge, mais tout est dessiné",
  async () => {
    await emulateMedia({ reducedMotion: "reduce" });
    const reduced = await render(<Sheet />);
    expect(moving(reduced.container)).toEqual([]);
    expect(reduced.container.querySelectorAll(".carnet-veil").length).toBeGreaterThanOrEqual(12);
    await resetMedia();
    expect(names(reduced.container)).toContain("carnet-veil");

    chooseAmbient(false);
    await expect.poll(() => moving(reduced.container)).toEqual([]);
    expect(reduced.container.querySelector(".carnet-page-dots")).not.toBeNull();
    chooseAmbient(true);
    await expect.poll(() => names(reduced.container)).toContain("carnet-veil");
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — ce qui bouge est une boîte HTML, jamais un élément d'un <svg> : WebKit ne compose pas les enfants d'un svg, il les redessinerait à chaque image",
  async () => {
    const drawings = [
      await render(<HeaderArt place="header" sun />),
      await render(<HeroArt place="event" />),
      await render(<HeroArt place="runner" />),
      await render(<Sheet />),
    ];
    for (const { container } of drawings) {
      const animations = container.getAnimations({ subtree: true }).filter(isCssAnimation);
      expect(animations.length).toBeGreaterThan(0);
      for (const animation of animations) {
        const target = animation.effect instanceof KeyframeEffect ? animation.effect.target : null;
        expect(target, `${animation.animationName}: its element`).not.toBeNull();
        expect(
          target instanceof SVGElement,
          `${animation.animationName} animates an element of an SVG`,
        ).toBe(false);
        expect(
          target?.closest("svg"),
          `${animation.animationName} animates what is inside an SVG`,
        ).toBeNull();
      }
    }
  },
);

test.skipIf(isLinuxWebkit)(
  "Carnet — la pulsation reste sur le point teal de sa bague, où qu'elle tourne",
  async () => {
    const screen = await render(<HeroArt place="event" />);
    const pulse = screen.container.querySelector(".carnet-pulse");
    const dot = screen.container.querySelector('.carnet-orbit-back circle[cx="84"]');
    const back = screen.container
      .getAnimations({ subtree: true })
      .find(
        (animation) =>
          isCssAnimation(animation) &&
          animation.animationName === "carnet-orbit" &&
          animation.effect instanceof KeyframeEffect &&
          animation.effect.target?.classList.contains("carnet-orbit-back"),
      );
    if (!pulse || !dot || !back) throw new Error("no pulse, dot or back ring");
    back.pause();
    for (const at of [0, 30_000, 75_000, 120_000]) {
      back.currentTime = at;
      const [pulseX, pulseY] = middle(pulse);
      const [dotX, dotY] = middle(dot);
      expect(Math.hypot(pulseX - dotX, pulseY - dotY), `${at} ms into the turn`).toBeLessThan(1);
    }
  },
);
