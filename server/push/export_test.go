package push

import (
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
