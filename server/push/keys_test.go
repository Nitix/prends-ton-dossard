package push_test

import (
	"bytes"
	"crypto/ecdh"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log/slog"
	"math/big"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"

	"courses/server/push"
)

type keyFile struct {
	PublicKey  string `json:"publicKey"`
	PrivateKey string `json:"privateKey"`
	Created    string `json:"created"`
}

func readKeyFile(t testing.TB, path string) keyFile {
	t.Helper()
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var f keyFile
	if err := json.Unmarshal(raw, &f); err != nil {
		t.Fatal(err)
	}
	return f
}

func TestKeys_CreatedOnceAndKept(t *testing.T) {
	path := filepath.Join(t.TempDir(), "push_vapid.json")

	k1, err := push.LoadOrCreateKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	f := readKeyFile(t, path)
	if f.PublicKey != k1.PublicKey() {
		t.Error("the file does not hold the public key that the keys give")
	}
	pub := b64(t, k1.PublicKey())
	if len(pub) != 65 || pub[0] != 4 {
		t.Errorf("the public key is %d bytes, first %d: want an uncompressed point", len(pub), pub[0])
	}
	if _, err := ecdh.P256().NewPublicKey(pub); err != nil {
		t.Errorf("the public key is not a P-256 point: %v", err)
	}
	if len(b64(t, f.PrivateKey)) != 32 {
		t.Error("the private key is not 32 bytes")
	}
	created, err := time.Parse(time.RFC3339, f.Created)
	if err != nil || time.Since(created) > time.Minute || time.Until(created) > time.Minute {
		t.Errorf("created = %q (%v)", f.Created, err)
	}
	if runtime.GOOS != "windows" {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Errorf("mode %v, want 0600", info.Mode().Perm())
		}
	}
	// No temp file stays beside it.
	entries, _ := os.ReadDir(filepath.Dir(path))
	if len(entries) != 1 {
		t.Errorf("the directory holds %d entries, want only the file", len(entries))
	}

	before, _ := os.ReadFile(path)
	k2, err := push.LoadOrCreateKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	if k2.PublicKey() != k1.PublicKey() {
		t.Error("a second load gave another pair")
	}
	if after, _ := os.ReadFile(path); !bytes.Equal(before, after) {
		t.Error("a second load rewrote the file")
	}

	t.Run("an unusable file is never replaced", unusableFilesAreNeverReplaced)
}

// unusableFilesAreNeverReplaced is the second half of TestKeys_CreatedOnceAndKept:
// a file that is there and cannot be used is an error, and stays as it is.
func unusableFilesAreNeverReplaced(t *testing.T) {
	newFile := func() keyFile {
		p := filepath.Join(t.TempDir(), "k.json")
		if _, err := push.LoadOrCreateKeys(p); err != nil {
			t.Fatal(err)
		}
		return readKeyFile(t, p)
	}
	valid, other := newFile(), newFile()

	marshal := func(f keyFile) string { b, _ := json.Marshal(f); return string(b) }
	enc := base64.RawURLEncoding.EncodeToString
	cases := map[string]string{
		"garbage":                    "this is not json \x00\xff",
		"empty":                      "",
		"an empty object":            "{}",
		"null":                       "null",
		"no private key":             marshal(keyFile{PublicKey: valid.PublicKey, Created: valid.Created}),
		"private key too short":      marshal(keyFile{PublicKey: valid.PublicKey, PrivateKey: enc(make([]byte, 31)), Created: valid.Created}),
		"private key of zeros":       marshal(keyFile{PublicKey: valid.PublicKey, PrivateKey: enc(make([]byte, 32)), Created: valid.Created}),
		"private key not base64":     marshal(keyFile{PublicKey: valid.PublicKey, PrivateKey: "***", Created: valid.Created}),
		"public key of another":      marshal(keyFile{PublicKey: other.PublicKey, PrivateKey: valid.PrivateKey, Created: valid.Created}),
		"public key off the curve":   marshal(keyFile{PublicKey: enc(append([]byte{4}, make([]byte, 64)...)), PrivateKey: valid.PrivateKey, Created: valid.Created}),
		"private key over the order": marshal(keyFile{PublicKey: valid.PublicKey, PrivateKey: enc(bytes.Repeat([]byte{0xff}, 32)), Created: valid.Created}),
	}
	for name, content := range cases {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "push_vapid.json")
			if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
				t.Fatal(err)
			}
			k, err := push.LoadOrCreateKeys(path)
			if err == nil || k != nil {
				t.Fatalf("an unusable file was accepted: %v, %v", k, err)
			}
			if after, _ := os.ReadFile(path); string(after) != content {
				t.Error("the file was changed")
			}
			// The error never holds the private key.
			if strings.Contains(err.Error(), valid.PrivateKey[:12]) {
				t.Error("the error holds the private key")
			}
			entries, _ := os.ReadDir(filepath.Dir(path))
			if len(entries) != 1 {
				t.Errorf("the directory holds %d entries, want only the file", len(entries))
			}
		})
	}
}

