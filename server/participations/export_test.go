package participations

import (
	"testing"
	"time"
)

// SetNow makes the hooks read that clock, instead of the real one, until the
// test ends. The tests of the package that holds them cannot reach `now`.
func SetNow(t testing.TB, clock func() time.Time) {
	t.Helper()
	previous := now
	now = clock
	t.Cleanup(func() { now = previous })
}
