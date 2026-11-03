// Package demo is the sign-in of the demo instance: a second site, with the
// accounts of the seed, where a visitor enters with one click instead of an
// invitation. The real site never has it.
// The demo account is shared by every visitor, so it never keeps a skin.
package demo

import (
	"database/sql"
	"errors"
	"net/http"
	"strings"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
	"courses/server/events"
)

// path is the address of both routes.
const path = "/api/app/demo"

// authMethod is the auth method that the auth hooks of PocketBase see: a demo
// login is a password login without the password, and "users" has no MFA or
// alert that would tell them apart.
const authMethod = "password"

// Register adds the routes of the demo to app, when cfg names its account
// (DEMO_LOGIN_EMAIL). Without one the routes do not exist, and PocketBase
// answers its own 404: nothing tells the real site apart from a site that has
// no such feature.
//
// Both routes are public, under the default rate limit rule of the settings
// for /api/. The account is the one of the configuration: a request never says
// which one it wants.
func Register(app core.App, cfg config.Config) {
	if !cfg.Demo() {
		return
	}
	email := cfg.DemoLoginEmail

	// The account is shared by every visitor, so it keeps no skin (see keepNoSkin).
	app.OnRecordCreate("users").BindFunc(keepNoSkin(email))
	app.OnRecordUpdate("users").BindFunc(keepNoSkin(email))

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET(path, enabledRoute(email))
		e.Router.POST(path, loginRoute(email))
		return e.Next()
	})
}

// keepNoSkin keeps the skin of the demo account empty. The site puts the skin
// of an account on the device at sign-in, and every visitor of the demo is the
// same account: a skin kept on it would be the one of whoever chose last, put
// on the next visitor over their own. So an update that sets it is dropped,
// with no error (the site saves the skin whenever it is chosen, and must not
// see the demo as a failure), and the rest of the update applies. It is a
// model hook, so that it holds for the writes that do not come from the API
// too. Every other account of the instance keeps its skin.
func keepNoSkin(demoEmail string) func(*core.RecordEvent) error {
	return func(e *core.RecordEvent) error {
		// The capitals do not matter, as for the sign-in (usableAccount).
		if strings.EqualFold(e.Record.Email(), demoEmail) {
			e.Record.Set("skin", "")
		}
		return e.Next()
	}
}

// usableAccount returns the account of the demo: the one with that email, if it
// is a member who can sign in and has a runner to show. It returns nil for
// anything else: no such account, a disabled one, one without a runner, and an
// admin, whose powers a visitor must never have.
func usableAccount(app core.App, email string) (*core.Record, error) {
	// The lookup ignores the capitals, as the sign-in does.
	user, err := app.FindAuthRecordByEmail("users", email)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	// Refused here: the auth rule of the collection would answer a 403 that
	// says the account is there.
	if user.GetBool("disabled") || user.GetString("role") == "admin" {
		return nil, nil
	}
	runner, err := events.RunnerOf(app, user.Id)
	if err != nil {
		return nil, err
	}
	if runner == nil {
		return nil, nil
	}
	return user, nil
}

// enabledRoute tells the login page that the site is a demo, so that it shows
// the button: only when the click can work. A site without a usable account
// gives the same 404 as a site without a demo.
func enabledRoute(email string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user, err := usableAccount(e.App, email)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if user == nil {
			return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}
		return e.JSON(http.StatusOK, map[string]any{"enabled": true})
	}
}

// loginRoute answers a session of the demo account, as a password login does.
// When there is no usable account the answer is the 404 of enabledRoute: there
// is no demo to enter then.
func loginRoute(email string) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		user, err := usableAccount(e.App, email)
		if err != nil {
			return e.InternalServerError("", err)
		}
		if user == nil {
			return apperr.New(http.StatusNotFound, apperr.CodeNotFound)
		}
		// A skin that the account had before it was the demo's (a copy of
		// another database) would be put on every visitor: it is emptied.
		if user.GetString("skin") != "" {
			user.Set("skin", "")
			if err := e.App.Save(user); err != nil {
				return e.InternalServerError("", err)
			}
		}
		return apis.RecordAuthResponse(e, user, authMethod, nil)
	}
}