func TestKeys_UnreadableLocation(t *testing.T) {
	// The path is a directory: it exists and cannot be read as a file.
	dir := t.TempDir()
	if k, err := push.LoadOrCreateKeys(dir); err == nil || k != nil {
		t.Errorf("a directory gave %v, %v", k, err)
	}
	if _, err := os.Stat(dir); err != nil {
		t.Error("the directory is gone")
	}
}

func TestKeys_NeverLeave(t *testing.T) {
	path := filepath.Join(t.TempDir(), "push_vapid.json")
	k, err := push.LoadOrCreateKeys(path)
	if err != nil {
		t.Fatal(err)
	}
	f := readKeyFile(t, path)
	d := b64(t, f.PrivateKey)
	secrets := []string{
		f.PrivateKey,
		fmt.Sprintf("%x", d),
		fmt.Sprintf("%X", d),
		new(big.Int).SetBytes(d).String(),
		fmt.Sprintf("%v", d),
		base64.StdEncoding.EncodeToString(d),
	}
	jb, _ := json.Marshal(k)
	jv, _ := json.Marshal(*k)
	jm, _ := json.Marshal(map[string]any{"keys": k})
	jbi, _ := json.MarshalIndent(k, "", " ")
	var logs bytes.Buffer
	logger := slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug}))
	logger.Debug("keys", "k", k, "v", *k)
	logger.Debug("keys", slog.Any("k", k))
	slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})).Debug("keys", "k", k)

	outputs := map[string]string{
		"Sprint":        fmt.Sprint(k),
		"Sprint value":  fmt.Sprint(*k),
		"%v":            fmt.Sprintf("%v", k),
		"%+v":           fmt.Sprintf("%+v", k),
		"%#v":           fmt.Sprintf("%#v", k),
		"%+v value":     fmt.Sprintf("%+v", *k),
		"%#v value":     fmt.Sprintf("%#v", *k),
		"%s":            fmt.Sprintf("%s", k),
		"%x":            fmt.Sprintf("%x", k),
		"%d":            fmt.Sprintf("%d", k),
		"%q":            fmt.Sprintf("%q", k),
		"collections":   fmt.Sprintf("%v %+v", []*push.Keys{k}, map[string]*push.Keys{"a": k}),
		"json":          string(jb),
		"json value":    string(jv),
		"json in a map": string(jm),
		"json indented": string(jbi),
		"slog":          logs.String(),
		"error wrap":    fmt.Errorf("x: %v", k).Error(),
	}
	for name, out := range outputs {
		for _, s := range secrets {
			if strings.Contains(out, s) {
				t.Errorf("%s holds the private key (%d bytes of output)", name, len(out))
			}
		}
		if out == "" {
			t.Errorf("%s is empty", name)
		}
	}
	if got := fmt.Sprint(k); !strings.HasPrefix(got, "push.Keys{public ") {
		t.Errorf("Sprint = %q, want push.Keys{public …}", got)
	}
	if got := fmt.Sprintf("%#v", k); !strings.HasPrefix(got, "push.Keys{public ") {
		t.Errorf("%%#v = %q", got)
	}
}

