import { ClientResponseError } from "pocketbase";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";

import { loginWithPasskey, passkeysSupported, registerPasskey } from "./passkeys";
import { ASSERTION_JSON, fakeCredential } from "./testCredential";

// It is a `.tsx` file only for the browser project: the WebAuthn API, which
// is replaced here, only exists in a browser.

type SendOptions = { method: string; body?: unknown; signal?: AbortSignal };

const send = vi.hoisted(() => vi.fn<(path: string, options: SendOptions) => Promise<unknown>>());
const save = vi.hoisted(() => vi.fn<(token: string, record: unknown) => void>());

vi.mock("../../lib/pb", () => ({ pb: { send, authStore: { save } } }));

const REGISTER_BEGIN = "/api/app/passkeys/register/begin";
const REGISTER_FINISH = "/api/app/passkeys/register/finish";
const LOGIN_BEGIN = "/api/app/passkeys/login/begin";
const LOGIN_FINISH = "/api/app/passkeys/login/finish";

const CREATION = {
  sessionId: "session-1",
  publicKey: {
    rp: { name: "Courses", id: "localhost" },
    user: { id: "AP8B_g", name: "alice@example.test", displayName: "Alice" },
    challenge: "AAECAw",
    pubKeyCredParams: [{ type: "public-key", alg: -7 }],
    excludeCredentials: [{ type: "public-key", id: "_-8" }],
    authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
  },
};

const REQUEST = {
  sessionId: "session-2",
  publicKey: { challenge: "AAECAw", rpId: "localhost", userVerification: "preferred" },
};

const SESSION = { token: "session-token", record: { id: "u1", collectionName: "users" } };

/** What the browser gives back once the user has chosen a passkey. */
const credential = fakeCredential();

let create: MockInstance<CredentialsContainer["create"]>;
let get: MockInstance<CredentialsContainer["get"]>;

