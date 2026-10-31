import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeAll, beforeEach, expect, test, vi } from "vitest";
import { render } from "vitest-browser-react";

import { ensureTemporal } from "../../lib/temporal";
import { EVENT_EXPAND, useEvent, useEvents } from "./api";
import { eventRecord } from "./testFixture";

const mocks = vi.hoisted(() => ({
  getOne: vi.fn<(id: string, options: Record<string, unknown>) => Promise<unknown>>(),
  getFullList: vi.fn<(options: Record<string, unknown>) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    filter: (raw: string, params: Record<string, string>) => `${raw} ${JSON.stringify(params)}`,
    collection: () => ({ getOne: mocks.getOne, getFullList: mocks.getFullList }),
  },
}));

beforeAll(async () => {
  await ensureTemporal();
});

beforeEach(() => {
  mocks.getOne.mockReset().mockResolvedValue(eventRecord);
  mocks.getFullList.mockReset().mockResolvedValue([eventRecord]);
});

function OneEvent({ id }: { id: string }) {
  const { data, isError } = useEvent(id);
  if (isError) return <p>error</p>;
  return <p data-testid="event">{data ? data.formats.map((v) => v.format.id).join(",") : "…"}</p>;
}

function Range() {
  const { data } = useEvents({
    from: Temporal.PlainDate.from("2026-06-01"),
    to: Temporal.PlainDate.from("2026-06-30"),
  });
  return <p data-testid="range">{data ? data.map((v) => v.event.name).join(",") : "…"}</p>;
}

test("useEvent — demande l'événement avec son expand et le rend en vue, sous la clé [event, id]", async () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={queryClient}>
      <OneEvent id="event" />
    </QueryClientProvider>,
  );

  await expect.element(screen.getByTestId("event")).toHaveTextContent("f15,f42");
  expect(mocks.getOne).toHaveBeenCalledWith("event", { expand: EVENT_EXPAND });
  expect(queryClient.getQueryData(["event", "event"])).toMatchObject({
    event: { id: "event" },
  });
});

test("useEvents — une plage de dates se demande au serveur, triée par début", async () => {
  const screen = await render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Range />
    </QueryClientProvider>,
  );

  await expect.element(screen.getByTestId("range")).toHaveTextContent("Trail des Crêtes");
  const options = mocks.getFullList.mock.calls[0]?.[0];
  expect(options).toMatchObject({ sort: "start_date", expand: EVENT_EXPAND });
  expect(options?.filter).toContain(`"to":"2026-06-30"`);
  expect(options?.filter).toContain(`"from":"2026-06-01"`);
});
