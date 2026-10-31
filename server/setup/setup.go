// Package setup wires the application: collections, hooks and routes.
package setup

import (
	"courses/server/accounts"
	"courses/server/config"
	"courses/server/events"
	"courses/server/participations"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// Register attaches the application hooks and routes to app.
// It is the single wiring entry point shared by main and the tests.
func Register(app core.App, cfg config.Config) error {
	accounts.Register(app)
	events.Register(app)
	participations.Register(app)
	return nil
}
