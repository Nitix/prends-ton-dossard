package invitations_test

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"regexp"
	"testing"

	"courses/server/invitations"
)

func TestNewToken(t *testing.T) {
	token, hash, err := invitations.NewToken()
	if err != nil {
		t.Fatal(err)
	}

	if len(token) != 43 {
		t.Errorf("len(token) = %d, want 43", len(token))
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		t.Fatalf("the token is not base64url: %v", err)
	}
	if len(raw) != 32 {
		t.Errorf("the token holds %d bytes, want 32", len(raw))
	}

	if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(hash) {
		t.Errorf("hash = %q, want 64 lowercase hexadecimal characters", hash)
	}
	sum := sha256.Sum256([]byte(token))
	if want := hex.EncodeToString(sum[:]); hash != want {
		t.Errorf("hash = %q, want the SHA-256 of the token, %q", hash, want)
	}
	if got := invitations.Hash(token); got != hash {
		t.Errorf("Hash(token) = %q, want %q", got, hash)
	}
	if hash == token {
		t.Error("the hash is the token itself")
	}
}

func TestNewToken_DiffersEachTime(t *testing.T) {
	seen := map[string]bool{}
	for range 20 {
		token, hash, err := invitations.NewToken()
		if err != nil {
			t.Fatal(err)
		}
		if seen[token] || seen[hash] {
			t.Fatalf("a token or a hash came twice: %q", token)
		}
		seen[token], seen[hash] = true, true
	}
}

func TestHash(t *testing.T) {
	// The SHA-256 of "abc", a published test vector.
	const want = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
	if got := invitations.Hash("abc"); got != want {
		t.Errorf("Hash(abc) = %q, want %q", got, want)
	}
}

func TestURL(t *testing.T) {
	got := invitations.URL("https://courses.example.fr", "abc_-123")
	if want := "https://courses.example.fr/invitation#abc_-123"; got != want {
		t.Errorf("URL = %q, want %q", got, want)
	}
}
