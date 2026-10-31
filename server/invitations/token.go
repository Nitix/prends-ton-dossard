// Package invitations holds the links that let somebody join the site (an
// invitation) or choose a new password (a reset).
//
// A link carries a random token. Only the SHA-256 of the token is stored, so a
// leak of the database gives no working link.
package invitations

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
)

// tokenBytes is the number of random bytes of a token.
const tokenBytes = 32

// NewToken returns a new token and its hash, which is the only part to store.
func NewToken() (token string, hash string, err error) {
	raw := make([]byte, tokenBytes)
	if _, err := rand.Read(raw); err != nil {
		return "", "", err
	}
	token = base64.RawURLEncoding.EncodeToString(raw)
	return token, Hash(token), nil
}

// Hash returns the hexadecimal SHA-256 of token.
func Hash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

// URL returns the link to share for token, on the site at appURL.
func URL(appURL, token string) string {
	return appURL + "/invitation/" + token
}
