// Package demo is the sign-in of the demo instance: a second site, with the
// accounts of the seed, where a visitor enters with one click instead of an
// invitation. The real site never has it.
package demo

import (
	"database/sql"
	"errors"
	"net/http"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
	"courses/server/events"
)

// path is the address of both routes.
const path = "/api/app/demo"

// Register adds the routes of the demo to app, when cfg names its account
// (DEMO_LOGIN_EMAIL). Without one the routes do not exist, and PocketBase
// answers its own 404: nothing tells the real site apart from a site that has
// no such feature.
//
// Both routes are public, under the default rate limit rule of the settings
// for /api/. The account is the one of the configuration: a request never says
// which one it wants.
func Register(app core.App, cfg config.Config) {
	email := cfg.DemoLoginEmail
	if email == "" {
		return
	}

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET(path, enabledRoute)
		e.Router.POST(path, loginRoute(email))
		return e.Next()
	})
}

// enabledRoute tells the login page that the site is a demo, so that it shows
// the button.
func enabledRoute(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, map[string]any{"enabled": true})
}

// loginRoute answers a session of the demo account, as a password login does.
// An account that cannot sign in (missing, disabled) or has no runner to show
// gives the same 404: there is no demo to enter then.
func loginRoute(email string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		notFound := apperr.New(http.StatusNotFound, apperr.CodeNotFound)

		// The lookup ignores the capitals, as the sign-in does.
		user, err := e.App.FindAuthRecordByEmail("users", email)
		if errors.Is(err, sql.ErrNoRows) {
			return notFound
		}
		if err != nil {
			return e.InternalServerError("", err)
		}
		// Refused here, with the same 404: the auth rule of the collection
		// would answer a 403 that says the account is there.
		if user.GetBool("disabled") {
			return notFound
		}
		runner, err := events.RunnerOf(e.App, user.Id)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if runner == nil {
			return notFound
		}

		return apis.RecordAuthResponse(e, user, "password", nil)
	}
}
