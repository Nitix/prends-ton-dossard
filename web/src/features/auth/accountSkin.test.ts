import { afterEach, beforeEach, expect, test, vi } from "vitest";

import type { UserRecord } from "../../lib/types";
import { SKIN_KEY, SKINS, chooseSkin, readSkin } from "../../skins";
import { UNSAVED_KEY, chooseSkinOnAccount, syncAccountSkin, whenSaved } from "./accountSkin";

// The skin follows the account: chosen in the settings, it is kept on the
// account as well as on the device; at sign-in and when a session is restored,
// the account's skin is the device's (and the device's goes to an account that
// has none). Here, without a browser: the server is a stand-in, so are <html>
// and the storage (as in skins/index.test.ts), and a look can fail to load, as
// offline. The whole path, from a sign-in, is accountSkin.signin.test.tsx.

/** What the server is asked: `users.update(id, { skin })`. */
const server = vi.hoisted(() => ({
  update: vi.fn<(id: string, body: { skin: string }) => Promise<unknown>>(),
}));

vi.mock("../../lib/pb", () => ({
  pb: {
    collection: (name: string) => {
      if (name !== "users") throw new Error(`the skin is on the users, not on ${name}`);
      return { update: server.update };
    },
  },
}));

/** The stylesheets of a look are those of a page, which a stand-in has none of (skins/sheets.ts). */
vi.mock("../../skins/sheets", () => ({ settleSheets: () => Promise.resolve(true) }));

/** How the looks load in a test: a skin whose look fails (offline). */
const looks = vi.hoisted(() => ({ failing: new Set<string>() }));

vi.mock("../../skins/looks", async (importOriginal) => {
  const { LOOKS: real } = await importOriginal<typeof import("../../skins/looks")>();
  return {
    LOOKS: Object.fromEntries(
      Object.entries(real).map(([path, load]) => [
        path,
        async () => {
          const id = /^\.\/([^/]+)\/look\.ts$/.exec(path)?.[1] ?? path;
          if (looks.failing.has(id)) {
            throw new TypeError(`Failed to fetch dynamically imported module: ${path}`);
          }
          return load();
        },
      ]),
    ),
  };
});

type Root = { dataset: Record<string, string | undefined>; style: { colorScheme?: string } };

let root: Root;
let stored: Map<string, string>;

beforeEach(async () => {
  root = { dataset: {}, style: {} };
  stored = new Map();
  looks.failing.clear();
  server.update.mockReset();
  server.update.mockResolvedValue({});
  vi.stubGlobal("document", {
    documentElement: root,
    querySelector: () => null,
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      stored.set(key, value);
    },
    removeItem: (key: string) => {
      stored.delete(key);
    },
  });
  // Every test starts on Crête.
  await chooseSkin("crete");
});

/** The updates that a test holds back, opened when it ends: a failed test does not leave the chain of saves stuck for the next. */
const held: PromiseWithResolvers<void>[] = [];

/** An update that waits until the test opens it. */
function holdUpdate(): PromiseWithResolvers<void> {
  const gate = Promise.withResolvers<void>();
  held.push(gate);
  server.update.mockImplementationOnce(async () => {
    await gate.promise;
  });
  return gate;
}

afterEach(async () => {
  for (const gate of held.splice(0)) gate.resolve();
  // What was held has finished before the stand-ins go: it would write into the next test's storage.
  await whenSaved();
  vi.unstubAllGlobals();
});

/**
 * Three skins besides Crête, taken from the registry. A and B are chosen and
 * loaded; the look of C is the one that fails in the tests that need one to
 * (a look that failed is not kept: asking again loads it again, and a look that
 * loaded once never fails after).
 */
const [first, second, third] = SKINS.filter((skin) => skin.id !== "crete").map((skin) => skin.id);
if (first === undefined || second === undefined || third === undefined) {
  throw new Error("three skins besides Crête");
}
const A = first;
const B = second;
const C = third;

/** An account as the server sends it: an empty `skin` is one that chose none. */
function user(id: string, skin = ""): UserRecord {
  return {
    id,
    collectionId: "users",
    collectionName: "users",
    created: "",
    updated: "",
    email: `${id}@example.test`,
    role: "member",
    disabled: false,
    skin,
  };
}

/** The skin the device keeps: none is Crête. */
const device = () => stored.get(SKIN_KEY) ?? "crete";

// Choosing in the settings

test("compte — choisir un thème l'enregistre sur le compte, une fois qu'il est sur la page et sur l'appareil", async () => {
  await expect(chooseSkinOnAccount(A, "u1")).resolves.toBe("chosen");
  expect(device()).toBe(A);
  expect(root.dataset.skin).toBe(A);
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — Crête aussi est enregistrée, sous son nom : sans cela un autre appareil garderait le thème d'avant", async () => {
  await chooseSkinOnAccount(A, "u1");
  await chooseSkinOnAccount("crete", "u1");
  expect(device()).toBe("crete");
  expect(server.update).toHaveBeenLastCalledWith("u1", { skin: "crete" });
});

