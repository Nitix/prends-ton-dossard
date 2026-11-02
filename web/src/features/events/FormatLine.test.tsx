import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { toEventView } from "./api";
import { FormatLine, FormatParts } from "./FormatLine";
import { eventRecord } from "./testFixture";

// The line of a format on a card: Crête's, and the same marked by a skin (a
// picture before it, its name and each measure drawn its own way), which keeps
// the words and their order for a screen reader.

beforeAll(async () => {
  await ensureTemporal();
});

/** The 42 km of the fixture: « Trail 42 km · 2 400 m D+ · max 10h », on 14 June. */
const f42 = () => {
  const found = toEventView(eventRecord).formats.find(({ format }) => format.id === "f42");
  if (found === undefined) throw new Error("no 42 km in the fixture");
  return found;
};

/** Text with its non-breaking spaces made plain, whitespace gathered. */
const plain = (text: string | null) => (text ?? "").replace(/\s+/gu, " ").trim();

/** The text a screen reader reads in an element: without what is hidden from it. */
function spoken(element: Element): string {
  const copy = element.cloneNode(true);
  if (!(copy instanceof Element)) return "";
  for (const hidden of copy.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
  return plain(copy.textContent);
}

async function drawn(line: Parameters<typeof render>[0]) {
  const screen = await render(<I18nProvider languages={["fr"]}>{line}</I18nProvider>);
  const box = screen.container;
  return { box, unmount: () => screen.unmount() };
}

test("FormatLine — sans marques, la ligne de Crête : le nom en gras, puis les mesures et leurs séparateurs dans le texte", async () => {
  const { box, unmount } = await drawn(<FormatLine formatView={f42()} showDate />);
  const [date, line] = [...box.querySelectorAll("p")];
  expect(date?.className).toBe("format-date eyebrow");
  expect(plain(date?.textContent ?? "")).toBe("dim. 14 juin");
  // Its markup as Crête draws it: one span for the name, one text for the rest.
  expect(line?.className).toBe("format-line text-sm text-neutral-700");
  expect(line?.childNodes).toHaveLength(2);
  const name = line?.firstElementChild;
  expect(name?.className).toBe("format-name font-semibold text-ink");
  expect(plain(name?.textContent ?? "")).toBe("Trail 42 km");
  expect(line?.lastChild?.nodeType).toBe(Node.TEXT_NODE);
  expect(plain(line?.textContent ?? "")).toBe("Trail 42 km · 2 400 m D+ · max 10h");
  await unmount();
});

test("FormatLine — marquée par un skin : un dessin avant, le nom et chaque mesure à sa façon, les mêmes mots dans le même ordre", async () => {
  const { box, unmount } = await drawn(
    <FormatLine
      formatView={f42()}
      showDate={false}
      className="flex items-center gap-2 text-sm"
      marks={{
        before: <span aria-hidden="true" data-mark="" />,
        name: (name) => <b>{name}</b>,
        measure: (measure, index) => (
          <span className="tag" data-index={index}>
            {measure}
          </span>
        ),
      }}
    />,
  );
  const line = box.querySelector("p");
  if (line === null) throw new Error("no line");
  // Its semantic class stays, the classes given replace Crête's.
  expect(line.className).toBe("format-line flex items-center gap-2 text-sm");
  // The picture first, then the parts in one box, so that a row of flex items keeps them together.
  expect(line.firstElementChild?.hasAttribute("data-mark")).toBe(true);
  const parts = line.children[1];
  expect(parts?.className).toBe("format-parts");
  expect(line.children).toHaveLength(2);
  expect(plain(parts?.querySelector("b")?.textContent ?? "")).toBe("Trail 42 km");
  const tags = [...(parts?.querySelectorAll(".tag") ?? [])];
  expect(tags.map((tag) => plain(tag.textContent))).toEqual(["2 400 m D+", "max 10h"]);
  expect(tags.map((tag) => tag.getAttribute("data-index"))).toEqual(["0", "1"]);
  // The separators are in the text for a screen reader (and a copy), hidden from the eye.
  const separators = [...(parts?.querySelectorAll(".sr-only") ?? [])];
  expect(separators.map((one) => one.textContent)).toEqual([" · ", " · "]);
  expect(spoken(line)).toBe("Trail 42 km · 2 400 m D+ · max 10h");
  await unmount();
});

test("FormatLine — une marque seule (le nom) garde les mesures en texte, avec leurs séparateurs visibles", async () => {
  const { box, unmount } = await drawn(
    <FormatLine
      formatView={f42()}
      showDate={false}
      marks={{ name: (name) => <span className="own-name">{name}</span> }}
    />,
  );
  const line = box.querySelector("p");
  expect(plain(line?.querySelector(".own-name")?.textContent ?? "")).toBe("Trail 42 km");
  expect(line?.querySelectorAll(".sr-only")).toHaveLength(0);
  expect(plain(line?.textContent ?? "")).toBe("Trail 42 km · 2 400 m D+ · max 10h");
  // No picture before it: the parts are not boxed.
  expect(line?.querySelector(".format-parts")).toBeNull();
  await unmount();
});

test("FormatParts — dessine les parties d'une épreuve hors d'une ligne, pour le titre d'une variante", async () => {
  const { box, unmount } = await drawn(
    <h2>
      <FormatParts
        parts={["Trail court", "15 km", "700 m D+"]}
        marks={{ measure: (measure) => <span className="chip">{measure}</span> }}
      />
    </h2>,
  );
  const title = box.querySelector("h2");
  expect(title?.querySelector(".format-name")?.textContent).toBe("Trail court");
  expect([...(title?.querySelectorAll(".chip") ?? [])].map((chip) => chip.textContent)).toEqual([
    "15 km",
    "700 m D+",
  ]);
  expect(spoken(title ?? box)).toBe("Trail court · 15 km · 700 m D+");
  await unmount();
});
