import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "vitest";

// What moves on its own costs a phone: an animation that never ends keeps the
// compositor at work (and the battery with it) for as long as it is on screen,
// all the more on a layer that is blurred. The sky of « Crête » is still: what
// moves, moves once (a dialog that rises, a ring that draws itself, a check that
// pops), and not at all when less motion is asked for.

const root = fileURLToPath(new URL(".", import.meta.url));

/** The source files of the app and its stylesheets, not its tests. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "test" ? [] : sources(path);
    return /\.(tsx?|css)$/.test(entry.name) && !/\.test\.tsx?$|\.gen\.ts$/.test(entry.name)
      ? [path]
      : [];
  });
}

test("motion — aucune animation ne tourne sans fin", () => {
  const endless = sources(root).flatMap((file) => {
    const text = readFileSync(file, "utf8");
    // An iteration count of `infinite` (in a declaration, in an animation of
    // the theme, or in a class of Tailwind with a value), and the endless
    // animations of Tailwind.
    return [
      ...text.matchAll(
        /(?:animation|--animate-[\w-]+)[^;{}]*\binfinite\b|animate-\[[^\]]*infinite[^\]]*\]|\banimate-(?:spin|ping|pulse|bounce)\b/g,
      ),
    ].map((match) => `${relative(root, file)}: ${match[0]}`);
  });
  expect(endless).toEqual([]);
});
