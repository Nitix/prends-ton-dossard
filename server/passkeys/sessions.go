package passkeys

import (
	"crypto/rand"
	"sync"
	"time"

	"github.com/go-webauthn/webauthn/webauthn"
)

// Sessions keeps the WebAuthn ceremonies in progress, between their begin and
// their finish, in memory: the site runs as a single instance, and a ceremony
// that a restart loses is simply begun again.
type Sessions struct {
	ttl time.Duration
	now func() time.Time

	mu      sync.Mutex
	entries map[string]entry
}

type entry struct {
	data    webauthn.SessionData
	expires time.Time
}

// NewSessions returns an empty store whose sessions last ttl, on the clock now
// (time.Now outside the tests).
func NewSessions(ttl time.Duration, now func() time.Time) *Sessions {
	return &Sessions{ttl: ttl, now: now, entries: map[string]entry{}}
}

// Put keeps d and returns the id to take it back with: 128 random bits, which
// only the browser that began the ceremony knows.
func (s *Sessions) Put(d webauthn.SessionData) (id string) {
	id = rand.Text()
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()

	// The ceremonies that nobody finishes go when the next one begins.
	for key, e := range s.entries {
		if !now.Before(e.expires) {
			delete(s.entries, key)
		}
	}
	s.entries[id] = entry{data: d, expires: now.Add(s.ttl)}
	return id
}

// Take returns the session kept under id and forgets it, so that a challenge
// is answered once at most. It returns false when there is no such session or
// when it has expired.
func (s *Sessions) Take(id string) (webauthn.SessionData, bool) {
	now := s.now()

	s.mu.Lock()
	defer s.mu.Unlock()

	e, ok := s.entries[id]
	if !ok {
		return webauthn.SessionData{}, false
	}
	delete(s.entries, id)
	if !now.Before(e.expires) {
		return webauthn.SessionData{}, false
	}
	return e.data, true
}