// Two callers at once, in one process (the lock) and in two (the unlocked
// function stands in for a second process: only the exclusive publication keeps
// them apart): every one of them ends with the pair that is on disk.
func TestKeys_ConcurrentFirstCreation(t *testing.T) {
	for name, load := range map[string]func(string) (*push.Keys, error){
		"one process":   push.LoadOrCreateKeys,
		"two processes": push.LoadOrCreateKeysUnlocked,
	} {
		t.Run(name, func(t *testing.T) {
			for round := 0; round < 30; round++ {
				path := filepath.Join(t.TempDir(), "push_vapid.json")
				const callers = 8
				got := make([]string, callers)
				var wg sync.WaitGroup
				start := make(chan struct{})
				for i := range got {
					wg.Add(1)
					go func() {
						defer wg.Done()
						<-start
						k, err := load(path)
						if err != nil {
							t.Error(err)
							return
						}
						got[i] = k.PublicKey()
					}()
				}
				close(start)
				wg.Wait()
				onDisk := readKeyFile(t, path).PublicKey
				for i, pub := range got {
					if pub != onDisk {
						t.Fatalf("round %d: caller %d holds a pair that is not the one on disk", round, i)
					}
				}
				entries, _ := os.ReadDir(filepath.Dir(path))
				if len(entries) != 1 {
					t.Fatalf("round %d: %d entries, want only the file", round, len(entries))
				}
			}
		})
	}
}

func TestSubscription_NeverLeaves(t *testing.T) {
	rcpt := newRecipient(t, "https://fcm.googleapis.com/fcm/send/endpoint-token-APA91bSECRET")
	sub := rcpt.sub
	secrets := []string{
		"endpoint-token", "APA91bSECRET", "/fcm/send",
		push.B64(sub.P256dh), push.B64(sub.Auth),
		fmt.Sprintf("%x", sub.P256dh), fmt.Sprintf("%x", sub.Auth),
		fmt.Sprintf("%X", sub.P256dh), fmt.Sprintf("%X", sub.Auth),
		base64.StdEncoding.EncodeToString(sub.P256dh), base64.StdEncoding.EncodeToString(sub.Auth),
		fmt.Sprintf("%v", sub.Auth), fmt.Sprintf("%v", sub.P256dh),
	}
	jb, _ := json.Marshal(sub)
	jp, _ := json.Marshal(&sub)
	jm, _ := json.Marshal(map[string]any{"sub": sub, "list": []push.Subscription{sub}})
	var logs bytes.Buffer
	slog.New(slog.NewJSONHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})).Debug("send", "sub", sub, "p", &sub)
	slog.New(slog.NewTextHandler(&logs, &slog.HandlerOptions{Level: slog.LevelDebug})).Debug("send", "sub", sub)
	outputs := map[string]string{
		"Sprint": fmt.Sprint(sub), "Sprint pointer": fmt.Sprint(&sub),
		"%v": fmt.Sprintf("%v", sub), "%+v": fmt.Sprintf("%+v", sub), "%#v": fmt.Sprintf("%#v", sub),
		"%+v pointer": fmt.Sprintf("%+v", &sub), "%s": fmt.Sprintf("%s", sub), "%x": fmt.Sprintf("%x", sub),
		"%d": fmt.Sprintf("%d", sub), "%q": fmt.Sprintf("%q", sub),
		"collections": fmt.Sprintf("%v %+v", []push.Subscription{sub}, map[string]push.Subscription{"a": sub}),
		"json":        string(jb), "json pointer": string(jp), "json nested": string(jm), "slog": logs.String(),
		"error wrap": fmt.Errorf("x: %v", sub).Error(),
	}
	for name, out := range outputs {
		if out == "" {
			t.Errorf("%s is empty", name)
		}
		for _, s := range secrets {
			if strings.Contains(out, s) {
				t.Errorf("%s holds a secret of the subscription", name)
			}
		}
		if !strings.Contains(out, "fcm.googleapis.com") {
			t.Errorf("%s does not name the host", name)
		}
	}
	if got := fmt.Sprint(sub); got != "push.Subscription{host fcm.googleapis.com}" {
		t.Errorf("Sprint = %q", got)
	}
	if got := fmt.Sprint(push.Subscription{Endpoint: "https://evil.test\n/x"}); strings.Contains(got, "evil") {
		t.Errorf("an invalid endpoint is printed: %q", got)
	}
}
