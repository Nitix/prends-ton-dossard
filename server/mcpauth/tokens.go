// Package mcpauth holds the personal tokens with which an assistant (an MCP
// client) acts on the site as the owner of the token: how a token is made and
// checked, and the hooks that keep its invariants.
//
// # What a token is
//
// A token looks like
//
//	ptd_<id of its record, 15 characters>_<secret, 43 characters>
//
// The secret is 32 random bytes in base64url (invitations.NewToken). The
// prefix says where a token comes from, to a person and to the tools that
// look for secrets in a repository.
//
// # Why only the hash
//
// Only the SHA-256 of the secret is stored, in a hidden field, so a copy of the
// database gives no working token. The token is the only copy of the secret:
// it is shown once, when it is made. A lost token is revoked and made again.
//
// # Why the id is in the token
//
// The id is not a secret. It finds the record directly, so that checking a
// token reads one record, not the whole table to compare hashes. The secret
// alone decides.
//
// # Why constant time
//
// The hash of the secret received is compared with the stored one by a
// constant-time comparison, so that the time of a refusal does not tell how
// much of a hash was right. An id that no record has is compared with a dummy
// hash, so that "no such token" and "wrong secret" take the same path.
//
// # Why no expiry
//
// A token lives until it is revoked, until the account is disabled (the hooks)
// or until the account is deleted (the cascade of the relation). That is the
// choice of the site: the settings list the tokens with their last use, which
// is how a token that is no longer used gets revoked.
//
// # Where the tests live
//
// The tests are external (package mcpauth_test): the test harness imports the
// wiring of the application, which imports this package. export_test.go gives
// them what they need.
package mcpauth

import (
	"crypto/subtle"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/invitations"
)

const (
	// Prefix starts every token.
	Prefix = "ptd_"
	// MaxPerAccount is the number of tokens that an account may have at once:
	// one for each machine or assistant.
	MaxPerAccount = 5
)

// ErrInvalid is the only refusal of Authenticate. It does not say why: a
// caller learns nothing about the tokens that exist.
var ErrInvalid = errors.New("mcpauth: invalid token")

// scheme starts the Authorization header of a request with a token. The
// comparison ignores the case (RFC 9110: an authentication scheme is not case
// sensitive).
const scheme = "Bearer "

// shape is the exact form of a token: the prefix, the 15 characters of an id
// (core.DefaultIdAlphabet, core.DefaultIdLength), an underscore, and 43
// characters of base64url, which is 32 bytes without the padding.
var shape = regexp.MustCompile(`^` + regexp.QuoteMeta(Prefix) + `([a-z0-9]{15})_([A-Za-z0-9_-]{43})$`)

// dummyHash is what the secret of a token whose id is unknown is compared with.
var dummyHash = invitations.Hash("mcpauth: the hash that an unknown id is compared with")

// now is the clock of the package, which the tests replace.
var now = time.Now

// Create makes a token named name (trimmed) for the account userID. token is the
// only copy of the secret; the record keeps its SHA-256 (invitations.Hash).
//
// The id of the record is chosen here, before the save, so that the token can
// name it.
//
// A name that is empty or longer than 50 characters is a validation error on
// name (validation_required, validation_max_text_constraint), and a sixth token
// for the account is refused by the hook with the token_limit code (a 400). No
// token is made then.
func Create(app core.App, userID, name string) (token string, record *core.Record, err error) {
	collection, err := app.FindCollectionByNameOrId("mcp_tokens")
	if err != nil {
		return "", nil, fmt.Errorf("mcpauth: finding the collection: %w", err)
	}
	secret, hash, err := invitations.NewToken()
	if err != nil {
		return "", nil, fmt.Errorf("mcpauth: making the secret: %w", err)
	}

	id := core.GenerateDefaultRandomId()
	record = core.NewRecord(collection)
	record.Id = id
	record.Set("user", userID)
	record.Set("name", strings.TrimSpace(name))
	record.Set("token_hash", hash)

	// In a transaction, so that the count of the hook that holds the limit and
	// the insert cannot be interleaved with the ones of another request: two
	// requests at once would both see four tokens.
	err = app.RunInTransaction(func(tx core.App) error { return tx.Save(record) })
	if err != nil {
		return "", nil, err
	}
	return Prefix + id + "_" + secret, record, nil
}

// Authenticate checks the value of an Authorization header, and returns the
// account that the token belongs to and the record of the token. Every refusal
// is ErrInvalid:
//
//   - the scheme is not Bearer (whatever its case), or the token does not have
//     exactly the shape above: refused without reading the database;
//   - no record has the id of the token, or the hash of the secret is not the
//     one of the record;
//   - the account does not exist (the cascade makes it impossible, but a token
//     must not outlive its account), or is disabled.
//
// A session token of the site is not a token of this package: it has no such
// shape. Any other error is the server's, a database that fails.
//
// Authenticate does not write: Touch records the use.
func Authenticate(app core.App, header string) (user, token *core.Record, err error) {
	if len(header) < len(scheme) || !strings.EqualFold(header[:len(scheme)], scheme) {
		return nil, nil, ErrInvalid
	}
	m := shape.FindStringSubmatch(header[len(scheme):])
	if m == nil {
		return nil, nil, ErrInvalid
	}
	id, secret := m[1], m[2]

	token, err = app.FindRecordById("mcp_tokens", id)
	want := dummyHash
	switch {
	case err == nil:
		want = token.GetString("token_hash")
	case errors.Is(err, sql.ErrNoRows):
		token = nil
	default:
		return nil, nil, fmt.Errorf("mcpauth: finding the token: %w", err)
	}
	// The hashes are hexadecimal SHA-256, 64 characters each: the comparison
	// takes the same time whatever the secret.
	same := subtle.ConstantTimeCompare([]byte(invitations.Hash(secret)), []byte(want)) == 1
	if !same || token == nil {
		return nil, nil, ErrInvalid
	}

	user, err = app.FindRecordById("users", token.GetString("user"))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil, ErrInvalid
	}
	if err != nil {
		return nil, nil, fmt.Errorf("mcpauth: finding the account of the token: %w", err)
	}
	if user.GetBool("disabled") {
		return nil, nil, ErrInvalid
	}
	return user, token, nil
}

// Touch records a use of token: last_used_at is now, unless it was set less
// than a minute ago, which saves a write at each request of an assistant that
// is busy. A last use in the future (the clock went back) is not a recent one.
func Touch(app core.App, token *core.Record) error {
	at := now()
	if last := token.GetDateTime("last_used_at"); !last.IsZero() {
		if since := at.Sub(last.Time()); since >= 0 && since < time.Minute {
			return nil
		}
	}
	token.Set("last_used_at", at)
	return app.Save(token)
}
