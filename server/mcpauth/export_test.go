package mcpauth

import (
	"testing"
	"time"
)

// SetNow makes the package read that moment, instead of the real clock, until
// the test ends. The tests of the package are external ones (testutil imports
// the setup of the application, which imports this package), so they cannot
// reach `now`.
func SetNow(t testing.TB, at time.Time) {
	t.Helper()
	previous := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = previous })
}
