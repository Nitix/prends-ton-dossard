import { afterEach, describe, expect, test, vi } from "vitest";

import { ASSERTION_JSON, fakeCredential } from "./testCredential";
import {
  b64urlToBuffer,
  bufferToB64url,
  credentialToJSON,
  toCreationOptions,
  toRequestOptions,
} from "./webauthnJson";

// This project runs in Node, which has no WebAuthn: the manual conversion is
// what runs unless a test puts a `PublicKeyCredential` in place.
afterEach(() => {
  vi.unstubAllGlobals();
});

/** The bytes behind a buffer, to compare them. */
function bytes(buffer: unknown): number[] {
  if (!(buffer instanceof ArrayBuffer)) throw new Error("Not an ArrayBuffer");
  return [...new Uint8Array(buffer)];
}

describe("b64url", () => {
  test("b64url aller-retour sur [0, 255, 1, 254]", () => {
    const original = new Uint8Array([0, 255, 1, 254]).buffer;

    const text = bufferToB64url(original);

    // `+` and `/` of the base64 alphabet are `-` and `_`, and there is no `=`.
    expect(text).toBe("AP8B_g");
    expect(bytes(b64urlToBuffer(text))).toEqual([0, 255, 1, 254]);
  });

  test("the alphabet is the URL-safe one, without padding", () => {
    // 0xfb 0xff 0xbf is "+/+/" in base64.
    expect(bufferToB64url(new Uint8Array([0xfb, 0xff, 0xbf]).buffer)).toBe("-_-_");
    expect(bytes(b64urlToBuffer("-_-_"))).toEqual([0xfb, 0xff, 0xbf]);
    // 1 and 2 leftover bytes would be padded with "==" and "=" in base64.
    expect(bufferToB64url(new Uint8Array([1]).buffer)).toBe("AQ");
    expect(bufferToB64url(new Uint8Array([1, 2]).buffer)).toBe("AQI");
    expect(bytes(b64urlToBuffer("AQ"))).toEqual([1]);
    expect(bytes(b64urlToBuffer("AQI"))).toEqual([1, 2]);
  });

  test("an empty buffer is an empty string", () => {
    expect(bufferToB64url(new ArrayBuffer(0))).toBe("");
    expect(bytes(b64urlToBuffer(""))).toEqual([]);
  });
});

/** The creation options as the server sends them, as JSON. */
const CREATION_JSON = {
  rp: { name: "Courses", id: "localhost" },
  user: { id: "AP8B_g", name: "alice@example.test", displayName: "Alice" },
  challenge: "AAECAw",
  pubKeyCredParams: [
    { type: "public-key", alg: -7 },
    { type: "public-key", alg: -257 },
  ],
  timeout: 300000,
  excludeCredentials: [
    { type: "public-key", id: "_-8", transports: ["internal"] },
    { type: "public-key", id: "AQI" },
  ],
  authenticatorSelection: {
    residentKey: "required",
    requireResidentKey: true,
    userVerification: "preferred",
  },
  attestation: "none",
};

describe("toCreationOptions", () => {
  test("toCreationOptions (repli manuel) : challenge, user.id et excludeCredentials[].id deviennent des ArrayBuffer, les autres champs sont conservés", () => {
    const options = toCreationOptions(CREATION_JSON);

    expect(bytes(options.challenge)).toEqual([0, 1, 2, 3]);
    expect(bytes(options.user.id)).toEqual([0, 255, 1, 254]);
    expect(options.excludeCredentials).toHaveLength(2);
    expect(bytes(options.excludeCredentials?.[0]?.id)).toEqual([0xff, 0xef]);
    expect(bytes(options.excludeCredentials?.[1]?.id)).toEqual([1, 2]);

    // Everything else is kept as it is.
    expect(options.rp).toEqual(CREATION_JSON.rp);
    expect(options.user.name).toBe("alice@example.test");
    expect(options.user.displayName).toBe("Alice");
    expect(options.pubKeyCredParams).toEqual(CREATION_JSON.pubKeyCredParams);
    expect(options.timeout).toBe(300000);
    expect(options.authenticatorSelection).toEqual(CREATION_JSON.authenticatorSelection);
    expect(options.attestation).toBe("none");
    expect(options.excludeCredentials?.[0]?.type).toBe("public-key");
    expect(options.excludeCredentials?.[0]?.transports).toEqual(["internal"]);
  });

  test("does not touch what it was given", () => {
    const before = structuredClone(CREATION_JSON);

    toCreationOptions(CREATION_JSON);

    expect(CREATION_JSON).toEqual(before);
  });

  test("a first registration has no excludeCredentials", () => {
    const { excludeCredentials: _, ...first } = CREATION_JSON;

    const options = toCreationOptions(first);

    expect(options.excludeCredentials).toBeUndefined();
  });

  test("uses the native parser when the browser has one", () => {
    const parsed = { challenge: new ArrayBuffer(1) };
    const parse = vi.fn<(json: unknown) => unknown>().mockReturnValue(parsed);
    vi.stubGlobal("PublicKeyCredential", { parseCreationOptionsFromJSON: parse });

    expect(toCreationOptions(CREATION_JSON)).toBe(parsed);
    expect(parse).toHaveBeenCalledWith(CREATION_JSON);
  });

  test("falls back to the manual conversion when the browser has WebAuthn but no parser (older Safari)", () => {
    vi.stubGlobal("PublicKeyCredential", {});

    expect(bytes(toCreationOptions(CREATION_JSON).challenge)).toEqual([0, 1, 2, 3]);
  });

  test("refuses what is not an object", () => {
    expect(() => toCreationOptions(null)).toThrow(TypeError);
    expect(() => toCreationOptions("challenge")).toThrow(TypeError);
  });
});

