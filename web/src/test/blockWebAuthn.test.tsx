import { afterEach, expect, test, vi } from "vitest";

// It is a `.tsx` file only for the browser project: the WebAuthn API, which
// the guard of `blockWebAuthn.ts` stands in for, only exists in a browser.
//
// Nothing here stubs `navigator.credentials` before the first calls: they
// must hit the guard. If it ever stopped being installed, they would open the
// dialog of the operating system, which is what the guard is there to avoid.

const BLOCKED = "Real WebAuthn call in a test";

const creation: PublicKeyCredentialCreationOptions = {
  rp: { name: "Courses", id: "localhost" },
  user: { id: new Uint8Array([1]), name: "alice@example.test", displayName: "Alice" },
  challenge: new Uint8Array([0, 1, 2, 3]),
  pubKeyCredParams: [{ type: "public-key", alg: -7 }],
};

const request: PublicKeyCredentialRequestOptions = {
  challenge: new Uint8Array([0, 1, 2, 3]),
  rpId: "localhost",
};

afterEach(() => {
  vi.restoreAllMocks();
});

test("blockWebAuthn — create() rejette quand le test ne le remplace pas", async () => {
  await expect(navigator.credentials.create({ publicKey: creation })).rejects.toThrow(BLOCKED);
  await expect(navigator.credentials.create({ publicKey: creation })).rejects.toThrow(
    "navigator.credentials.create()",
  );
});

test("blockWebAuthn — get() rejette quand le test ne le remplace pas", async () => {
  await expect(navigator.credentials.get({ publicKey: request })).rejects.toThrow(BLOCKED);
  await expect(navigator.credentials.get({ publicKey: request })).rejects.toThrow(
    "navigator.credentials.get()",
  );
});

test("blockWebAuthn — get() rejette aussi pour l'autofill (mediation conditional)", async () => {
  await expect(
    navigator.credentials.get({ publicKey: request, mediation: "conditional" }),
  ).rejects.toThrow(BLOCKED);
});

test("blockWebAuthn — le remplacement par vi.spyOn prend le relais, et restoreAllMocks rend la garde", async () => {
  vi.spyOn(navigator.credentials, "create").mockResolvedValue(null);
  vi.spyOn(navigator.credentials, "get").mockResolvedValue(null);

  await expect(navigator.credentials.create({ publicKey: creation })).resolves.toBeNull();
  await expect(navigator.credentials.get({ publicKey: request })).resolves.toBeNull();

  vi.restoreAllMocks();

  await expect(navigator.credentials.create({ publicKey: creation })).rejects.toThrow(BLOCKED);
  await expect(navigator.credentials.get({ publicKey: request })).rejects.toThrow(BLOCKED);
});

// The two tests below run one after the other, as the tests of a file do: the
// first leaves its own replacement behind, and does not restore anything.

test("blockWebAuthn — un test qui remplace navigator.credentials sans le restaurer…", async () => {
  navigator.credentials.create = () => Promise.resolve(null);
  navigator.credentials.get = () => Promise.resolve(null);

  await expect(navigator.credentials.create({ publicKey: creation })).resolves.toBeNull();
});

test("blockWebAuthn — …ne laisse rien au test suivant : la garde est réinstallée", async () => {
  await expect(navigator.credentials.create({ publicKey: creation })).rejects.toThrow(BLOCKED);
  await expect(navigator.credentials.get({ publicKey: request })).rejects.toThrow(BLOCKED);
});
