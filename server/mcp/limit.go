package mcp

import (
	"sync"
	"time"
)

// The limit of the requests of a token (spec § 3.4): a bucket of 300 that fills
// again by 5 a second. A burst passes, and the average is bound to 300 a
// minute. PocketBase counts by address only: two assistants of two people
// behind the same box would share one limit.
const (
	burst       = 300
	refillRate  = 5 // requests a second
	idleTimeout = 10 * time.Minute
	// sweepEvery is how often the buckets that are idle are looked for.
	sweepEvery = time.Minute
)

// tokenLimiter allows 300 requests a minute per MCP token: a bucket of 300 that
// refills 5 a second, in memory, keyed by token id. A bucket idle for 10
// minutes is full again: it is dropped, and the token gets a new full one.
type tokenLimiter struct {
	mu        sync.Mutex
	buckets   map[string]*bucket
	now       func() time.Time
	lastSweep time.Time
}

// bucket is what a token may still send now, and when it was filled last.
type bucket struct {
	left float64
	at   time.Time
}

// newTokenLimiter returns a limiter that reads the time from now.
func newTokenLimiter(now func() time.Time) *tokenLimiter {
	return &tokenLimiter{buckets: map[string]*bucket{}, now: now}
}

// allow takes one request from the bucket of the token, and says whether there
// was one to take.
func (l *tokenLimiter) allow(tokenID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()

	at := l.now()
	l.sweep(at)

	b, ok := l.buckets[tokenID]
	if !ok {
		b = &bucket{left: burst, at: at}
		l.buckets[tokenID] = b
	}
	// A clock that goes back fills nothing: the bucket waits for the time it
	// was filled last.
	if elapsed := at.Sub(b.at); elapsed > 0 {
		b.left = min(burst, b.left+elapsed.Seconds()*refillRate)
		b.at = at
	}
	if b.left < 1 {
		return false
	}
	b.left--
	return true
}

// sweep drops the buckets that have been idle for idleTimeout, at most once a
// minute.
func (l *tokenLimiter) sweep(at time.Time) {
	if at.Sub(l.lastSweep) < sweepEvery {
		return
	}
	l.lastSweep = at
	for id, b := range l.buckets {
		if at.Sub(b.at) >= idleTimeout {
			delete(l.buckets, id)
		}
	}
}
