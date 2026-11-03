import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { plain } from "../../test/said";
import { toEventView } from "./api";
import { FormatLine } from "./FormatLine";
import { eventRecord } from "./testFixture";

// The width of a column and the size of the words come from the styles.
import "../../styles.css";

// The line of a format on a card: its name in bold, then its measures, and its
// day on an event of several days.

beforeAll(async () => {
  await ensureTemporal();
});

/** The 42 km of the fixture: « Trail 42 km · 2 400 m D+ · max 10h », on 14 June. */
const f42 = () => {
  const found = toEventView(eventRecord).formats.find(({ format }) => format.id === "f42");
  if (found === undefined) throw new Error("no 42 km in the fixture");
  return found;
};

async function drawn(line: Parameters<typeof render>[0]) {
  const screen = await render(<I18nProvider languages={["fr"]}>{line}</I18nProvider>);
  const box = screen.container;
  return { box, unmount: () => screen.unmount() };
}

test("FormatLine — la ligne d'une épreuve : le nom en gras, puis les mesures et leurs séparateurs dans le texte", async () => {
  const { box, unmount } = await drawn(<FormatLine formatView={f42()} showDate />);
  const [date, line] = [...box.querySelectorAll("p")];
  expect(date?.className).toBe("format-date eyebrow");
  expect(plain(date?.textContent ?? "")).toBe("dim. 14 juin");
  // Its markup as Crête draws it: one span for the name, then each measure in a span
  // of its own after its separator (a text).
  expect(line?.className).toBe("format-line text-sm text-neutral-700");
  expect([...(line?.childNodes ?? [])].map((node) => node.nodeType)).toEqual([
    Node.ELEMENT_NODE,
    Node.TEXT_NODE,
    Node.ELEMENT_NODE,
    Node.TEXT_NODE,
    Node.ELEMENT_NODE,
  ]);
  const name = line?.firstElementChild;
  expect(name?.className).toBe("format-name font-semibold text-ink");
  expect(plain(name?.textContent ?? "")).toBe("Trail 42 km");
  const measures = [...(line?.querySelectorAll(".format-measure") ?? [])];
  expect(measures.map((measure) => plain(measure.textContent))).toEqual(["2 400 m D+", "max 10h"]);
  // The words are the same as ever, separators included.
  expect(plain(line?.textContent ?? "")).toBe("Trail 42 km · 2 400 m D+ · max 10h");
  await unmount();
});

test("FormatLine — une mesure ne se coupe pas : la ligne passe à la suivante entre deux mesures, jamais au milieu de « 1 200 m D+ »", async () => {
  const view = f42();
  const long = {
    ...view,
    format: { ...view.format, name: "Trail découverte", elevation_gain_m: 1200, price_eur: 89.5 },
  };
  // From a narrow column (two on a 768 px screen) to a roomy one.
  for (const width of [150, 190, 230, 256, 300]) {
    const { box, unmount } = await drawn(
      <div style={{ width }}>
        <FormatLine formatView={long} showDate={false} />
      </div>,
    );
    const line = box.querySelector(".format-line");
    const measures = [...box.querySelectorAll(".format-measure")];
    expect(measures.length, `${width} px: the measures`).toBeGreaterThanOrEqual(3);
    for (const measure of measures) {
      // An inline box cut between two lines has a rectangle for each.
      expect(
        measure.getClientRects().length,
        `${width} px: « ${plain(measure.textContent)} »`,
      ).toBe(1);
    }
    expect(plain(line?.textContent ?? "")).toMatch(/^Trail découverte · 42 km · 1 200 m D+/);
    // Not a line too wide for its box either.
    expect((line?.getBoundingClientRect().width ?? 0) <= width + 0.5, `${width} px: the line`).toBe(
      true,
    );
    await unmount();
  }
});
