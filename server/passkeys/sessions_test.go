package passkeys_test

import (
	"testing"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"

	"courses/server/passkeys"
)

// clock is a time that the tests move by hand.
type clock struct{ now time.Time }

func (c *clock) Now() time.Time          { return c.now }
func (c *clock) Advance(d time.Duration) { c.now = c.now.Add(d) }

func newClock() *clock {
	return &clock{now: time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)}
}

func TestSessions_TakeIsSingleUse(t *testing.T) {
	c := newClock()
	s := passkeys.NewSessions(5*time.Minute, c.Now)

	id := s.Put(webauthn.SessionData{Challenge: "challenge-1"})
	if id == "" {
		t.Fatal("Put returned an empty id")
	}

	got, ok := s.Take(id)
	if !ok {
		t.Fatal("first Take = false, want true")
	}
	if got.Challenge != "challenge-1" {
		t.Errorf("Take returned the challenge %q, want challenge-1", got.Challenge)
	}

	if _, ok := s.Take(id); ok {
		t.Error("second Take = true, want false: a challenge is used once")
	}
}

func TestSessions_Expire(t *testing.T) {
	c := newClock()
	s := passkeys.NewSessions(5*time.Minute, c.Now)

	id := s.Put(webauthn.SessionData{Challenge: "challenge-1"})
	c.Advance(6 * time.Minute)

	if _, ok := s.Take(id); ok {
		t.Error("Take after 6 minutes = true, want false")
	}
}

func TestSessions_ValidUntilTTL(t *testing.T) {
	c := newClock()
	s := passkeys.NewSessions(5*time.Minute, c.Now)

	id := s.Put(webauthn.SessionData{Challenge: "challenge-1"})
	c.Advance(4*time.Minute + 59*time.Second)

	if _, ok := s.Take(id); !ok {
		t.Error("Take before the 5 minutes = false, want true")
	}
}

func TestSessions_UnknownAndDistinctIDs(t *testing.T) {
	s := passkeys.NewSessions(5*time.Minute, newClock().Now)

	if _, ok := s.Take(""); ok {
		t.Error(`Take("") = true, want false`)
	}
	if _, ok := s.Take("unknown"); ok {
		t.Error(`Take("unknown") = true, want false`)
	}

	first := s.Put(webauthn.SessionData{Challenge: "a"})
	second := s.Put(webauthn.SessionData{Challenge: "b"})
	if first == second {
		t.Fatal("two sessions got the same id")
	}
	if got, _ := s.Take(second); got.Challenge != "b" {
		t.Errorf("Take(second) returned %q, want b", got.Challenge)
	}
	if got, _ := s.Take(first); got.Challenge != "a" {
		t.Errorf("Take(first) returned %q, want a", got.Challenge)
	}
}

// An expired session is dropped by the next Put, so that the challenges that
// nobody finishes do not pile up in memory.
func TestSessions_PutDropsExpired(t *testing.T) {
	c := newClock()
	s := passkeys.NewSessions(5*time.Minute, c.Now)

	for range 10 {
		s.Put(webauthn.SessionData{Challenge: "old"})
	}
	c.Advance(6 * time.Minute)
	s.Put(webauthn.SessionData{Challenge: "new"})

	if got := s.Len(); got != 1 {
		t.Errorf("%d sessions kept, want 1", got)
	}
}
