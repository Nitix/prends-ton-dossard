// Package accounts holds the guards on accounts, runners and race types, and
// the route that changes the email of the caller.
//
// The guards keep invariants of the data, so they are model hooks: they also
// protect the writes that do not come from the API (the Go code, the commands,
// the dashboard).
package accounts

import (
	"net/http"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
)

// Register attaches the hooks and the routes of this package to app.
func Register(app core.App) {
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		// The account as it is stored, not Record.Original: that one is only what
		// the record held when it was loaded, which is stale for a record that was
		// created, then changed and saved again by the same code.
		before, err := e.App.FindRecordById("users", e.Record.Id)
		if err != nil {
			return err
		}

		if err := guardLastAdmin(e.App, before, e.Record); err != nil {
			return err
		}

		// A token is valid as long as the token key of its account is
		// unchanged: renewing the key ends the sessions already open, which must
		// not outlive the deactivation.
		if !before.GetBool("disabled") && e.Record.GetBool("disabled") {
			e.Record.RefreshTokenKey()
		}
		return e.Next()
	})

	app.OnRecordDelete("runners").BindFunc(func(e *core.RecordEvent) error {
		return refuseWhenReferenced(e, "participations", "runner", apperr.CodeRunnerHasParticipations)
	})
	// The participations are looked at first. A runner with an account is never
	// deleted: the account would be left with no runner to show it under, and
	// nobody could sign in as it any more. It is disabled instead.
	app.OnRecordDelete("runners").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("user") != "" {
			return apperr.New(http.StatusBadRequest, apperr.CodeRunnerHasAccount)
		}
		return e.Next()
	})
	app.OnRecordDelete("race_types").BindFunc(func(e *core.RecordEvent) error {
		return refuseWhenReferenced(e, "formats", "race_type", apperr.CodeRaceTypeInUse)
	})

	registerEmailRoute(app)
}

// isActiveAdmin reports whether the account can still administrate the site.
func isActiveAdmin(account *core.Record) bool {
	return account.GetString("role") == "admin" && !account.GetBool("disabled")
}

// guardLastAdmin refuses the update, from before to after, that leaves the site
// without an active admin: nobody could then manage the accounts any more.
func guardLastAdmin(app core.App, before, after *core.Record) error {
	if !isActiveAdmin(before) || isActiveAdmin(after) {
		return nil
	}

	others, err := app.CountRecords("users",
		dbx.HashExp{"role": "admin", "disabled": false},
		dbx.Not(dbx.HashExp{"id": after.Id}),
	)
	if err != nil {
		return err
	}
	if others == 0 {
		return apperr.New(http.StatusBadRequest, apperr.CodeLastAdmin)
	}
	return nil
}

// refuseWhenReferenced refuses to delete a record that at least one record of
// collection points at through field, with code.
func refuseWhenReferenced(e *core.RecordEvent, collection, field, code string) error {
	n, err := e.App.CountRecords(collection, dbx.HashExp{field: e.Record.Id})
	if err != nil {
		return err
	}
	if n > 0 {
		return apperr.New(http.StatusBadRequest, code)
	}
	return e.Next()
}
