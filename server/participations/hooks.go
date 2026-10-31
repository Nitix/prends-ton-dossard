// Package participations holds the hooks that keep participations coherent:
// who added one, whether its runner confirmed it, and which event it is in.
//
// What a request changes is decided by request hooks, since it depends on the
// caller. The rules that hold for any write, such as the default status and
// the format staying in its event, are model hooks: they also cover the writes
// that do not come from the API.
package participations

import (
	"database/sql"
	"errors"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/events"
)

// statusInterested is the status of a participation that is created without
// one. A select field has no default value of its own.
const statusInterested = "interested"

// Register attaches the hooks of the participations collection to app.
func Register(app core.App) {
	app.OnRecordCreate("participations").BindFunc(func(e *core.RecordEvent) error {
		// Before the validation, which requires a status.
		if e.Record.GetString("status") == "" {
			e.Record.Set("status", statusInterested)
		}
		return e.Next()
	})

	app.OnRecordCreateRequest("participations").BindFunc(func(e *core.RecordRequestEvent) error {
		// Whatever the request says, the participation was added by the runner
		// of the caller, and it is confirmed when that runner is the one it is
		// about. A superuser has no runner: nobody added it, and it is not
		// confirmed.
		addedBy := ""
		if e.Auth != nil && !e.HasSuperuserAuth() {
			runner, err := events.RunnerOf(e.App, e.Auth.Id)
			if err != nil {
				return e.InternalServerError("", err)
			}
			if runner != nil {
				addedBy = runner.Id
			}
		}
		confirmed, err := aboutCaller(e)
		if err != nil {
			return e.InternalServerError("", err)
		}

		e.Record.Set("added_by", addedBy)
		e.Record.Set("confirmed", confirmed)
		return e.Next()
	})

	app.OnRecordUpdateRequest("participations").BindFunc(func(e *core.RecordRequestEvent) error {
		// A confirmation is never taken back, and only the runner gives it:
		// the value that the request sends does not count.
		confirmed := e.Record.Original().GetBool("confirmed")
		if !confirmed {
			var err error
			if confirmed, err = aboutCaller(e); err != nil {
				return e.InternalServerError("", err)
			}
		}

		e.Record.Set("confirmed", confirmed)
		return e.Next()
	})

	// The system validation runs after this hook. It calls Next first, so that
	// a missing or unknown format is reported by it, and the check below can
	// rely on the format being there.
	app.OnRecordValidate("participations").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return validateFormat(e.App, e.Record)
	})
}

// aboutCaller reports whether the runner of the participation is the caller
// of the request. It is false for a runner that has no account, and for a
// superuser.
func aboutCaller(e *core.RecordRequestEvent) (bool, error) {
	if e.Auth == nil || e.HasSuperuserAuth() {
		return false, nil
	}
	runner, err := e.App.FindRecordById("runners", e.Record.GetString("runner"))
	if errors.Is(err, sql.ErrNoRows) {
		// An unknown or missing runner is for the validation to report.
		return false, nil
	}
	if err != nil {
		return false, err
	}
	user := runner.GetString("user")
	return user != "" && user == e.Auth.Id, nil
}

// validateFormat refuses a participation that moves to a format of another
// event. A new participation can be in any format.
func validateFormat(app core.App, participation *core.Record) error {
	if participation.IsNew() {
		return nil
	}
	// Not Original(): it is blank for a record that this process created and
	// then saves again without loading it, as the tests and the commands do.
	saved, err := app.FindRecordById("participations", participation.Id)
	if err != nil {
		return err
	}
	was, now := saved.GetString("format"), participation.GetString("format")
	if was == now {
		return nil
	}

	before, err := app.FindRecordById("formats", was)
	if err != nil {
		return err
	}
	after, err := app.FindRecordById("formats", now)
	if err != nil {
		return err
	}
	if before.GetString("event") != after.GetString("event") {
		return apperr.Field("format", apperr.CodeFormatOtherEvent)
	}
	return nil
}
