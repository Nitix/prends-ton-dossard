package passkeys

import (
	"bytes"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
	"github.com/go-webauthn/webauthn/webauthn"
)

// account is an account of the site as go-webauthn sees it: a user handle and
// the passkeys of the account.
type account struct {
	record      *core.Record
	displayName string
	// passkeys are the records of the credentials, in the same order.
	passkeys    []*core.Record
	credentials []webauthn.Credential
}

var _ webauthn.User = (*account)(nil)

// WebAuthnID is the user handle: the bytes of the id of the account. The
// authenticator gives it back at each login, which finds the account with it.
func (a *account) WebAuthnID() []byte { return []byte(a.record.Id) }

// WebAuthnName is what the passkey managers show to tell the passkeys of a
// site apart: the email that signs in.
func (a *account) WebAuthnName() string { return a.record.Email() }

// WebAuthnDisplayName is the name of the runner of the account.
func (a *account) WebAuthnDisplayName() string { return a.displayName }

func (a *account) WebAuthnCredentials() []webauthn.Credential { return a.credentials }

// passkeyOf returns the record of the credential whose id is id, and that
// credential as it was stored.
func (a *account) passkeyOf(id []byte) (*core.Record, webauthn.Credential, bool) {
	for i, c := range a.credentials {
		if bytes.Equal(c.ID, id) {
			return a.passkeys[i], c, true
		}
	}
	return nil, webauthn.Credential{}, false
}

// loadAccount returns the account of record with its passkeys.
func loadAccount(app core.App, record *core.Record) (*account, error) {
	passkeys, err := app.FindAllRecords("passkeys", dbx.HashExp{"user": record.Id})
	if err != nil {
		return nil, err
	}
	credentials := make([]webauthn.Credential, len(passkeys))
	for i, p := range passkeys {
		if err := json.Unmarshal([]byte(p.GetString("credential")), &credentials[i]); err != nil {
			return nil, fmt.Errorf("reading the credential of the passkey %s: %w", p.Id, err)
		}
	}

	// Every account has a runner, whose name the site shows; the email stands
	// in for it should the runner be missing.
	displayName := record.Email()
	runner, err := app.FindFirstRecordByData("runners", "user", record.Id)
	switch {
	case err == nil:
		displayName = runner.GetString("name")
	case !errors.Is(err, sql.ErrNoRows):
		return nil, err
	}

	return &account{record: record, displayName: displayName, passkeys: passkeys, credentials: credentials}, nil
}

// credentialID returns how the passkeys collection stores the id of a
// credential: in base64url, as the browser and the WebAuthn JSON write it.
func credentialID(c *webauthn.Credential) string {
	return base64.RawURLEncoding.EncodeToString(c.ID)
}

// setCredential stores c in passkey. It is serialized by encoding/json, the
// encoding go-webauthn supports for a whole credential.
func setCredential(passkey *core.Record, c *webauthn.Credential) error {
	data, err := json.Marshal(c)
	if err != nil {
		return err
	}
	passkey.Set("credential", types.JSONRaw(data))
	return nil
}
