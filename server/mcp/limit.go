package mcp

import (
	"fmt"
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

// msgTooManyRequests is the refusal of a request beyond the bucket.
const msgTooManyRequests = "Trop de demandes pour ce jeton : attends quelques secondes avant de réessayer (300 par minute en moyenne)."

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

// maxInFlight is how many requests of a token may be under way at once. The
// bucket bounds the arrivals, not the work in flight: a request that turns out
// slow (a parse that waits for its place, say) would pile up behind the others,
// each with its body in memory. An assistant may run a few calls at once (Claude
// Code runs some tools side by side); beyond 4, a 429 asks it to wait a second.
const maxInFlight = 4

// msgTooManyUnderWay is the refusal of a request beyond maxInFlight.
var msgTooManyUnderWay = fmt.Sprintf("Ce jeton a déjà %d demandes en cours : attends la réponse de l'une d'elles avant d'en envoyer une autre.", maxInFlight)

// inFlight counts the requests under way of each MCP token, keyed by token id.
type inFlight struct {
	mu      sync.Mutex
	running map[string]int
}

func newInFlight() *inFlight {
	return &inFlight{running: map[string]int{}}
}

// enter takes a place for a request of the token, and says whether there was one.
// A request that enters leaves (leave), whatever comes of it.
func (f *inFlight) enter(tokenID string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.running[tokenID] >= maxInFlight {
		return false
	}
	f.running[tokenID]++
	return true
}

// leave gives back the place of a request of the token.
func (f *inFlight) leave(tokenID string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.running[tokenID]--; f.running[tokenID] <= 0 {
		delete(f.running, tokenID)
	}
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
