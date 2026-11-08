package push_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"encoding/json"
	"math/big"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"courses/server/push"
)

func TestVAPID_Token(t *testing.T) {
	keys, err := push.LoadOrCreateKeys(filepath.Join(t.TempDir(), "k.json"))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	header, err := push.VapidAuthorization(keys, "https://fcm.googleapis.com/fcm/send/x", "mailto:admin@example.fr", now)
	if err != nil {
		t.Fatal(err)
	}

	rest, ok := strings.CutPrefix(header, "vapid t=")
	if !ok {
		t.Fatalf("header %q does not start with « vapid t= »", header[:12])
	}
	jwt, k, ok := strings.Cut(rest, ", k=")
	if !ok || k != keys.PublicKey() {
		t.Fatal("the header does not end with ', k=<public key>'")
	}
	parts := strings.Split(jwt, ".")
	if len(parts) != 3 {
		t.Fatalf("the token has %d parts", len(parts))
	}
	for _, p := range parts {
		if p == "" || strings.ContainsAny(p, "=+/") {
			t.Fatal("a part of the token is empty or not base64url without padding")
		}
	}
	if got := string(b64(t, parts[0])); got != `{"typ":"JWT","alg":"ES256"}` {
		t.Errorf("JWT header %s", got)
	}
	var claims map[string]any
	if err := json.Unmarshal(b64(t, parts[1]), &claims); err != nil {
		t.Fatal(err)
	}
	if len(claims) != 3 || claims["aud"] != "https://fcm.googleapis.com" || claims["sub"] != "mailto:admin@example.fr" ||
		claims["exp"] != float64(now.Add(50*time.Minute).Unix()) {
		t.Errorf("claims %v", claims)
	}

	sig := b64(t, parts[2])
	if len(sig) != 64 {
		t.Fatalf("signature of %d bytes, want r||s of 64", len(sig))
	}
	pub := b64(t, keys.PublicKey())
	key := &ecdsa.PublicKey{Curve: elliptic.P256(), X: new(big.Int).SetBytes(pub[1:33]), Y: new(big.Int).SetBytes(pub[33:])}
	r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
	digest := sha256.Sum256([]byte(parts[0] + "." + parts[1]))
	if !ecdsa.Verify(key, digest[:], r, s) {
		t.Error("the signature does not verify with the public key")
	}
	forged := sha256.Sum256([]byte(parts[0] + "." + parts[1] + "x"))
	if ecdsa.Verify(key, forged[:], r, s) {
		t.Error("the signature verifies another text")
	}
}

func TestVAPID_Audience(t *testing.T) {
	keys, _ := push.LoadOrCreateKeys(filepath.Join(t.TempDir(), "k.json"))
	now := time.Now()
	for endpoint, want := range map[string]string{
		"https://updates.push.services.mozilla.com/wpush/v2/abc?x=1": "https://updates.push.services.mozilla.com",
		"https://web.push.apple.com/QG":                              "https://web.push.apple.com",
		"https://wns2-par02p.notify.windows.com/w/?token=abc":        "https://wns2-par02p.notify.windows.com",
		"https://FCM.googleapis.com:443/x":                           "https://fcm.googleapis.com",
	} {
		header, err := push.VapidAuthorization(keys, endpoint, "mailto:a@example.fr", now)
		if err != nil {
			t.Fatal(err)
		}
		jwt := strings.TrimPrefix(strings.SplitN(header, ", k=", 2)[0], "vapid t=")
		var claims struct{ Aud string }
		json.Unmarshal(b64(t, strings.Split(jwt, ".")[1]), &claims)
		if claims.Aud != want {
			t.Errorf("aud of %s… is %q, want %q", endpoint[:20], claims.Aud, want)
		}
	}
}

func TestVAPID_Refusals(t *testing.T) {
	keys, _ := push.LoadOrCreateKeys(filepath.Join(t.TempDir(), "k.json"))
	now := time.Now()
	for name, c := range map[string]struct{ endpoint, contact string }{
		"no contact":       {"https://fcm.googleapis.com/x", ""},
		"a bad contact":    {"https://fcm.googleapis.com/x", "admin@example.fr"},
		"an http contact":  {"https://fcm.googleapis.com/x", "http://example.fr"},
		"no endpoint":      {"", "mailto:a@example.fr"},
		"an odd endpoint":  {"/relative", "mailto:a@example.fr"},
		"an http endpoint": {"http://fcm.googleapis.com/x", "mailto:a@example.fr"},
	} {
		if h, err := push.VapidAuthorization(keys, c.endpoint, c.contact, now); err == nil {
			t.Errorf("%s: accepted (%d bytes)", name, len(h))
		} else if c.endpoint != "" && strings.Contains(err.Error(), c.endpoint) {
			t.Errorf("%s: the error holds the endpoint", name)
		}
	}
}
