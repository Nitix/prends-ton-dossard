// A stand-in for the credential a browser gives back once the user has picked
// a passkey, for the tests that replace `navigator.credentials`.

/** The JSON that the credential gives (`toJSON()`) and that the server is sent. */
export const ASSERTION_JSON: AuthenticationResponseJSON = {
  id: "cred-1",
  rawId: "cred-1",
  type: "public-key",
  clientExtensionResults: {},
  response: { clientDataJSON: "AQI", authenticatorData: "BQ", signature: "Bgc" },
};

export function fakeCredential(): PublicKeyCredential {
  return {
    id: ASSERTION_JSON.id,
    type: "public-key",
    rawId: new ArrayBuffer(0),
    authenticatorAttachment: "platform",
    response: { clientDataJSON: new ArrayBuffer(0) },
    getClientExtensionResults: () => ({}),
    toJSON: () => ASSERTION_JSON,
  };
}
