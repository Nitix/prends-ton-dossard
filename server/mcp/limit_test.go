package mcp_test

import (
	"testing"
	"time"

	"courses/server/mcp"
)

// clock is a clock that a test moves.
type clock struct{ at time.Time }

func (c *clock) now() time.Time           { return c.at }
func (c *clock) advance(by time.Duration) { c.at = c.at.Add(by) }

func newClock() *clock {
	return &clock{at: time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)}
}

// allowed counts how many of n requests of token the limiter lets through.
func allowed(l *mcp.TokenLimiter, token string, n int) int {
	count := 0
	for range n {
		if l.Allow(token) {
			count++
		}
	}
	return count
}

func TestTokenLimiter_ABurstOf300(t *testing.T) {
	c := newClock()
	l := mcp.NewTokenLimiter(c.now)

	if got := allowed(l, "alice", 301); got != 300 {
		t.Errorf("%d of 301 requests at once pass, want 300", got)
	}
	if got := allowed(l, "bob", 300); got != 300 {
		t.Errorf("another token: %d of 300 pass, want 300", got)
	}
}

func TestTokenLimiter_RefillsBy5ASecond(t *testing.T) {
	c := newClock()
	l := mcp.NewTokenLimiter(c.now)
	allowed(l, "alice", 300)

	c.advance(time.Second)
	if got := allowed(l, "alice", 6); got != 5 {
		t.Errorf("a second later, %d of 6 pass, want 5", got)
	}
	c.advance(200 * time.Millisecond)
	if got := allowed(l, "alice", 2); got != 1 {
		t.Errorf("a fifth of a second later, %d of 2 pass, want 1", got)
	}

	// 300 a minute on average: after a minute, the bucket is full, no more.
	// (Less than the 10 minutes after which an idle bucket goes.)
	c.advance(5 * time.Minute)
	if got := allowed(l, "alice", 301); got != 300 {
		t.Errorf("after 5 minutes, %d of 301 pass, want 300", got)
	}
}

// A clock that goes back gives nothing more.
func TestTokenLimiter_ClockGoingBack(t *testing.T) {
	c := newClock()
	l := mcp.NewTokenLimiter(c.now)
	allowed(l, "alice", 300)

	c.advance(-time.Minute)
	if got := allowed(l, "alice", 1); got != 0 {
		t.Errorf("a minute back in time, %d pass, want 0", got)
	}
	c.advance(time.Minute + time.Second)
	if got := allowed(l, "alice", 6); got != 5 {
		t.Errorf("a second after the last request, %d of 6 pass, want 5", got)
	}
}

// The buckets of the tokens that are not used any more go: 10 minutes idle.
func TestTokenLimiter_DropsIdleBuckets(t *testing.T) {
	c := newClock()
	l := mcp.NewTokenLimiter(c.now)
	allowed(l, "alice", 1)
	allowed(l, "bob", 1)
	if got := l.Len(); got != 2 {
		t.Fatalf("%d buckets, want 2", got)
	}

	c.advance(9 * time.Minute)
	allowed(l, "bob", 1)
	if got := l.Len(); got != 2 {
		t.Errorf("after 9 minutes, %d buckets, want 2", got)
	}

	c.advance(time.Minute)
	allowed(l, "carol", 1)
	if got := l.Len(); got != 2 {
		t.Errorf("Alice idle for 10 minutes: %d buckets, want Bob's and Carol's", got)
	}
	// A dropped bucket was full: the token starts again with a full one.
	if got := allowed(l, "alice", 301); got != 300 {
		t.Errorf("Alice again: %d of 301 pass, want 300", got)
	}
}
