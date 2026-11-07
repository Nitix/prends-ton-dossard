package push_test

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"courses/server/push"
)

type recipient struct {
	private *ecdh.PrivateKey
	sub     push.Subscription
}

func newRecipient(t testing.TB, endpoint string) recipient {
	t.Helper()
	ua, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	auth := make([]byte, 16)
	rand.Read(auth)
	return recipient{ua, push.Subscription{Endpoint: endpoint, P256dh: ua.PublicKey().Bytes(), Auth: auth}}
}

func testKeys(t testing.TB) *push.Keys {
	t.Helper()
	k, err := push.LoadOrCreateKeys(filepath.Join(t.TempDir(), "k.json"))
	if err != nil {
		t.Fatal(err)
	}
	return k
}

var goodOpts = push.Options{TTL: 2 * time.Hour, Urgency: "high", Topic: "opening-abc123def456ghi"}

func TestSender_Outcomes(t *testing.T) {
	var mu sync.Mutex
	status := 201
	var requests atomic.Int32
	var last *http.Request
	var lastBody []byte
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		body, _ := io.ReadAll(r.Body)
		mu.Lock()
		last, lastBody = r, body
		code := status
		mu.Unlock()
		if code >= 300 && code < 400 {
			w.Header().Set("Location", "https://fcm.googleapis.com/elsewhere")
		}
		w.WriteHeader(code)
		io.WriteString(w, "detail of the push service")
	}))
	defer srv.Close()
	setStatus := func(c int) { mu.Lock(); status = c; mu.Unlock() }

	keys := testKeys(t)
	now := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	s := push.NewTestSender(keys, "mailto:admin@example.fr", srv.Client(), func() time.Time { return now })
	rcpt := newRecipient(t, srv.URL+"/wpush/v2/abcdefgh-endpoint-secret")
	payload := []byte(`{"title":"Ouverture","body":"Les inscriptions ouvrent","url":"/evenements/abc","tag":"opening-abc"}`)

	want := map[int]push.Outcome{
		200: push.Delivered, 201: push.Delivered, 202: push.Delivered,
		404: push.Gone, 410: push.Gone,
		400: push.Rejected, 401: push.Rejected, 403: push.Rejected, 413: push.Rejected,
		302: push.Rejected, 301: push.Rejected, 409: push.Rejected,
		429: push.Failed, 500: push.Failed, 502: push.Failed, 503: push.Failed,
	}
	for code, outcome := range want {
		t.Run(strconv.Itoa(code), func(t *testing.T) {
			setStatus(code)
			requests.Store(0)
			got, err := s.Send(context.Background(), rcpt.sub, payload, goodOpts)
			if err != nil {
				t.Fatalf("error: %v", err)
			}
			if got != outcome {
				t.Errorf("outcome %d, want %d", got, outcome)
			}
			if n := requests.Load(); n != 1 {
				t.Errorf("%d requests (a redirect must not be followed)", n)
			}
		})
	}

	// The request itself, once.
	setStatus(201)
	if out, err := s.Send(context.Background(), rcpt.sub, payload, goodOpts); err != nil || out != push.Delivered {
		t.Fatal(out, err)
	}
	mu.Lock()
	req, body := last, append([]byte(nil), lastBody...)
	mu.Unlock()
	h := req.Header
	if req.Method != http.MethodPost || req.URL.Path != "/wpush/v2/abcdefgh-endpoint-secret" {
		t.Errorf("%s %s", req.Method, req.URL.Path)
	}
	for k, v := range map[string]string{
		"Content-Encoding": "aes128gcm", "TTL": "7200", "Urgency": "high", "Topic": "opening-abc123def456ghi",
		"Content-Type": "application/octet-stream",
	} {
		if h.Get(k) != v {
			t.Errorf("%s = %q, want %q", k, h.Get(k), v)
		}
	}
	if !strings.HasPrefix(h.Get("Authorization"), "vapid t=") || !strings.HasSuffix(h.Get("Authorization"), ", k="+keys.PublicKey()) {
		t.Error("Authorization is not « vapid t=…, k=<public key> »")
	}
	if got := decrypt(t, rcpt.private, rcpt.sub.Auth, body); !bytes.Equal(got, payload) {
		t.Errorf("the body opens to %q", got)
	}

	// Without a topic or an urgency, no such header; two sends do not reuse a key or a salt.
	if _, err := s.Send(context.Background(), rcpt.sub, payload, push.Options{TTL: time.Minute}); err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	req2, body2 := last, append([]byte(nil), lastBody...)
	mu.Unlock()
	if req2.Header.Get("Topic") != "" || req2.Header.Get("Urgency") != "" || req2.Header.Get("TTL") != "60" {
		t.Errorf("headers: %v", req2.Header)
	}
	if bytes.Equal(body[:16], body2[:16]) || bytes.Equal(body[21:86], body2[21:86]) {
		t.Error("two messages share a salt or an ephemeral key")
	}
}

