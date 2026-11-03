import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { pb } from "../../lib/pb";
import type { UserRecord } from "../../lib/types";
import { SKIN_KEY, SKINS, chooseSkin } from "../../skins";
import { UNSAVED_KEY, chooseSkinOnAccount, whenSaved } from "./accountSkin";
import { connectSession, logout } from "./session";

// The skin follows the account, from the sign-in to the sign-out: the real
// PocketBase client, the real session and the real skins run here, and only
// fetch is replaced (the server's answers). What each step does with the
// account's skin and the device's is accountSkin.test.ts; this file is that
// the app's session wires it, whichever way the person signs in (the auth store
// is what every way ends in: the password, a passkey, the demo, an invitation).

/** A token that expires an hour from now: the SDK reads it, unsigned. */
function token(): string {
  const payload = btoa(JSON.stringify({ id: "u1", exp: Math.floor(Date.now() / 1000) + 3600 }));
  return `header.${payload}.signature`;
}

/** An account as the server sends it. */
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

/** What the server was asked, by the PATCH of an account: who, and the skin. */
let saved: { id: string; skin: string }[];
/** Whether the server answers (offline when not). */
let online: boolean;
let stop = () => {};

/** Two skins besides Crête, and the id of the page's. */
const [A, B] = SKINS.filter((skin) => skin.id !== "crete").map((skin) => skin.id);
if (A === undefined || B === undefined) throw new Error("two skins besides Crête");
const onPage = () => document.documentElement.dataset.skin;

beforeEach(async () => {
  saved = [];
  online = true;
  vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input), location.href);
    const account = /^\/api\/collections\/users\/records\/([^/]+)$/.exec(url.pathname)?.[1];
    const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    const skin =
      typeof body === "object" && body !== null && "skin" in body && typeof body.skin === "string"
        ? body.skin
        : null;
    if (!online || account === undefined || init?.method !== "PATCH" || skin === null) {
      return Promise.reject(new TypeError("Failed to fetch"));
    }
    saved.push({ id: account, skin });
    return Promise.resolve(
      new Response(JSON.stringify(user(account, skin)), {
        headers: { "Content-Type": "application/json" },
      }),
    );
  });
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(UNSAVED_KEY);
  pb.authStore.clear();
  await chooseSkin("crete");
  stop = connectSession({ invalidate: () => Promise.resolve() }, new QueryClient());
});

afterEach(async () => {
  stop();
  pb.authStore.clear();
  vi.restoreAllMocks();
  localStorage.removeItem(SKIN_KEY);
  localStorage.removeItem(UNSAVED_KEY);
  await chooseSkin("crete");
});

/**
 * Lets what a sign-in started finish, to look at what it did not do: the saves
 * that were on their way are over (`whenSaved`), and two frames have passed,
 * which is far more than the microtasks that a sync would need to put a skin
 * on the page. Not a wait of some milliseconds that a loaded machine could outrun.
 */
async function settle(): Promise<void> {
  await whenSaved();
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

test("connexion — le thème du compte est mis sur la page et gardé sur l'appareil, sans rien envoyer", async () => {
  pb.authStore.save(token(), user("u1", A));

  await vi.waitFor(() => {
    expect(onPage()).toBe(A);
  });
  expect(localStorage.getItem(SKIN_KEY)).toBe(A);
  await settle();
  expect(saved).toEqual([]);
});

test("connexion — un compte sans thème reçoit celui de l'appareil", async () => {
  await chooseSkin(A);

  pb.authStore.save(token(), user("u1"));

  await vi.waitFor(() => {
    expect(saved).toEqual([{ id: "u1", skin: A }]);
  });
  expect(onPage()).toBe(A);
  expect(localStorage.getItem(SKIN_KEY)).toBe(A);
});

test("connexion — un thème que cette version ne connaît pas : Crête sur la page et l'appareil, le compte n'est pas touché", async () => {
  await chooseSkin(A);

  pb.authStore.save(token(), user("u1", "soleil-levant"));

  await vi.waitFor(() => {
    expect(onPage()).toBeUndefined();
  });
  expect(localStorage.getItem(SKIN_KEY)).toBeNull();
  await settle();
  expect(saved).toEqual([]);
});

test("session — un renouvellement du même compte ne défait pas un choix fait depuis : il arrive avec l'ancien thème", async () => {
  pb.authStore.save(token(), user("u1", A));
  await vi.waitFor(() => {
    expect(onPage()).toBe(A);
  });

  await expect(chooseSkinOnAccount(B, "u1")).resolves.toBe("chosen");
  expect(saved).toEqual([{ id: "u1", skin: B }]);

  // The answer to a renewal that left before the choice reached the server.
  pb.authStore.save(token(), user("u1", A));
  await settle();
  expect(onPage()).toBe(B);
  expect(localStorage.getItem(SKIN_KEY)).toBe(B);
  expect(saved).toEqual([{ id: "u1", skin: B }]);
});

test("déconnexion — le thème reste sur l'appareil et sur la page ; se reconnecter lit le compte de nouveau, et un autre compte aussi", async () => {
  pb.authStore.save(token(), user("u1", A));
  await vi.waitFor(() => {
    expect(onPage()).toBe(A);
  });

  logout();
  expect(localStorage.getItem(SKIN_KEY)).toBe(A);
  expect(onPage()).toBe(A);

  // The same person, whose account has another skin by now (chosen on another device).
  pb.authStore.save(token(), user("u1", B));
  await vi.waitFor(() => {
    expect(onPage()).toBe(B);
  });

  // Somebody else, signing in over this session.
  pb.authStore.save(token(), user("u2", A));
  await vi.waitFor(() => {
    expect(onPage()).toBe(A);
  });
  expect(localStorage.getItem(SKIN_KEY)).toBe(A);
  expect(saved).toEqual([]);
});

test("hors ligne — un choix que le compte n'a pas reçu lui est envoyé à la connexion suivante, pas lu depuis lui", async () => {
  pb.authStore.save(token(), user("u1", A));
  await vi.waitFor(() => {
    expect(onPage()).toBe(A);
  });
  online = false;
  await expect(chooseSkinOnAccount(B, "u1")).resolves.toBe("chosen");
  expect(localStorage.getItem(SKIN_KEY)).toBe(B);
  expect(saved).toEqual([]);

  logout();
  online = true;
  pb.authStore.save(token(), user("u1", A));

  await vi.waitFor(() => {
    expect(saved).toEqual([{ id: "u1", skin: B }]);
  });
  expect(onPage()).toBe(B);
  expect(localStorage.getItem(SKIN_KEY)).toBe(B);
});
