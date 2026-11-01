// Package setup wires the application: collections, hooks and routes.
package setup

import (
	"fmt"
	"time"

	// The image has no time zone database: the program carries its own.
	_ "time/tzdata"

	"courses/server/accounts"
	"courses/server/admin"
	"courses/server/calendar"
	"courses/server/comments"
	"courses/server/config"
	"courses/server/events"
	"courses/server/invitations"
	"courses/server/offers"
	"courses/server/participations"
	"courses/server/passkeys"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// CronTimezone is the time zone of the scheduled jobs: the nightly backup runs
// at 3 h in Paris, not in UTC, which is PocketBase's default.
const CronTimezone = "Europe/Paris"

// Register attaches the application hooks and routes to app.
// It is the single wiring entry point shared by main and the tests.
func Register(app core.App, cfg config.Config) error {
	paris, err := time.LoadLocation(CronTimezone)
	if err != nil {
		return fmt.Errorf("loading the time zone of the cron: %w", err)
	}
	app.Cron().SetTimezone(paris)

	accounts.Register(app)
	events.Register(app)
	participations.Register(app)
	comments.Register(app)
	offers.Register(app)
	invitations.Register(app, cfg)
	calendar.Register(app, cfg)
	admin.Register(app)
	if err := passkeys.Register(app, cfg); err != nil {
		return err
	}
	return nil
}
