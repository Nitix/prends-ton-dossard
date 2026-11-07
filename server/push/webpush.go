package push

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/hkdf"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"net/url"
	"strings"
)

// Subscription is what a browser gave: its endpoint and its two keys.
type Subscription struct {
	Endpoint string
	P256dh   []byte // 65 bytes, an uncompressed P-256 point
	Auth     []byte // 16 bytes
}

// The one record of a message (RFC 8291 § 4, RFC 8188): the services take a
// body of 4096 bytes at least and no more, so the record size is 4096 and the
// whole message is one record.
const (
	recordSize = 4096
	headerSize = 16 + 4 + 1 + 65 // salt, rs, idlen, the sender's public key
	tagSize    = 16
	// maxPayload is what is left for the message: the record, less the tag and
	// the delimiter byte, after the header (4096 - 86 - 16 - 1 = 3993).
	maxPayload = recordSize - headerSize - tagSize - 1
)

// encrypt is RFC 8291 for one record: the body (the aes128gcm header, then the
// encrypted record) of a message for sub, with the sender's ephemeral key and
// salt given (made at random by the caller; the test of the RFC gives them).
func encrypt(sub Subscription, plaintext []byte, ephemeral *ecdh.PrivateKey, salt []byte) ([]byte, error) {
	if len(plaintext) > maxPayload {
		return nil, fmt.Errorf("push: a message of %d bytes is over the %d that one record holds", len(plaintext), maxPayload)
	}
	if len(salt) != 16 {
		return nil, errors.New("push: the salt is not 16 bytes")
	}
	if !ValidKeys(sub.P256dh, sub.Auth) {
		return nil, errors.New("push: the subscription's keys are not valid")
	}
	uaPublic, err := ecdh.P256().NewPublicKey(sub.P256dh)
	if err != nil {
		return nil, errors.New("push: the subscription's key is not a P-256 point")
	}
	asPublic := ephemeral.PublicKey().Bytes()
	secret, err := ephemeral.ECDH(uaPublic)
	if err != nil {
		return nil, errors.New("push: the key agreement failed")
	}

	// RFC 8291 § 3.4: the input keying material mixes the secret, the auth
	// secret and both public keys; § 2.1 of RFC 8188: the content key and the
	// nonce come from it and the salt.
	prkKey, err := hkdf.Extract(sha256.New, secret, sub.Auth)
	if err != nil {
		return nil, err
	}
	info := make([]byte, 0, len("WebPush: info\x00")+len(sub.P256dh)+len(asPublic))
	info = append(info, "WebPush: info\x00"...)
	info = append(info, sub.P256dh...)
	info = append(info, asPublic...)
	ikm, err := hkdf.Expand(sha256.New, prkKey, string(info), 32)
	if err != nil {
		return nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, err
	}
	cek, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16)
	if err != nil {
		return nil, err
	}
	nonce, err := hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	// The data, then 0x02: the delimiter of the last record. No padding. The
	// nonce is the one of record 0 (the sequence number xor-ed in is zero): a
	// key and a nonce are used once, since each message has its own salt.
	record := make([]byte, 0, len(plaintext)+1)
	record = append(record, plaintext...)
	record = append(record, 0x02)

	body := make([]byte, 0, headerSize+len(record)+tagSize)
	body = append(body, salt...)
	body = binary.BigEndian.AppendUint32(body, recordSize)
	body = append(body, byte(len(asPublic)))
	body = append(body, asPublic...)
	return gcm.Seal(body, nonce, record, nil), nil
}

// What a Subscription says of itself: its host and nothing else. The endpoint
// is the capability to write to a device, and the keys are what reads the
// messages: a value passed to a log or an error must not carry them.

func (s Subscription) String() string {
	host := "invalid"
	if u, err := url.Parse(s.Endpoint); err == nil && u.Hostname() != "" && ldhHost(strings.ToLower(u.Hostname())) {
		host = strings.ToLower(u.Hostname())
	}
	return "push.Subscription{host " + host + "}"
}

func (s Subscription) GoString() string { return s.String() }

// Format answers every verb (%v, %+v, %#v, %s, %x, %d…) with String.
func (s Subscription) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(s.String())) }

func (s Subscription) MarshalJSON() ([]byte, error) { return json.Marshal(s.String()) }
func (s Subscription) MarshalText() ([]byte, error) { return []byte(s.String()), nil }
func (s Subscription) LogValue() slog.Value         { return slog.StringValue(s.String()) }
