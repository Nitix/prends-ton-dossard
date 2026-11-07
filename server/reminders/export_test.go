package reminders

import (
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The tests of the package are external ones (testutil imports the setup of the
// application, which imports this package): this file gives them what they
// need.

// Path is the route of the choice of the account.
const Path = path

// JobName is the cron job of the scheduler.
const JobName = jobName

// Due is the kind of reminder due at now for an opening at T.
var Due = due

// SetNow makes the cron job of the scheduler read at as the time, until the
// test ends.
func SetNow(t testing.TB, at time.Time) {
	t.Helper()
	old := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = old })
}

// Serve does what the start of the server does to the handlers of OnServe: the
// keys of the push service are read, the routes and the cron job are added.
func Serve(t testing.TB, app core.App) {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	event := &core.ServeEvent{App: app, Router: router}
	if err := app.OnServe().Trigger(event, func(*core.ServeEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
}
