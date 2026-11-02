import { vi } from "vitest";

export type Rec = Record<string, unknown>;
export type Call = { action: string; collection: string; id?: string; body?: Rec };

/**
 * What the tests of the form (EventForm.test.tsx, EventForm.period.test.tsx,
 * FormatFieldset.test.tsx) share: the calls the form made to PocketBase, and the
 * answers they give it. See `formHarness.tsx` for the rest.
 */
export const mocks = {
  user: null as Rec | null,
  calls: [] as Call[],
  send: vi.fn<() => Promise<unknown>>(),
  raceTypes: vi.fn<() => Promise<unknown>>(),
  getOne: vi.fn<(id: string, options: Rec) => Promise<unknown>>(),
  getList: vi.fn<(page: number, perPage: number, options: Rec) => Promise<unknown>>(),
  myRunner: vi.fn<(filter: string) => Promise<unknown>>(),
  /** The update of a format on its own: that is how its track is sent, after the batch. */
  updateFormat: vi.fn<(id: string, body: unknown) => Promise<unknown>>(),
};

/**
 * The module `../../lib/pb`, as the tests of the form have it. A test file puts it
 * in place with the line below, which cannot use an import (`vi.mock` is hoisted
 * above them) and must stay in the file:
 *
 *     vi.mock("../../lib/pb", async () => (await import("./formMocks")).pbModule);
 */
export const pbModule = {
  pb: {
    authStore: {
      // A new object on every read, like the SDK's LocalAuthStore.
      get record() {
        return mocks.user && { ...mocks.user };
      },
      onChange: () => () => {},
    },
    filter: (raw: string, params: Rec) => `${raw} ${JSON.stringify(params)}`,
    createBatch: () => ({
      collection: (collection: string) => ({
        create: (body: Rec) => mocks.calls.push({ action: "create", collection, body }),
        update: (id: string, body: Rec) =>
          mocks.calls.push({ action: "update", collection, id, body }),
        delete: (id: string) => mocks.calls.push({ action: "delete", collection, id }),
      }),
      send: mocks.send,
    }),
    collection: (name: string) =>
      ({
        race_types: { getFullList: mocks.raceTypes },
        events: { getOne: mocks.getOne, getList: mocks.getList },
        runners: { getFirstListItem: mocks.myRunner },
        formats: { update: mocks.updateFormat },
      })[name],
  },
};