test("compte — un look qui ne se charge pas : le choix est dit raté, et ni l'appareil ni le compte n'en savent rien", async () => {
  looks.failing.add(C);
  await expect(chooseSkinOnAccount(C, "u1")).resolves.toBe("failed");
  expect(device()).toBe("crete");
  expect(root.dataset.skin).toBeUndefined();
  expect(server.update).not.toHaveBeenCalled();
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — un choix remplacé par un autre n'est pas enregistré, et le dernier l'est", async () => {
  const slow = chooseSkinOnAccount(A, "u1");
  await expect(chooseSkinOnAccount(B, "u1")).resolves.toBe("chosen");
  await expect(slow).resolves.toBe("replaced");
  expect(device()).toBe(B);
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: B });
});

test("compte — personne de connecté : le choix vaut pour l'appareil, rien n'est envoyé", async () => {
  await expect(chooseSkinOnAccount(A, "")).resolves.toBe("chosen");
  expect(device()).toBe(A);
  expect(server.update).not.toHaveBeenCalled();
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — deux choix qui se suivent sont enregistrés dans l'ordre, le second quand le premier est parti", async () => {
  const release = holdUpdate();
  const one = chooseSkinOnAccount(A, "u1");
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledTimes(1);
  });
  const two = chooseSkinOnAccount(B, "u1");
  await vi.waitFor(() => {
    expect(root.dataset.skin).toBe(B);
  });
  // The page has the second skin, but the account is told the first one first.
  expect(server.update).toHaveBeenCalledTimes(1);
  release.resolve();
  await Promise.all([one, two]);
  expect(server.update.mock.calls).toEqual([
    ["u1", { skin: A }],
    ["u1", { skin: B }],
  ]);
});

test("compte — hors ligne : l'appareil garde le choix, sans erreur, et se souvient que le compte ne le sait pas ; l'enregistrement suivant l'oublie", async () => {
  server.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await expect(chooseSkinOnAccount(A, "u1")).resolves.toBe("chosen");
  expect(device()).toBe(A);
  expect(root.dataset.skin).toBe(A);
  expect(stored.get(UNSAVED_KEY)).toBe("u1");

  await chooseSkinOnAccount(B, "u1");
  expect(server.update).toHaveBeenLastCalledWith("u1", { skin: B });
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

// An envoi coupé en route (l'appli d'un iPhone, glissée hors de l'écran) n'est
// ni un succès ni une erreur que l'appli verrait : l'appareil doit déjà savoir
// que le compte n'a pas le choix.
test("compte — le choix est marqué non reçu avant que l'envoi parte, et la marque s'efface au succès", async () => {
  const release = holdUpdate();

  const choosing = chooseSkinOnAccount(A, "u1");
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledTimes(1);
  });
  // In flight: the app could be killed now.
  expect(stored.get(UNSAVED_KEY)).toBe("u1");

  release.resolve();
  await choosing;
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — un envoi qui aboutit pendant qu'un autre attend ne fait pas oublier celui qui attend", async () => {
  const gateOne = holdUpdate();
  const gateTwo = holdUpdate();

  const one = chooseSkinOnAccount(A, "u1");
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledTimes(1);
  });
  const two = chooseSkinOnAccount(B, "u1");
  await vi.waitFor(() => {
    expect(root.dataset.skin).toBe(B);
  });

  gateOne.resolve();
  await one;
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledTimes(2);
  });
  // The first choice reached the account; the last one has not: killed now, it would be lost.
  expect(stored.get(UNSAVED_KEY)).toBe("u1");

  gateTwo.resolve();
  await two;
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — un envoi coupé en route : à la reprise, le choix de l'appareil passe avant le thème plus ancien du compte", async () => {
  // The app is killed mid-flight: that page's update is held, as if it never ended
  // (the test opens it at the end, for the next test's sake), and the page is gone.
  holdUpdate();
  void chooseSkinOnAccount(A, "u1");
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledTimes(1);
  });
  expect(device()).toBe(A);

  // The next start is a page of its own: the modules are new, the device is the same.
  vi.resetModules();
  const next = await import("./accountSkin");
  server.update.mockClear();
  server.update.mockResolvedValue({});
  // The account still has the older skin.
  await next.syncAccountSkin(user("u1", B));
  await next.whenSaved();

  expect(device()).toBe(A);
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
});

/**
 * Signs in, and waits for what went to the account in the background: the start
 * does not wait for it (see the tests of that), the tests of what was sent do.
 */
async function synced(account: UserRecord): Promise<void> {
  await syncAccountSkin(account);
  await whenSaved();
}

// Signing in, restoring a session

test("compte — à la connexion, le thème du compte, s'il est connu de cette version, est mis sur la page et gardé sur l'appareil", async () => {
  await synced(user("u1", A));
  expect(root.dataset.skin).toBe(A);
  expect(readSkin()).toBe(A);
  // Nothing is sent, and nothing else is kept: the mode (Clair, Sombre) stays the device's.
  expect(server.update).not.toHaveBeenCalled();
  expect([...stored.keys()]).toEqual([SKIN_KEY]);
});

