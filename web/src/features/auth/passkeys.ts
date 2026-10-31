import { ClientResponseError, type RecordAuthResponse } from "pocketbase";

import { pb } from "../../lib/pb";
import { credentialToJSON, toCreationOptions, toRequestOptions } from "./webauthnJson";

/** What a begin route answers: the id of the ceremony, and the options for the browser. */
type Begun = { sessionId: string; publicKey: unknown };

/** Whether this browser can create and use passkeys: when it cannot, the buttons are left out. */
export function passkeysSupported(): boolean {
  return typeof PublicKeyCredential !== "undefined" && typeof navigator.credentials !== "undefined";
}

/**
 * Whether the browser can offer the passkeys in the autofill of a field
 * (`autocomplete="... webauthn"`), which is what a conditional request needs.
 */
export async function conditionalLoginAvailable(): Promise<boolean> {
  // Older browsers do not have the method at all.
  if (
    !passkeysSupported() ||
    typeof PublicKeyCredential.isConditionalMediationAvailable !== "function"
  ) {
    return false;
  }
  try {
    return await PublicKeyCredential.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

/** What `create()` and `get()` resolve with is a public key credential, or null when there is none. */
function isPublicKeyCredential(credential: Credential | null): credential is PublicKeyCredential {
  return credential !== null && credential.type === "public-key";
}

/**
 * Whether the user turned the prompt down (or let it time out), or the page
 * gave up (a request aborted). None of those is a failure to tell about.
 */
function isCancellation(err: unknown): boolean {
  if (err instanceof ClientResponseError) return err.isAbort;
  return (
    err instanceof DOMException && (err.name === "NotAllowedError" || err.name === "AbortError")
  );
}

/**
 * Creates a passkey for the signed-in user and registers it under `name`.
 * Resolves to true once it is registered, and to false when the user turned
 * the prompt down: there is nothing to tell then. Any other failure is
 * thrown: an API error (`passkey_failed`, `passkey_session_expired`) or the
 * error of the browser (`InvalidStateError` when the device already has a
 * passkey for the account).
 */
export async function registerPasskey(name: string): Promise<boolean> {
  try {
    const begun = await pb.send<Begun>("/api/app/passkeys/register/begin", { method: "POST" });
    const credential = await navigator.credentials.create({
      publicKey: toCreationOptions(begun.publicKey),
    });
    if (!isPublicKeyCredential(credential)) return false;
    await pb.send("/api/app/passkeys/register/finish", {
      method: "POST",
      body: { sessionId: begun.sessionId, name, credential: credentialToJSON(credential) },
    });
    return true;
  } catch (err) {
    if (isCancellation(err)) return false;
    throw err;
  }
}

/**
 * Signs in with a passkey, and keeps the session in the auth store, as a
 * sign-in with a password does. Resolves to true once signed in, and to
 * false when nobody was signed in and there is nothing to tell: the user
 * turned the prompt down, or `signal` aborted the request. Any other failure
 * is thrown, an API error (`passkey_failed`, `account_disabled`...) included.
 *
 * `conditional` waits for the user to pick a passkey in the autofill of the
 * email field instead of showing a prompt.
 */
export async function loginWithPasskey(
  opts: { signal?: AbortSignal; conditional?: boolean } = {},
): Promise<boolean> {
  const { signal, conditional = false } = opts;
  try {
    const begun = await pb.send<Begun>("/api/app/passkeys/login/begin", {
      method: "POST",
      signal,
    });
    const credential = await navigator.credentials.get({
      publicKey: toRequestOptions(begun.publicKey),
      mediation: conditional ? "conditional" : undefined,
      signal,
    });
    if (!isPublicKeyCredential(credential)) return false;
    const session = await pb.send<RecordAuthResponse>("/api/app/passkeys/login/finish", {
      method: "POST",
      body: { sessionId: begun.sessionId, credential: credentialToJSON(credential) },
      signal,
    });
    pb.authStore.save(session.token, session.record);
    return true;
  } catch (err) {
    if (isCancellation(err)) return false;
    throw err;
  }
}
