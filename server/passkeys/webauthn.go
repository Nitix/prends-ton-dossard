// Package passkeys lets an account register passkeys and sign in with one,
// through WebAuthn: PocketBase has no passkeys, go-webauthn does the
// cryptography.
//
// The four routes come in pairs. A begin route answers a sessionId and the
// options of the ceremony in the JSON form of WebAuthn, which the browser
// reads with PublicKeyCredential.parseCreationOptionsFromJSON or
// parseRequestOptionsFromJSON; the finish route then takes that sessionId and
// the credential.toJSON() of the browser.
package passkeys

import (
	"time"

	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"courses/server/config"
)

// ceremonyTTL is how long a ceremony can last, from its begin to its finish.
const ceremonyTTL = 5 * time.Minute

// NewWebAuthn returns the WebAuthn relying party of the site: its ID is the
// host of APP_URL, its one origin is APP_URL. It fails when that host is an IP
// address, which WebAuthn does not accept as an RP ID.
//
// Every passkey is a discoverable credential (the login asks for no email),
// and the authenticator verifies the user when it can.
func NewWebAuthn(cfg config.Config) (*webauthn.WebAuthn, error) {
	return webauthn.New(&webauthn.Config{
		RPID:          cfg.RPID,
		RPDisplayName: "Courses",
		RPOrigins:     []string{cfg.Origin},
		AuthenticatorSelection: protocol.AuthenticatorSelection{
			ResidentKey:        protocol.ResidentKeyRequirementRequired,
			RequireResidentKey: protocol.ResidentKeyRequired(),
			UserVerification:   protocol.VerificationPreferred,
		},
		// The site trusts any authenticator: it has no use for an attestation.
		AttestationPreference: protocol.PreferNoAttestation,
		// The browser gives up when the challenge expires on the server.
		Timeouts: webauthn.TimeoutsConfig{
			Login:        webauthn.TimeoutConfig{Timeout: ceremonyTTL, TimeoutUVD: ceremonyTTL},
			Registration: webauthn.TimeoutConfig{Timeout: ceremonyTTL, TimeoutUVD: ceremonyTTL},
		},
		// The site requests no extension and reads no extension output. By
		// default go-webauthn fails a ceremony whose client returns an output
		// that was not requested, as some password managers do (credProps):
		// that check would protect nothing here and refuse working passkeys.
		ExtensionsUnsolicitedOutputPolicy: protocol.UnsolicitedOutputPolicyIgnore,
	})
}
