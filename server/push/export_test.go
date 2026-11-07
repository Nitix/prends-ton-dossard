package push

import (
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

// NewTestSender is a sender that posts to any address (a test server is on
// 127.0.0.1), with the given client (the one of the test server, so that it
// trusts its certificate) and clock. Redirects are still not followed, and the
// timeout is the one of the client given: the tests shorten it.
func NewTestSender(keys *Keys, contact string, client *http.Client, now func() time.Time) *Sender {
	c := *client
	c.CheckRedirect = noRedirect
	s := NewSender(keys, contact)
	s.client = &c
	s.allowed = func(string) bool { return true }
	if now != nil {
		s.now = now
	}
	return s
}

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
