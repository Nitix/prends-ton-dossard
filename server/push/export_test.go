package push

import (
	"net"
	"sync"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"net/http"
	"time"
)

// The tests of the package are external ones: this file gives them the
// unexported pieces that they check, and a sender that talks to a test server.

var (
	Encrypt            = encrypt
	VapidAuthorization = vapidAuthorization
)

// MaxPayload is the longest message that one record holds.
const MaxPayload = maxPayload

// NewTestSender is the sender of NewSender, with its own client, timeout,
// redirect policy and transport (no proxy, no cookie jar), changed in three
// ways only, so that it can talk to a test server on 127.0.0.1: the
// allow-list is open, the transport trusts the certificate of the test server
// and dials as the client given does (the one of the test server, srv.Client()), and the dial guard that refuses
// private addresses is taken off. A non-zero timeout on the client given
// replaces the 10 s: the tests shorten it.
func NewTestSender(keys *Keys, contact string, client *http.Client, now func() time.Time) *Sender {
	s := NewSender(keys, contact)
	s.allowed = func(string) bool { return true }
	if now != nil {
		s.now = now
	}
	if client.Timeout != 0 {
		s.client.Timeout = client.Timeout
	}
	t := s.client.Transport.(*http.Transport)
	t.DialContext = (&net.Dialer{Timeout: sendTimeout}).DialContext
	if given, ok := client.Transport.(*http.Transport); ok {
		t.TLSClientConfig = given.TLSClientConfig.Clone()
		if given.DialContext != nil {
			t.DialContext = given.DialContext // a test that reaches its server for any host
		}
	}
	return s
}

// The seams of the tests of the real client.

// ClientOf is the HTTP client of a sender.
func ClientOf(s *Sender) *http.Client { return s.client }

// OpenAllowList lets the sender post to any address; its client is untouched.
func OpenAllowList(s *Sender) { s.allowed = func(string) bool { return true } }

// UseTransport replaces the transport of the sender: a test of the allow-list
// then sees no request leave, whatever a refusal that fails to happen would do.
func UseTransport(s *Sender, rt http.RoundTripper) { s.client.Transport = rt }

// PublicAddr is the dial guard's judgement.
var PublicAddr = publicAddr

// SendTimeout is the production timeout.
const SendTimeout = sendTimeout

// LoadOrCreateKeysUnlocked is LoadOrCreateKeys without the lock of the
// process: what two processes at once do to the file.
var LoadOrCreateKeysUnlocked = loadOrCreate

// Path is the collection of the routes.
const Path = path

// ServiceOf returns the service that Register made for app.
func ServiceOf(app core.App) *Service {
	registered.Lock()
	defer registered.Unlock()
	return registered.byApp[app]
}

var registered = struct {
	sync.Mutex
	byApp map[core.App]*Service
}{byApp: map[core.App]*Service{}}

func init() {
	afterRegister = func(app core.App, s *Service) {
		registered.Lock()
		defer registered.Unlock()
		registered.byApp[app] = s
	}
}

// UseClient makes the service send through client, whatever the endpoint, with
// the clock now (nil: the real one), as NewTestSender does.
func (s *Service) UseClient(client *http.Client, now func() time.Time) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.sender = nil
	s.newSender = func(keys *Keys) *Sender { return NewTestSender(keys, s.cfg.PushContact, client, now) }
}

// B64 writes bytes as the table keeps keys.
func B64(b []byte) string { return b64url.EncodeToString(b) }

// Load reads or makes the keys, as the first OnServe does.
func (s *Service) Load(app core.App) { s.load(app) }

// TestClock makes the limit of the test messages read now.
func (s *Service) TestClock(now func() time.Time) {
	s.tests.mu.Lock()
	defer s.tests.mu.Unlock()
	s.tests.now = now
}