func TestSender_ErrorsNeverHoldTheEndpoint(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	client, url := srv.Client(), srv.URL
	srv.Close() // nothing answers: a network error
	rcpt := newRecipient(t, url+"/wpush/v2/the-secret-part-of-the-endpoint")
	s := push.NewTestSender(testKeys(t), "mailto:a@example.fr", client, nil)
	out, err := s.Send(context.Background(), rcpt.sub, []byte("x"), goodOpts)
	if out != push.Failed || err == nil {
		t.Fatalf("%v, %v", out, err)
	}
	for _, secret := range []string{"the-secret-part", url, strings.TrimPrefix(url, "https://")} {
		if strings.Contains(err.Error(), secret) {
			t.Errorf("the error holds %q…", secret[:8])
		}
	}
}

func TestSender_SlowServerFails(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer srv.Close()
	defer close(release)
	client := srv.Client()
	client.Timeout = 200 * time.Millisecond
	s := push.NewTestSender(testKeys(t), "mailto:a@example.fr", client, nil)
	rcpt := newRecipient(t, srv.URL+"/x")
	start := time.Now()
	out, err := s.Send(context.Background(), rcpt.sub, []byte("x"), goodOpts)
	if out != push.Failed || err == nil {
		t.Errorf("%v, %v", out, err)
	}
	if time.Since(start) > 5*time.Second {
		t.Error("the timeout was not applied")
	}
}

func TestSender_CancelledContextFails(t *testing.T) {
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {}))
	defer srv.Close()
	s := push.NewTestSender(testKeys(t), "mailto:a@example.fr", srv.Client(), nil)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	out, err := s.Send(ctx, newRecipient(t, srv.URL+"/x").sub, []byte("x"), goodOpts)
	if out != push.Failed || err == nil {
		t.Errorf("%v, %v", out, err)
	}
}

// What the sender refuses, it refuses before any request.
func TestSender_RefusesBeforeAnyRequest(t *testing.T) {
	var requests atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1) }))
	defer srv.Close()
	keys := testKeys(t)
	rcpt := newRecipient(t, srv.URL+"/x")

	// The real sender, with the allow-list: the address of a test server is on 127.0.0.1.
	real := push.NewSender(keys, "mailto:a@example.fr")
	out, err := real.Send(context.Background(), rcpt.sub, []byte("x"), goodOpts)
	if out != push.Rejected || err == nil {
		t.Errorf("an address off the list: %v, %v", out, err)
	}
	if err != nil && strings.Contains(err.Error(), "127.0.0.1") {
		t.Error("the error holds the address")
	}
	for _, e := range []string{"http://fcm.googleapis.com/x", "https://127.0.0.1/x", "https://localhost/x", "https://fcm.googleapis.com:8443/x", ""} {
		sub := rcpt.sub
		sub.Endpoint = e
		if out, err := real.Send(context.Background(), sub, []byte("x"), goodOpts); out != push.Rejected || err == nil {
			t.Errorf("%q: %v, %v", e, out, err)
		}
	}

	s := push.NewTestSender(keys, "mailto:a@example.fr", srv.Client(), nil)
	sub := func(p, a []byte) push.Subscription {
		return push.Subscription{Endpoint: rcpt.sub.Endpoint, P256dh: p, Auth: a}
	}
	bad := map[string]struct {
		sub     push.Subscription
		payload []byte
		opts    push.Options
	}{
		"a message over one record": {rcpt.sub, make([]byte, push.MaxPayload+1), goodOpts},
		"a short key":               {sub(rcpt.sub.P256dh[:10], rcpt.sub.Auth), []byte("x"), goodOpts},
		"a short auth":              {sub(rcpt.sub.P256dh, rcpt.sub.Auth[:3]), []byte("x"), goodOpts},
		"a TTL under a minute":      {rcpt.sub, []byte("x"), push.Options{TTL: 59 * time.Second}},
		"no TTL":                    {rcpt.sub, []byte("x"), push.Options{}},
		"an unknown urgency":        {rcpt.sub, []byte("x"), push.Options{TTL: time.Hour, Urgency: "low"}},
		"a topic of 33 characters":  {rcpt.sub, []byte("x"), push.Options{TTL: time.Hour, Topic: strings.Repeat("a", 33)}},
		"a topic with a space":      {rcpt.sub, []byte("x"), push.Options{TTL: time.Hour, Topic: "a b"}},
		"a topic with a line break": {rcpt.sub, []byte("x"), push.Options{TTL: time.Hour, Topic: "a\r\nX-Evil: 1"}},
	}
	for name, c := range bad {
		if out, err := s.Send(context.Background(), c.sub, c.payload, c.opts); err == nil {
			t.Errorf("%s: accepted (%v)", name, out)
		} else if out != push.Rejected {
			t.Errorf("%s: outcome %v, want Rejected", name, out)
		}
	}
	// 32 characters of the alphabet are fine.
	if out, err := s.Send(context.Background(), rcpt.sub, []byte("x"), push.Options{TTL: time.Hour, Topic: strings.Repeat("aZ_-", 8)}); err != nil || out != push.Delivered {
		t.Errorf("a topic of 32: %v, %v", out, err)
	}
	if n := requests.Load(); n != 1 {
		t.Errorf("%d requests, want only the last, good one", n)
	}
}