beforeEach(() => {
  send.mockReset();
  save.mockReset();
  create = vi.spyOn(navigator.credentials, "create").mockResolvedValue(credential);
  get = vi.spyOn(navigator.credentials, "get").mockResolvedValue(credential);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function refusal(status: number, code: string) {
  return new ClientResponseError({ status, response: { status, message: "…", data: { code } } });
}

/** The last request sent to `path`. */
function sentTo(path: string): SendOptions | undefined {
  return send.mock.calls.findLast(([sent]) => sent === path)?.[1];
}

describe("passkeysSupported", () => {
  test("is true in a browser that has WebAuthn", () => {
    expect(passkeysSupported()).toBe(true);
  });

  test("is false when PublicKeyCredential does not exist", () => {
    vi.stubGlobal("PublicKeyCredential", undefined);

    expect(passkeysSupported()).toBe(false);
  });
});

describe("loginWithPasskey", () => {
  beforeEach(() => {
    send.mockImplementation((path) =>
      Promise.resolve(path === LOGIN_BEGIN ? REQUEST : path === LOGIN_FINISH ? SESSION : null),
    );
  });

  test("asks the server for options, asks the browser, sends the answer and keeps the session", async () => {
    const result = await loginWithPasskey();

    expect(result).toBe(true);
    expect(sentTo(LOGIN_BEGIN)?.method).toBe("POST");
    const options = get.mock.calls[0]?.[0];
    expect(options?.publicKey?.rpId).toBe("localhost");
    // The browser got an ArrayBuffer, not the base64url text of the server.
    expect(options?.publicKey?.challenge).toBeInstanceOf(ArrayBuffer);
    expect(options?.mediation).toBeUndefined();
    expect(sentTo(LOGIN_FINISH)).toMatchObject({
      method: "POST",
      body: { sessionId: "session-2", credential: ASSERTION_JSON },
    });
    expect(save).toHaveBeenCalledWith("session-token", SESSION.record);
  });

  test("the conditional login asks the browser for the autofill, and can be aborted", async () => {
    const controller = new AbortController();

    await loginWithPasskey({ conditional: true, signal: controller.signal });

    const options = get.mock.calls[0]?.[0];
    expect(options?.mediation).toBe("conditional");
    expect(options?.signal).toBe(controller.signal);
    expect(sentTo(LOGIN_BEGIN)?.signal).toBe(controller.signal);
  });

  test("loginWithPasskey — NotAllowedError → false et aucun toast d'erreur", async () => {
    get.mockRejectedValue(new DOMException("The user cancelled", "NotAllowedError"));

    // It resolves to false: it neither throws, nor shows anything by itself.
    await expect(loginWithPasskey()).resolves.toBe(false);

    expect(sentTo(LOGIN_FINISH)).toBeUndefined();
    expect(save).not.toHaveBeenCalled();
  });

  test("an AbortError (the page gave up) is false too", async () => {
    get.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    await expect(loginWithPasskey()).resolves.toBe(false);
    expect(save).not.toHaveBeenCalled();
  });

  test("an abort while the options are fetched is false too", async () => {
    // What the SDK throws for a request that was aborted.
    send.mockRejectedValue(new ClientResponseError(new DOMException("Aborted", "AbortError")));

    await expect(loginWithPasskey({ signal: new AbortController().signal })).resolves.toBe(false);
    expect(get).not.toHaveBeenCalled();
  });

  test("no credential is false", async () => {
    get.mockResolvedValue(null);

    await expect(loginWithPasskey()).resolves.toBe(false);
    expect(sentTo(LOGIN_FINISH)).toBeUndefined();
  });

  test("a refusal of the server is thrown, for the page to tell, and no session is kept", async () => {
    const failure = refusal(400, "passkey_failed");
    send.mockImplementation((path) =>
      path === LOGIN_FINISH ? Promise.reject(failure) : Promise.resolve(REQUEST),
    );

    await expect(loginWithPasskey()).rejects.toBe(failure);
    expect(save).not.toHaveBeenCalled();
  });

  test("any other failure of the browser is thrown", async () => {
    const failure = new DOMException("Not allowed here", "SecurityError");
    get.mockRejectedValue(failure);

    await expect(loginWithPasskey()).rejects.toBe(failure);
  });
});

describe("registerPasskey", () => {
  beforeEach(() => {
    send.mockImplementation((path) =>
      Promise.resolve(
        path === REGISTER_BEGIN
          ? CREATION
          : path === REGISTER_FINISH
            ? { id: "pk1", name: "x" }
            : null,
      ),
    );
  });

  test("creates the passkey with the browser and sends it with its name", async () => {
    const result = await registerPasskey("iPhone");

    expect(result).toBe(true);
    expect(sentTo(REGISTER_BEGIN)?.method).toBe("POST");
    const options = create.mock.calls[0]?.[0];
    expect(options?.publicKey?.challenge).toBeInstanceOf(ArrayBuffer);
    expect(options?.publicKey?.user.id).toBeInstanceOf(ArrayBuffer);
    expect(options?.publicKey?.excludeCredentials?.[0]?.id).toBeInstanceOf(ArrayBuffer);
    expect(sentTo(REGISTER_FINISH)).toMatchObject({
      method: "POST",
      body: { sessionId: "session-1", name: "iPhone", credential: ASSERTION_JSON },
    });
  });

  test("a cancelled prompt is false, and nothing is sent to finish", async () => {
    create.mockRejectedValue(new DOMException("The user cancelled", "NotAllowedError"));

    await expect(registerPasskey("iPhone")).resolves.toBe(false);

    expect(sentTo(REGISTER_FINISH)).toBeUndefined();
  });

  test("no credential is false", async () => {
    create.mockResolvedValue(null);

    await expect(registerPasskey("iPhone")).resolves.toBe(false);
    expect(sentTo(REGISTER_FINISH)).toBeUndefined();
  });

  test("a refusal of the server is thrown", async () => {
    const failure = refusal(400, "passkey_session_expired");
    send.mockImplementation((path) =>
      path === REGISTER_FINISH ? Promise.reject(failure) : Promise.resolve(CREATION),
    );

    await expect(registerPasskey("iPhone")).rejects.toBe(failure);
  });

  test("a device that already has a passkey for the account is thrown, for the page to tell", async () => {
    const failure = new DOMException("Already registered", "InvalidStateError");
    create.mockRejectedValue(failure);

    await expect(registerPasskey("iPhone")).rejects.toBe(failure);
  });
});
