// Package participations holds the hooks that keep participations coherent:
// who added one, whether its runner confirmed it, and which event and format
// it is in.
//
// A participation is in an event, and usually in one of its formats. Without a
// format it is for the event only: the runner is interested and has not chosen
// yet. A runner has either that participation to the event or participations
// to formats in it, never both: giving the runner a format replaces the one to
// the event.
//
// What a request changes is decided by request hooks, since it depends on the
// caller. The rules that hold for any write, such as the default status, the
// event of a format and the invariants above, are model hooks: they also cover
// the writes that do not come from the API.
package participations

import (
	"database/sql"
	"errors"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/events"
)

// statusInterested is the status of a participation that is created without
// one, and the only one of a participation without a format. A select field has
// no default value of its own.
const statusInterested = "interested"

// Register attaches the hooks of the participations collection to app.
func Register(app core.App) {
	app.OnRecordCreate("participations").BindFunc(func(e *core.RecordEvent) error {
		// Before the validation, which requires a status and an event.
		if e.Record.GetString("status") == "" {
			e.Record.Set("status", statusInterested)
		}
		if e.Record.GetString("event") == "" && e.Record.GetString("format") != "" {
			// The clients of the v1 do not send the event. A format that is not
			// found leaves it empty: the validation reports it.
			format, err := e.App.FindRecordById("formats", e.Record.GetString("format"))
			if err != nil && !errors.Is(err, sql.ErrNoRows) {
				return err
			}
			if format != nil {
				e.Record.Set("event", format.GetString("event"))
			}
		}
		return e.Next()
	})

	// The validation of the system runs after this hook. It calls Next first,
	// so that a missing or unknown event, format or runner is reported by it,
	// and validate can rely on them being there.
	app.OnRecordValidate("participations").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return validate(e.App, e.Record)
	})

	// The runner who is given a format of the event stops being a participant
	// of the event only. The one to the event is deleted in the transaction of
	// the insertion, so that it comes back when the insertion fails (a runner
	// who is already on that format, say). A transaction that already exists
	// (the batch route, a merge) is reused.
	app.OnRecordCreateExecute("participations").BindFunc(func(e *core.RecordEvent) error {
		if e.Record.GetString("format") == "" {
			return e.Next()
		}
		return e.App.RunInTransaction(func(tx core.App) error {
			// Everything below goes through tx: the original app would wait for
			// the transaction, which waits for it.
			e.App = tx
			if err := dropUndecided(tx, e.Record.GetString("runner"), e.Record.GetString("event")); err != nil {
				return err
			}
			return e.Next()
		})
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

// validate refuses a participation that does not hold together. It is run once
// the system validation has found the event, the format and the runner.
//
//   - With a format, the format must be one of the event
//     (apperr.CodeFormatOtherEvent on format).
//   - Without a format, the participation is for the event only, which only the
//     status "interested" says (apperr.CodeFormatRequired on status), and the
//     runner must not be on a format of the event (apperr.CodeFormatRequired on
//     format).
func validate(app core.App, p *core.Record) error {
	if format := p.GetString("format"); format != "" {
		saved, err := app.FindRecordById("formats", format)
		if err != nil {
			return err
		}
		if saved.GetString("event") != p.GetString("event") {
			return apperr.Field("format", apperr.CodeFormatOtherEvent)
		}
		return nil
	}

	if p.GetString("status") != statusInterested {
		return apperr.Field("status", apperr.CodeFormatRequired)
	}
	onFormats, err := app.CountRecords("participations",
		dbx.HashExp{"runner": p.GetString("runner"), "event": p.GetString("event")},
		dbx.NewExp("format != ''"),
		dbx.NewExp("id != {:id}", dbx.Params{"id": p.Id}),
	)
	if err != nil {
		return err
	}
	if onFormats > 0 {
		return apperr.Field("format", apperr.CodeFormatRequired)
	}
	return nil
}

// dropUndecided deletes the participation of the runner to the event, the one
// that has no format, if there is one. The other participations are left as
// they are.
func dropUndecided(app core.App, runnerID, eventID string) error {
	if runnerID == "" || eventID == "" {
		// Only a write without validation gets here.
		return nil
	}
	found, err := app.FindAllRecords("participations",
		dbx.HashExp{"runner": runnerID, "event": eventID, "format": ""})
	if err != nil {
		return err
	}
	for _, p := range found {
		if err := app.Delete(p); err != nil {
			return err
		}
	}
	return nil
}
