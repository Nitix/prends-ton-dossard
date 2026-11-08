package push_test

import (
	"bytes"
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/netip"
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
			w.Header().Set("Location", "https://"+r.Host+"/elsewhere")
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
	counting := &countingRT{}
	push.UseTransport(real, counting) // a refusal that failed to happen would reach no real host
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
	if counting.n.Load() != 0 {
		t.Errorf("%d requests left the real sender, want none", counting.n.Load())
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

// countingRT counts the requests it is given and fails them all: it stands in
// for the network where a test must not be able to reach a real push host.
type countingRT struct{ n atomic.Int32 }

func (c *countingRT) RoundTrip(*http.Request) (*http.Response, error) {
	c.n.Add(1)
	return nil, errors.New("no network in tests")
}

// The client of the production sender, as NewSender makes it: each of its
// protections is asserted, since a sender built another way would lose it
// without any other test noticing.
func TestSender_ProductionClient(t *testing.T) {
	c := push.ClientOf(push.NewSender(testKeys(t), "mailto:a@example.fr"))
	if c.Timeout != 10*time.Second || push.SendTimeout != 10*time.Second {
		t.Errorf("timeout %v, want 10s", c.Timeout)
	}
	if c.CheckRedirect == nil {
		t.Fatal("no redirect policy")
	}
	if err := c.CheckRedirect(&http.Request{}, nil); !errors.Is(err, http.ErrUseLastResponse) {
		t.Errorf("a redirect is followed: %v", err)
	}
	if c.Jar != nil {
		t.Error("the client keeps cookies")
	}
	tr, ok := c.Transport.(*http.Transport)
	if !ok {
		t.Fatalf("transport %T", c.Transport)
	}
	if tr.Proxy != nil {
		t.Error("the transport uses a proxy")
	}
	if tr.DialContext == nil {
		t.Error("the transport has no guarded dialer")
	}
}

// The real transport refuses to connect to a private address, whatever the
// allow-list was made to say: a listener there sees no connection at all.
func TestSender_RealTransportRefusesPrivateAddresses(t *testing.T) {
	var hits atomic.Int32
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer srv.Close()
	_, port, _ := net.SplitHostPort(strings.TrimPrefix(srv.URL, "https://"))

	s := push.NewSender(testKeys(t), "mailto:a@example.fr")
	push.OpenAllowList(s)
	for _, host := range []string{"127.0.0.1", "localhost", "[::1]"} {
		rcpt := newRecipient(t, "https://"+host+":"+port+"/wpush/secret-path")
		out, err := s.Send(context.Background(), rcpt.sub, []byte("x"), goodOpts)
		if out != push.Failed || err == nil {
			t.Errorf("%s: %v, %v", host, out, err)
			continue
		}
		if !strings.Contains(err.Error(), "not a public one") {
			t.Errorf("%s: the refusal is not the dial guard's: %v", host, err)
		}
		for _, leak := range []string{"127.0.0.1", "secret-path", port} {
			if strings.Contains(err.Error(), leak) {
				t.Errorf("%s: the error holds %q", host, leak)
			}
		}
	}
	if n := hits.Load(); n != 0 {
		t.Errorf("the listener got %d hits", n)
	}
}

func TestSender_PublicAddr(t *testing.T) {
	public := []string{
		"8.8.8.8", "1.1.1.1", "142.250.74.14", "17.253.144.10", "100.63.255.255", "100.128.0.0",
		"172.15.255.255", "172.32.0.0", "198.17.255.255", "198.20.0.0", "223.255.255.255",
		"2a00:1450:4007:80d::200e", "2606:4700:4700::1111", "2620:149:a44::1",
		"::ffff:8.8.8.8",   // mapped: judged by the IPv4 inside
		"64:ff9b::808:808", // NAT64 of 8.8.8.8
		"::808:808",        // IPv4-compatible of 8.8.8.8
	}
	private := []string{
		"0.0.0.0", "0.1.2.3", "10.0.0.1", "10.255.255.255", "100.64.0.0", "100.100.100.200", "100.127.255.255",
		"127.0.0.1", "127.255.255.254", "169.254.169.254", "169.254.0.1", "172.16.0.1", "172.31.255.255",
		"192.0.0.1", "192.0.2.1", "192.168.0.1", "192.168.255.255", "198.18.0.1", "198.19.255.255",
		"198.51.100.1", "203.0.113.1", "224.0.0.1", "239.255.255.255", "240.0.0.1", "255.255.255.255",
		"::", "::1", "fe80::1", "fec0::1", "fc00::1", "fd12:3456::1", "ff02::1",
		"2001:db8::1", "2001::1", "2002:7f00:1::", "2002:808:808::",
		"::ffff:127.0.0.1", "::ffff:10.0.0.1", "::ffff:169.254.169.254", "::ffff:100.64.0.1",
		"::7f00:1", "::a00:1", "::1:2",
		"64:ff9b::7f00:1", "64:ff9b::a00:1", "64:ff9b::a9fe:a9fe",
		"64:ff9b:1::1", // local-use NAT64: outside 2000::/3
	}
	for _, s := range public {
		if !push.PublicAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s refused", s)
		}
	}
	for _, s := range private {
		if push.PublicAddr(netip.MustParseAddr(s)) {
			t.Errorf("%s allowed", s)
		}
	}
	if push.PublicAddr(netip.Addr{}) {
		t.Error("the zero address is allowed")
	}
}
