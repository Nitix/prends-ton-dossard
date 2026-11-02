import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { plain } from "../../test/said";
import { toEventView } from "./api";
import { FormatLine } from "./FormatLine";
import { eventRecord } from "./testFixture";

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
