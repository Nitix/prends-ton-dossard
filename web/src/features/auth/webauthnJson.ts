// The conversions between the JSON the server speaks and the objects the
// WebAuthn API takes and gives. WebAuthn works with `ArrayBuffer`s, JSON
// cannot carry them, so the server sends them as base64url text.
//
// Browsers now convert by themselves (`parseCreationOptionsFromJSON`,
// `parseRequestOptionsFromJSON`, `toJSON()`): those are used when they are
// there. Older ones (Safari before 18.4) get the conversion below.

/** The bytes of a base64url text (the URL-safe alphabet, no padding). */
export function b64urlToBuffer(s: string): ArrayBuffer {
  const base64 = s.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

/** The base64url text of some bytes. */
export function bufferToB64url(b: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(b)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

// The options, as they come in JSON: what the browser's own types describe
// (`...JSON`), with the types of the fields the manual conversion goes on to
// hand over (`Omit<...>`: the same fields, in their final types).

type CreationJSON = PublicKeyCredentialCreationOptionsJSON &
  Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials">;

type RequestJSON = PublicKeyCredentialRequestOptionsJSON &
  Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials">;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** An absent list of credentials, or one whose entries all have an id. */
function isDescriptorList(list: unknown): boolean {
  return (
    list === undefined ||
    (Array.isArray(list) && list.every((entry) => isRecord(entry) && typeof entry.id === "string"))
  );
}

// What is checked is what the conversion reads: the server is trusted for the
// rest of the shape. A wrong answer (the page of a proxy, say) must fail here
// with an error, not further down with a half-converted object.

function isCreationJSON(json: unknown): json is CreationJSON {
  return (
    isRecord(json) &&
    typeof json.challenge === "string" &&
    isRecord(json.user) &&
    typeof json.user.id === "string" &&
    isDescriptorList(json.excludeCredentials)
  );
}

function isRequestJSON(json: unknown): json is RequestJSON {
  return (
    isRecord(json) && typeof json.challenge === "string" && isDescriptorList(json.allowCredentials)
  );
}

function descriptors(list: PublicKeyCredentialDescriptorJSON[]): PublicKeyCredentialDescriptor[] {
  return list.map((descriptor) => ({
    ...descriptor,
    type: "public-key",
    id: b64urlToBuffer(descriptor.id),
    // The browser's own types type the transports as text, WebAuthn as a list of names.
    transports: descriptor.transports?.filter(isTransport),
  }));
}

function isTransport(name: string): name is AuthenticatorTransport {
  return ["ble", "hybrid", "internal", "nfc", "usb"].includes(name);
}

/** The options of `navigator.credentials.create()`, from the JSON of the server. */
export function toCreationOptions(json: unknown): PublicKeyCredentialCreationOptions {
  if (!isCreationJSON(json)) {
    throw new TypeError("The WebAuthn creation options are not what was expected");
  }
  if (
    typeof PublicKeyCredential !== "undefined" &&
    typeof PublicKeyCredential.parseCreationOptionsFromJSON === "function"
  ) {
    return PublicKeyCredential.parseCreationOptionsFromJSON(json);
  }
  const { challenge, user, excludeCredentials, ...rest } = json;
  return {
    ...rest,
    challenge: b64urlToBuffer(challenge),
    user: { ...user, id: b64urlToBuffer(user.id) },
    ...(excludeCredentials === undefined
      ? {}
      : { excludeCredentials: descriptors(excludeCredentials) }),
  };
}

/** The options of `navigator.credentials.get()`, from the JSON of the server. */
export function toRequestOptions(json: unknown): PublicKeyCredentialRequestOptions {
  if (!isRequestJSON(json)) {
    throw new TypeError("The WebAuthn request options are not what was expected");
  }
  if (
    typeof PublicKeyCredential !== "undefined" &&
    typeof PublicKeyCredential.parseRequestOptionsFromJSON === "function"
  ) {
    return PublicKeyCredential.parseRequestOptionsFromJSON(json);
  }
  const { challenge, allowCredentials, ...rest } = json;
  return {
    ...rest,
    challenge: b64urlToBuffer(challenge),
    ...(allowCredentials === undefined ? {} : { allowCredentials: descriptors(allowCredentials) }),
  };
}

function isAttestation(
  response: AuthenticatorResponse,
): response is AuthenticatorAttestationResponse {
  return "attestationObject" in response;
}

function isAssertion(response: AuthenticatorResponse): response is AuthenticatorAssertionResponse {
  return "authenticatorData" in response && "signature" in response;
}

/**
 * The credential `create()` or `get()` gave, as the JSON the server reads.
 * Its response is a registration (it has an `attestationObject`) or a login
 * (it has an `authenticatorData`).
 */
export function credentialToJSON(c: PublicKeyCredential): unknown {
  if (typeof c.toJSON === "function") {
    return c.toJSON();
  }
  const common = {
    id: c.id,
    rawId: bufferToB64url(c.rawId),
    type: c.type,
    // Some browsers give null for no attachment: the server reads none.
    authenticatorAttachment: c.authenticatorAttachment ?? undefined,
    clientExtensionResults: c.getClientExtensionResults(),
  };
  const response = c.response;
  if (isAttestation(response)) {
    return {
      ...common,
      response: {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        attestationObject: bufferToB64url(response.attestationObject),
        transports: response.getTransports?.() ?? [],
      },
    };
  }
  if (isAssertion(response)) {
    return {
      ...common,
      response: {
        clientDataJSON: bufferToB64url(response.clientDataJSON),
        authenticatorData: bufferToB64url(response.authenticatorData),
        signature: bufferToB64url(response.signature),
        userHandle: response.userHandle ? bufferToB64url(response.userHandle) : undefined,
      },
    };
  }
  throw new TypeError("The WebAuthn credential has a response of an unknown kind");
}