/** The request options as the server sends them, as JSON: a discoverable login has no allowCredentials. */
const REQUEST_JSON = {
  challenge: "AAECAw",
  timeout: 300000,
  rpId: "localhost",
  userVerification: "preferred",
};

describe("toRequestOptions", () => {
  test("turns the challenge into an ArrayBuffer and keeps the other fields", () => {
    const options = toRequestOptions(REQUEST_JSON);

    expect(bytes(options.challenge)).toEqual([0, 1, 2, 3]);
    expect(options.timeout).toBe(300000);
    expect(options.rpId).toBe("localhost");
    expect(options.userVerification).toBe("preferred");
    expect(options.allowCredentials).toBeUndefined();
  });

  test("turns the ids of allowCredentials into ArrayBuffers", () => {
    const options = toRequestOptions({
      ...REQUEST_JSON,
      allowCredentials: [{ type: "public-key", id: "AQI", transports: ["usb"] }],
    });

    expect(options.allowCredentials).toHaveLength(1);
    expect(bytes(options.allowCredentials?.[0]?.id)).toEqual([1, 2]);
    expect(options.allowCredentials?.[0]?.transports).toEqual(["usb"]);
  });

  test("uses the native parser when the browser has one", () => {
    const parsed = { challenge: new ArrayBuffer(1) };
    const parse = vi.fn<(json: unknown) => unknown>().mockReturnValue(parsed);
    vi.stubGlobal("PublicKeyCredential", { parseRequestOptionsFromJSON: parse });

    expect(toRequestOptions(REQUEST_JSON)).toBe(parsed);
    expect(parse).toHaveBeenCalledWith(REQUEST_JSON);
  });

  test("refuses what is not an object", () => {
    expect(() => toRequestOptions(undefined)).toThrow(TypeError);
  });
});

/** A credential as an older browser gives it: it has no `toJSON()`. */
function oldCredential(
  response: AuthenticatorResponse,
  attachment: string | null = "platform",
): PublicKeyCredential {
  return Object.defineProperty(
    {
      id: "AP8B_g",
      type: "public-key",
      rawId: new Uint8Array([0, 255, 1, 254]).buffer,
      authenticatorAttachment: attachment,
      response,
      getClientExtensionResults: () => ({ credProps: { rk: true } }),
      toJSON: () => ASSERTION_JSON,
    },
    "toJSON",
    { value: undefined },
  );
}

describe("credentialToJSON", () => {
  test("uses toJSON() when the credential has it", () => {
    const credential = fakeCredential();
    const toJSON = vi.spyOn(credential, "toJSON");

    expect(credentialToJSON(credential)).toBe(ASSERTION_JSON);
    expect(toJSON).toHaveBeenCalledOnce();
  });

  test("converts a new credential by hand when there is no toJSON()", () => {
    const response: AuthenticatorAttestationResponse = {
      clientDataJSON: new Uint8Array([1, 2]).buffer,
      attestationObject: new Uint8Array([3, 4]).buffer,
      getAuthenticatorData: () => new ArrayBuffer(0),
      getPublicKey: () => null,
      getPublicKeyAlgorithm: () => -7,
      getTransports: () => ["internal", "hybrid"],
    };
    const credential = oldCredential(response);

    expect(credentialToJSON(credential)).toEqual({
      id: "AP8B_g",
      rawId: "AP8B_g",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: "AQI",
        attestationObject: "AwQ",
        transports: ["internal", "hybrid"],
      },
    });
  });

  test("converts an assertion by hand when there is no toJSON()", () => {
    const response: AuthenticatorAssertionResponse = {
      clientDataJSON: new Uint8Array([1, 2]).buffer,
      authenticatorData: new Uint8Array([5]).buffer,
      signature: new Uint8Array([6, 7]).buffer,
      userHandle: new Uint8Array([8]).buffer,
    };
    const credential = oldCredential(response);

    expect(credentialToJSON(credential)).toEqual({
      id: "AP8B_g",
      rawId: "AP8B_g",
      type: "public-key",
      authenticatorAttachment: "platform",
      clientExtensionResults: { credProps: { rk: true } },
      response: {
        clientDataJSON: "AQI",
        authenticatorData: "BQ",
        signature: "Bgc",
        userHandle: "CA",
      },
    });
  });

  test("an assertion without a user handle or an attachment leaves them out", () => {
    const response: AuthenticatorAssertionResponse = {
      clientDataJSON: new ArrayBuffer(0),
      authenticatorData: new ArrayBuffer(0),
      signature: new ArrayBuffer(0),
      userHandle: null,
    };
    const credential = oldCredential(response, null);

    // JSON.stringify drops undefined, which is how the server sees "no handle".
    expect(JSON.parse(JSON.stringify(credentialToJSON(credential)))).toEqual({
      id: "AP8B_g",
      rawId: "AP8B_g",
      type: "public-key",
      clientExtensionResults: { credProps: { rk: true } },
      response: { clientDataJSON: "", authenticatorData: "", signature: "" },
    });
  });

  test("a response of an unknown kind is refused", () => {
    const credential = oldCredential({ clientDataJSON: new ArrayBuffer(0) });

    expect(() => credentialToJSON(credential)).toThrow(TypeError);
  });
});