test("compte — le thème du compte l'emporte sur celui de l'appareil, Crête y comprise", async () => {
  await chooseSkin(A);
  await synced(user("u1", B));
  expect(device()).toBe(B);

  await synced(user("u1", "crete"));
  expect(device()).toBe("crete");
  expect(root.dataset.skin).toBeUndefined();
  expect(server.update).not.toHaveBeenCalled();
});

test("compte — un compte sans thème reçoit celui de l'appareil, s'il n'est pas Crête", async () => {
  await chooseSkin(A);
  await synced(user("u1"));
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
  // The device keeps what it had.
  expect(device()).toBe(A);
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — un compte sans thème et un appareil sur Crête : rien n'est envoyé, Crête est le thème par défaut", async () => {
  await synced(user("u1"));
  expect(server.update).not.toHaveBeenCalled();
  expect(device()).toBe("crete");
});

test("compte — un thème que cette version ne connaît pas : Crête sur l'appareil, et le compte n'est pas touché", async () => {
  await chooseSkin(A);
  for (const unknown of ["soleil-levant", "_example2", "CRETE", "constructor"]) {
    await chooseSkin(A);
    await synced(user("u1", unknown));
    expect(device(), `the account has ${unknown}`).toBe("crete");
    expect(root.dataset.skin, `the account has ${unknown}`).toBeUndefined();
  }
  expect(server.update).not.toHaveBeenCalled();
});

test("compte — le look du thème du compte ne se charge pas (hors ligne) : l'appareil garde le sien, sans erreur, rien n'est envoyé", async () => {
  await chooseSkin(A);
  looks.failing.add(C);
  await expect(synced(user("u1", C))).resolves.toBeUndefined();
  expect(device()).toBe(A);
  expect(root.dataset.skin).toBe(A);
  expect(server.update).not.toHaveBeenCalled();
});

test("compte — un choix que le compte n'a pas reçu (hors ligne) passe avant le thème du compte : il lui est envoyé", async () => {
  server.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await chooseSkinOnAccount(A, "u1");
  expect(stored.get(UNSAVED_KEY)).toBe("u1");
  server.update.mockClear();

  // Back online, at the next sign-in or session restore: the account still has B.
  await synced(user("u1", B));
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
  expect(device()).toBe(A);
  expect(root.dataset.skin).toBe(A);
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — un choix non reçu qui échoue encore reste à envoyer", async () => {
  server.update.mockRejectedValue(new TypeError("Failed to fetch"));
  await chooseSkinOnAccount(A, "u1");
  await synced(user("u1", B));
  expect(device()).toBe(A);
  expect(stored.get(UNSAVED_KEY)).toBe("u1");
});

test("compte — le choix non reçu d'une personne ne passe pas devant le thème du compte d'une autre", async () => {
  server.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await chooseSkinOnAccount(A, "u1");
  server.update.mockClear();

  await synced(user("u2", B));
  expect(device()).toBe(B);
  expect(server.update).not.toHaveBeenCalled();
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — le thème de l'appareil envoyé à un compte sans thème qui n'arrive pas : il reste à envoyer", async () => {
  await chooseSkin(A);
  server.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await synced(user("u1"));
  expect(device()).toBe(A);
  expect(stored.get(UNSAVED_KEY)).toBe("u1");
});

// The first render waits for the skin of the account to be on the page (no
// flash), not for a save: a PATCH that is slow, or one that the server drops
// (the demo's account keeps no skin, so every cold start of a demo visitor
// would pay a round trip for nothing) must not hold the app back.
test("compte — le démarrage n'attend pas l'envoi du thème de l'appareil à un compte qui n'en a pas : il part en arrière-plan", async () => {
  await chooseSkin(A);
  const gate = holdUpdate();

  const winner = await Promise.race([
    syncAccountSkin(user("u1")).then(() => "synced"),
    new Promise((resolve) => setTimeout(() => resolve("waiting for the save"), 300)),
  ]);

  expect(winner).toBe("synced");
  // The save is on its way all the same, and the device has marked it.
  await vi.waitFor(() => {
    expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
  });
  expect(stored.get(UNSAVED_KEY)).toBe("u1");
  gate.resolve();
  await whenSaved();
  expect(stored.has(UNSAVED_KEY)).toBe(false);
});

test("compte — le démarrage n'attend pas non plus l'envoi d'un choix que le compte n'a pas reçu", async () => {
  server.update.mockRejectedValueOnce(new TypeError("Failed to fetch"));
  await chooseSkinOnAccount(A, "u1");
  server.update.mockClear();
  const gate = holdUpdate();

  const winner = await Promise.race([
    syncAccountSkin(user("u1", B)).then(() => "synced"),
    new Promise((resolve) => setTimeout(() => resolve("waiting for the save"), 300)),
  ]);

  expect(winner).toBe("synced");
  expect(device()).toBe(A);
  gate.resolve();
  await whenSaved();
  expect(server.update).toHaveBeenCalledExactlyOnceWith("u1", { skin: A });
});
