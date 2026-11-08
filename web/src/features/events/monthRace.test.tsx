import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { beforeAll, expect, test } from "vitest";
import { render } from "vitest-browser-react";

import { en } from "../../i18n/en";
import { fr } from "../../i18n/fr";
import { I18nProvider } from "../../i18n/I18nProvider";
import { ensureTemporal } from "../../lib/temporal";
import { TodayProvider } from "../../lib/useToday";
import { plain } from "../../test/said";
import { toEventView } from "./api";
import { EventCard } from "./EventCard";
import { EventHero } from "./EventHero";
import { eventRecord } from "./testFixture";

import "../../styles.css";

// A race known by its month only, on its card and in its hero.

beforeAll(async () => {
  await ensureTemporal();
});

const june = () =>
  toEventView({
    ...eventRecord,
    start_date: "2027-06-01",
    end_date: "2027-06-30",
    date_precision: "month",
    // Its formats have no day.
    expand: {
      ...eventRecord.expand,
      formats_via_event: eventRecord.expand.formats_via_event.map((format) => ({
        ...format,
        date: "",
      })),
    },
  });

async function drawn(node: React.ReactNode, languages = ["fr"]) {
  const root = createRootRoute({ component: () => node });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  return render(
    <I18nProvider languages={languages}>
      <TodayProvider value={Temporal.PlainDate.from("2027-05-20")}>
        <RouterProvider router={router} />
      </TodayProvider>
    </I18nProvider>,
  );
}

test("EventCard — la pastille « ? » nommée « juin 2027, date à préciser »", async () => {
  const screen = await drawn(<EventCard view={june()} />);
  await expect.element(screen.getByText("juin 2027, date à préciser")).toBeInTheDocument();
  const chip = screen.container.querySelector(".date-chip");
  expect(plain(chip?.textContent)).toContain("?");
  expect(chip?.getAttribute("aria-hidden")).toBe("true");
  expect(chip?.textContent).not.toMatch(/\b1\b/);
  // No day of its own is said for a format.
  expect(screen.container.querySelector(".format-date")).toBeNull();
});

test("EventCard — la pastille dit le mois, en anglais aussi", async () => {
  const screen = await drawn(<EventCard view={june()} />, ["en-GB"]);
  await expect.element(screen.getByText("June 2027, date to be set")).toBeInTheDocument();
});

test("EventHero — une course au mois, sans anneau, dit « juin 2027 · date à préciser »", async () => {
  const screen = await drawn(
    <EventHero view={june()} heading={{ id: "h", "data-focus": "", tabIndex: -1 }} />,
  );
  await expect.element(screen.getByText("juin 2027 · date à préciser")).toBeInTheDocument();
  expect(screen.container.querySelector(".countdown-ring")).toBeNull();
});

test("EventHero — une course datée a toujours son anneau", async () => {
  const dated = toEventView({ ...eventRecord, start_date: "2027-06-13", end_date: "2027-06-14" });
  const screen = await drawn(
    <EventHero view={dated} heading={{ id: "h", "data-focus": "", tabIndex: -1 }} />,
  );
  expect(screen.container.querySelector(".countdown-ring")).not.toBeNull();
  expect(fr.event.monthWhen("x")).toContain("x");
  expect(en.event.monthWhen("x")).toContain("x");
});
