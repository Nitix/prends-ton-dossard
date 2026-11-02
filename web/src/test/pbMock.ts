/**
 * The module `../lib/pb` as the tests of a skin's pieces have it: a member
 * signed in (or an admin: set `pbSession.role`), their runner Alice, and no
 * request to a server. It imports nothing of the app, so that a mock can load
 * it before the app. A test file puts it in place with the line below (with
 * its own path to this file), which cannot use an import (`vi.mock` is hoisted
 * above them) and must stay in the file:
 *
 *     vi.mock("../../lib/pb", async () => (await import("../../test/pbMock")).pbModule);
 */

/** Who is signed in: a member by default. A test that needs the admin sets it, and puts it back after. */
export const pbSession = { role: "member" as "member" | "admin" };

export const pbModule = {
  pb: {
    authStore: {
      get record() {
        return { id: "u1", collectionName: "users", role: pbSession.role };
      },
      onChange: () => () => {},
    },
    filter: (raw: string) => raw,
    collection: () => ({
      getFirstListItem: () => Promise.resolve({ id: "r1", name: "Alice", user: "u1" }),
    }),
  },
};
