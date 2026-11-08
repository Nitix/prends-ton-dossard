package push

import (
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/asn1"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"
)

var b64url = base64.RawURLEncoding

// Keys is the VAPID key pair of the site (P-256). It prints as its public key
// only, whatever the verb or the encoder: the private key has no way out.
type Keys struct {
	private *ecdsa.PrivateKey
	public  string // the uncompressed point, base64url
}

// keyFile is the file of the keys. Every value is base64url, except created.
type keyFile struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
	Created    string `json:"created"`
}

// LoadOrCreateKeys reads the key pair from path, a JSON file
// {"publicKey","privateKey","created"} (base64url, created RFC 3339). When the
// file does not exist, it makes a pair and writes it with mode 0600
// (atomically: a temp file, then a rename). When it exists and cannot be read
// or holds no valid pair, it returns an error and leaves the file alone: it is
// never replaced.
func LoadOrCreateKeys(path string) (*Keys, error) {
	createMu.Lock()
	defer createMu.Unlock()
	return loadOrCreate(path)
}

// createMu keeps two callers of this process from making a pair at once. Two
// processes are kept apart by publishExclusive, which never replaces a file.
var createMu sync.Mutex

func loadOrCreate(path string) (*Keys, error) {
	raw, err := os.ReadFile(path)
	switch {
	case err == nil:
		return parseKeys(raw)
	case errors.Is(err, fs.ErrNotExist):
		return createKeys(path)
	default:
		return nil, fmt.Errorf("push: the VAPID key file cannot be read: %w", unwrapPathError(err))
	}
}

// unwrapPathError drops the path of an *fs.PathError: the cause is enough.
func unwrapPathError(err error) error {
	var pe *fs.PathError
	if errors.As(err, &pe) {
		return pe.Err
	}
	var le *os.LinkError
	if errors.As(err, &le) {
		return le.Err
	}
	return err
}

func parseKeys(raw []byte) (*Keys, error) {
	var f keyFile
	if err := json.Unmarshal(raw, &f); err != nil {
		// The error of the decoder can quote the text it choked on: not here.
		return nil, errors.New("push: the VAPID key file is not valid JSON")
	}
	d, err := b64url.DecodeString(f.PrivateKey)
	if err != nil || len(d) != 32 {
		return nil, errors.New("push: the VAPID key file holds no valid private key")
	}
	ecKey, err := ecdh.P256().NewPrivateKey(d) // refuses zero and a value over the order
	if err != nil {
		return nil, errors.New("push: the VAPID key file holds no valid private key")
	}
	if f.PublicKey != b64url.EncodeToString(ecKey.PublicKey().Bytes()) {
		return nil, errors.New("push: the public key of the VAPID key file is not that of its private key")
	}
	priv, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), d)
	if err != nil {
		return nil, errors.New("push: the VAPID key file holds no valid private key")
	}
	return &Keys{private: priv, public: f.PublicKey}, nil
}

func createKeys(path string) (*Keys, error) {
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("push: the VAPID keys cannot be made: %w", err)
	}
	d, err := priv.Bytes()
	if err != nil {
		return nil, fmt.Errorf("push: the VAPID keys cannot be made: %w", err)
	}
	pub, err := priv.PublicKey.Bytes()
	if err != nil {
		return nil, fmt.Errorf("push: the VAPID keys cannot be made: %w", err)
	}
	k := &Keys{private: priv, public: b64url.EncodeToString(pub)}
	content, err := json.MarshalIndent(keyFile{
		PublicKey:  k.public,
		PrivateKey: b64url.EncodeToString(d),
		Created:    time.Now().UTC().Format(time.RFC3339),
	}, "", "  ")
	if err != nil {
		return nil, err
	}
	switch err := publishExclusive(path, append(content, '\n')); {
	case errors.Is(err, fs.ErrExist):
		// Another process made its pair first: its file is the one, read it back.
		raw, rerr := os.ReadFile(path)
		if rerr != nil {
			return nil, fmt.Errorf("push: the VAPID key file cannot be read: %w", unwrapPathError(rerr))
		}
		return parseKeys(raw)
	case err != nil:
		return nil, fmt.Errorf("push: the VAPID key file cannot be written: %w", unwrapPathError(err))
	}
	return k, nil
}

// publishExclusive writes content to a temp file of the directory (mode 0600 from
// the start: CreateTemp makes it so) and links it to path, so that a crash
// leaves either no file or a whole one, never half of the keys, and so that a
// file already at path is never replaced: Link fails with fs.ErrExist instead
// (a rename would replace it). The directory is then synced, so that the entry
// survives a crash; that is best effort, and not possible on Windows.
func publishExclusive(path string, content []byte) (err error) {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".push_vapid-*.tmp")
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()
	if err = tmp.Chmod(0o600); err != nil && !errors.Is(err, errors.ErrUnsupported) {
		// Windows keeps no mode: Chmod there only toggles read-only and works.
		return err
	}
	if _, err = tmp.Write(content); err != nil {
		return err
	}
	if err = tmp.Sync(); err != nil {
		return err
	}
	if err = tmp.Close(); err != nil {
		return err
	}
	if err = os.Link(tmp.Name(), path); err != nil {
		return err
	}
	_ = os.Remove(tmp.Name())
	syncDir(dir)
	return nil
}

func syncDir(dir string) {
	if runtime.GOOS == "windows" {
		return
	}
	if d, err := os.Open(dir); err == nil {
		_ = d.Sync()
		_ = d.Close()
	}
}

// PublicKey is the applicationServerKey of the browsers: the uncompressed
// point, base64url.
func (k *Keys) PublicKey() string { return k.public }

// sign is ES256 (RFC 7518 § 3.4): the 64 bytes r‖s of the signature of the
// SHA-256 of message.
func (k *Keys) sign(message []byte) ([]byte, error) {
	digest := sha256.Sum256(message)
	der, err := ecdsa.SignASN1(rand.Reader, k.private, digest[:])
	if err != nil {
		return nil, err
	}
	var sig struct{ R, S *big.Int }
	if rest, err := asn1.Unmarshal(der, &sig); err != nil || len(rest) != 0 {
		return nil, errors.New("push: unexpected signature encoding")
	}
	out := make([]byte, 64)
	sig.R.FillBytes(out[:32])
	sig.S.FillBytes(out[32:])
	return out, nil
}

// What Keys says of itself, in every way a value gets printed or encoded.

func (k Keys) String() string   { return "push.Keys{public " + k.public + "}" }
func (k Keys) GoString() string { return k.String() }

// Format answers every verb (%v, %+v, %#v, %s, %x, %d…) with String.
func (k Keys) Format(f fmt.State, _ rune) { _, _ = f.Write([]byte(k.String())) }

func (k Keys) MarshalJSON() ([]byte, error) { return json.Marshal(k.String()) }
func (k Keys) MarshalText() ([]byte, error) { return []byte(k.String()), nil }
func (k Keys) LogValue() slog.Value         { return slog.StringValue(k.String()) }
