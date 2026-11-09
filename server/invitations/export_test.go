package invitations

import "time"

// SetNow sets the clock of the package and returns what puts it back.
func SetNow(f func() time.Time) (restore func()) {
	previous := now
	now = f
	return func() { now = previous }
}
