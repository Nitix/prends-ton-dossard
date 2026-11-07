package push_test

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"

	"courses/server/push"
)

func b64(t testing.TB, s string) []byte {
	t.Helper()
	b, err := base64.RawURLEncoding.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// decrypt is the receiver's side of RFC 8291 § 4, written apart from the
// sender's so that a mistake of one does not hide in the other.
func decrypt(t testing.TB, uaPrivate *ecdh.PrivateKey, auth, body []byte) []byte {
	t.Helper()
	if len(body) < 86 {
		t.Fatalf("body of %d bytes", len(body))
	}
	salt, rs, idlen := body[:16], binary.BigEndian.Uint32(body[16:20]), int(body[20])
	if idlen != 65 || rs != 4096 {
		t.Fatalf("header: rs %d, idlen %d", rs, idlen)
	}
	asPublic, record := body[21:21+idlen], body[21+idlen:]
	if len(record) > int(rs) {
		t.Fatalf("record of %d bytes over rs %d", len(record), rs)
	}
	asKey, err := ecdh.P256().NewPublicKey(asPublic)
	if err != nil {
		t.Fatal(err)
	}
	secret, err := uaPrivate.ECDH(asKey)
	if err != nil {
		t.Fatal(err)
	}
	prkKey, _ := hkdf.Extract(sha256.New, secret, auth)
	info := append([]byte("WebPush: info\x00"), uaPrivate.PublicKey().Bytes()...)
	info = append(info, asPublic...)
	ikm, _ := hkdf.Expand(sha256.New, prkKey, string(info), 32)
	prk, _ := hkdf.Extract(sha256.New, ikm, salt)
	cek, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	nonce, _ := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	block, _ := aes.NewCipher(cek)
	gcm, _ := cipher.NewGCM(block)
	plain, err := gcm.Open(nil, nonce, record, nil)
	if err != nil {
		t.Fatalf("the record does not open: %v", err)
	}
	// The only record is the last one: the data, then 0x02, and no padding.
	if len(plain) == 0 || plain[len(plain)-1] != 0x02 {
		t.Fatal("the last record does not end with the delimiter 0x02")
	}
	return plain[:len(plain)-1]
}

// RFC 8291, appendix A: every key, the salt and the result are the RFC's.
func TestWebPush_RFC8291Example(t *testing.T) {
	uaPublic := b64(t, "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4")
	auth := b64(t, "BTBZMqHH6r4Tts7J_aSIgg")
	asPrivate, err := ecdh.P256().NewPrivateKey(b64(t, "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := base64.RawURLEncoding.EncodeToString(asPrivate.PublicKey().Bytes()), "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"; got != want {
		t.Fatalf("the public key of the sender is %s…", got[:8])
	}
	salt := b64(t, "DGv6ra1nlYgDCS1FRnbzlw")
	want := "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"

	plaintext := []byte("When I grow up, I want to be a watermelon")
	body, err := push.Encrypt(push.Subscription{Endpoint: "https://fcm.googleapis.com/x", P256dh: uaPublic, Auth: auth}, plaintext, asPrivate, salt)
	if err != nil {
		t.Fatal(err)
	}
	if got := base64.RawURLEncoding.EncodeToString(body); got != want {
		t.Fatalf("the body differs from the RFC's\n got %s\nwant %s", got, want)
	}

	// The receiver of the RFC opens it: ua_private of the appendix.
	uaPrivate, err := ecdh.P256().NewPrivateKey(b64(t, "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94"))
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(uaPrivate.PublicKey().Bytes(), uaPublic) {
		t.Fatal("ua_private is not the key of ua_public")
	}
	if got := decrypt(t, uaPrivate, auth, body); !bytes.Equal(got, plaintext) {
		t.Fatalf("decrypted %q", got)
	}
}

func TestWebPush_RoundTripWithRandomKeys(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	rand.Read(auth)
	sub := push.Subscription{Endpoint: "https://fcm.googleapis.com/x", P256dh: ua.PublicKey().Bytes(), Auth: auth}
	for _, n := range []int{0, 1, 100, push.MaxPayload} {
		plaintext := make([]byte, n)
		rand.Read(plaintext)
		as, _ := ecdh.P256().GenerateKey(rand.Reader)
		salt := make([]byte, 16)
		rand.Read(salt)
		body, err := push.Encrypt(sub, plaintext, as, salt)
		if err != nil {
			t.Fatalf("%d bytes: %v", n, err)
		}
		if len(body) > 4096 {
			t.Errorf("%d bytes of message make a body of %d, over the 4096 the services take", n, len(body))
		}
		if got := decrypt(t, ua, auth, body); !bytes.Equal(got, plaintext) {
			t.Errorf("%d bytes: the round trip differs", n)
		}
	}
}

func TestWebPush_Refusals(t *testing.T) {
	ua, _ := ecdh.P256().GenerateKey(rand.Reader)
	auth := make([]byte, 16)
	as, _ := ecdh.P256().GenerateKey(rand.Reader)
	salt := make([]byte, 16)
	good := push.Subscription{P256dh: ua.PublicKey().Bytes(), Auth: auth}

	if _, err := push.Encrypt(good, make([]byte, push.MaxPayload+1), as, salt); err == nil {
		t.Error("a message over one record was accepted")
	}
	if push.MaxPayload != 3993 {
		t.Errorf("MaxPayload = %d, want 3993 (4096 - 86 of header - 16 of tag - 1 of delimiter)", push.MaxPayload)
	}
	bad := good
	bad.P256dh = good.P256dh[:64]
	if _, err := push.Encrypt(bad, []byte("x"), as, salt); err == nil {
		t.Error("a short key was accepted")
	}
	bad = good
	bad.P256dh = make([]byte, 65)
	bad.P256dh[0] = 4 // not on the curve
	if _, err := push.Encrypt(bad, []byte("x"), as, salt); err == nil {
		t.Error("a point off the curve was accepted")
	}
	bad = good
	bad.Auth = auth[:15]
	_, err := push.Encrypt(bad, []byte("x"), as, salt)
	if err == nil {
		t.Error("a short auth secret was accepted")
	} else if strings.Contains(err.Error(), base64.RawURLEncoding.EncodeToString(good.P256dh)[:20]) {
		t.Error("the error holds a key")
	}
	if _, err := push.Encrypt(good, []byte("x"), as, salt[:15]); err == nil {
		t.Error("a short salt was accepted")
	}
}
