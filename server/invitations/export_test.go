package invitations

import (
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/wording"
)

// SetNow sets the clock of the package and returns what puts it back.
func SetNow(f func() time.Time) (restore func()) {
	previous := now
	now = f
	return func() { now = previous }
}

// SetPreview replaces the computation of the preview and returns what puts it
// back, so that a test can make it fail.
func SetPreview(f func(core.App, string, string, string, wording.Words) (Preview, error)) (restore func()) {
	previous := computePreview
	computePreview = f
	return func() { computePreview = previous }
}
