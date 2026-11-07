package weather

import (
	"context"
	"sync"
	"time"
)

// The lives of what is kept.
const (
	forecastTTL   = time.Hour
	forecastStale = 6 * time.Hour
	placeTTL      = 30 * 24 * time.Hour
	notFoundTTL   = 24 * time.Hour
	cacheMax      = 500
)

// now is the clock, replaced in the tests.
var now = time.Now

// entry is a value kept, when it was made and until when it is fresh. A zero
// expiry is a value that never expires.
type entry[V any] struct {
	value   V
	at      time.Time
	expires time.Time
}

func (e entry[V]) fresh() bool { return e.expires.IsZero() || now().Before(e.expires) }

// cache is a bounded in-memory map: past max entries, the oldest goes. Values
// are not removed when they expire (a stale forecast is still served when the
// service fails): the bound and the age limit of the reader do that.
type cache[V any] struct {
	max   int
	mu    sync.Mutex
	items map[string]entry[V]
	order []string // the keys, the oldest first

	locks keyLocks
}

func newCache[V any](max int) *cache[V] {
	return &cache[V]{max: max, items: map[string]entry[V]{}}
}

func (c *cache[V]) get(key string) (entry[V], bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.items[key]
	return e, ok
}

// put keeps value under key for ttl (zero: always).
func (c *cache[V]) put(key string, value V, ttl time.Duration) entry[V] {
	c.mu.Lock()
	defer c.mu.Unlock()
	e := entry[V]{value: value, at: now()}
	if ttl > 0 {
		e.expires = e.at.Add(ttl)
	}
	if _, there := c.items[key]; there {
		for i, k := range c.order {
			if k == key {
				c.order = append(c.order[:i], c.order[i+1:]...)
				break
			}
		}
	}
	c.items[key] = e
	c.order = append(c.order, key)
	for len(c.order) > c.max {
		delete(c.items, c.order[0])
		c.order = c.order[1:]
	}
	return e
}

func (c *cache[V]) len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// keyLocks is a mutex per key, made when asked for and dropped when nobody holds
// or waits for it: two requests for one key make one call.
type keyLocks struct {
	mu   sync.Mutex
	held map[string]*keyLock
}

type keyLock struct {
	slot chan struct{} // holds a token while the key is held
	n    int
}

// lock waits for the key, or for ctx to end (then it gives ctx's error), and
// returns what releases it.
func (k *keyLocks) lock(ctx context.Context, key string) (func(), error) {
	k.mu.Lock()
	if k.held == nil {
		k.held = map[string]*keyLock{}
	}
	l := k.held[key]
	if l == nil {
		l = &keyLock{slot: make(chan struct{}, 1)}
		k.held[key] = l
	}
	l.n++
	k.mu.Unlock()

	release := func() {
		k.mu.Lock()
		l.n--
		if l.n == 0 {
			delete(k.held, key)
		}
		k.mu.Unlock()
	}
	select {
	case l.slot <- struct{}{}:
	case <-ctx.Done():
		release()
		return nil, ctx.Err()
	}
	return func() {
		<-l.slot
		release()
	}, nil
}

// budgetPerHour is the most calls that the program makes to Open-Meteo in an
// hour, ten times under its limit.
var budgetPerHour = 500

// budget counts the calls of the current hour.
type budget struct {
	mu     sync.Mutex
	hour   time.Time
	used   int
	logged bool
}

// take counts a call, or says that the budget is spent (ok false), and whether
// this is the first refusal of the hour (first, for the log).
func (b *budget) take() (ok, first bool) {
	b.mu.Lock()
	defer b.mu.Unlock()
	hour := now().Truncate(time.Hour)
	if !hour.Equal(b.hour) {
		b.hour, b.used, b.logged = hour, 0, false
	}
	if b.used >= budgetPerHour {
		first = !b.logged
		b.logged = true
		return false, first
	}
	b.used++
	return true, false
}
