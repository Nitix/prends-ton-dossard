// Package participations holds the hooks that keep participations coherent:
// who added one, whether its runner confirmed it, and which event and format
// it is in.
//
// A participation is in an event, and usually in one of its formats. Without a
// format it is for the event only: the runner is interested and has not chosen
// yet, or is a supporter who comes to cheer. A runner has either that
// participation to the event or participations to formats in it, never both:
// giving the runner a format replaces the one to the event, whether it is
// "interested" or "supporter".
//
// A finished participation can carry a result: the time, the rank, how many
// were ranked, and a note (the note also goes with "dnf"). A result only means
// something with its status, so changing the status clears what no longer
// applies instead of refusing the write. Nor can a runner finish a race, or give
// up on it, before its day: "finished" and "dnf" are refused until then.
//
// What a request changes is decided by request hooks, since it depends on the
// caller. The rules that hold for any write, such as the default status, the
// event of a format and the invariants above, are model hooks: they also cover
// the writes that do not come from the API.
package participations

import (
	"database/sql"
	"errors"
	"time"

	// The image has no time zone database: the program carries its own.
	_ "time/tzdata"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/events"
)

// statusInterested is the status of a participation that is created without
// one. A select field has no default value of its own.
const statusInterested = "interested"

// statusSupporter is the status of a runner who comes to cheer at the event
// without running a race. With statusInterested, it is one of the two statuses
// of a participation without a format, and it is not allowed with one.
const statusSupporter = "supporter"

// statusFinished and statusDNF are the statuses of a runner who took the start
// of the race: the first finished it, the second gave up. They are the ones
// that a result goes with.
const (
	statusFinished = "finished"
	statusDNF      = "dnf"
)

// now is the clock of the hooks, which the tests replace.
var now = time.Now

// paris is the time zone of the days of the races: "today" is the day it is in
// Paris, whatever the zone of the server. It is the zone of the scheduled jobs
// (setup.CronTimezone), which this package cannot import: setup imports it.
var paris = func() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		// Not possible with the database of time/tzdata linked in.
		panic("loading the time zone of the races: " + err.Error())
	}
	return location
}()

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

	// The validation of the system runs after this hook. The result that does
	// not go with the status is cleared before it, so that it is not held
	// against the participation: a time that is not a whole number is dropped
	// with the status that had it. The hook then calls Next first, so that a
	// missing or unknown event, format or runner is reported by it, and
	// validate can rely on them being there.
	app.OnRecordValidate("participations").BindFunc(func(e *core.RecordEvent) error {
		clearResult(e.Record)
		if err := e.Next(); err != nil {
			return err
		}
		if err := validate(e.App, e.Record); err != nil {
			return err
		}
		if err := validateStarted(e.App, e.Record); err != nil {
			return err
		}
		return validateResult(e.Record)
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
//     (apperr.CodeFormatOtherEvent on format), and the status cannot be
//     "supporter", since a supporter does not run a race
//     (apperr.CodeSupporterWithFormat on status).
//   - Without a format, the participation is for the event only, which only the
//     statuses "interested" and "supporter" say (apperr.CodeFormatRequired on
//     status), and the runner must not be on a format of the event
//     (apperr.CodeFormatRequired on format).
func validate(app core.App, p *core.Record) error {
	if format := p.GetString("format"); format != "" {
		saved, err := app.FindRecordById("formats", format)
		if err != nil {
			return err
		}
		if saved.GetString("event") != p.GetString("event") {
			return apperr.Field("format", apperr.CodeFormatOtherEvent)
		}
		if p.GetString("status") == statusSupporter {
			return apperr.Field("status", apperr.CodeSupporterWithFormat)
		}
		return nil
	}

	if status := p.GetString("status"); status != statusInterested && status != statusSupporter {
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

// validateStarted refuses the status "finished" or "dnf" for a race that has
// not started: nobody finishes a race, or gives up on it, before its day
// (apperr.CodeStatusBeforeRace on status). The race starts on its day, in
// Paris: the day of its format, or the first day of its event when the format
// has none. The day itself counts.
//
// It only looks at what is being put on a race: a new participation, a status
// that changes, or a format that changes (a finisher moved to a race to come
// would finish it before its day). A participation that already has the status
// on the same race is left alone, so that its note, its time and its rank can
// be changed even when its event has moved later since. Moving from "finished"
// to "dnf" is a new status, which is checked.
//
// It runs once validate has found the format and the event, and has refused a
// status of a race when there is no format: they are not looked for again.
func validateStarted(app core.App, p *core.Record) error {
	status := p.GetString("status")
	if status != statusFinished && status != statusDNF {
		return nil
	}
	if !p.IsNew() {
		original := p.Original()
		if original.GetString("status") == status && original.GetString("format") == p.GetString("format") {
			return nil
		}
	}

	day, err := raceDay(app, p)
	if err != nil {
		return err
	}
	year, month, dayOfMonth := now().In(paris).Date()
	if day.After(time.Date(year, month, dayOfMonth, 0, 0, 0, 0, time.UTC)) {
		return apperr.Field("status", apperr.CodeStatusBeforeRace)
	}
	return nil
}

// raceDay returns the day of the race that the participation is on: the day of
// its format, or the first day of its event when the format has none. It is
// midnight UTC of that day. The days of formats and events are checked when
// they are saved, so one that is not a day is not looked for here: it would be
// the zero time, which is not after any day.
func raceDay(app core.App, p *core.Record) (time.Time, error) {
	format, err := app.FindRecordById("formats", p.GetString("format"))
	if err != nil {
		return time.Time{}, err
	}
	text := format.GetString("date")
	if text == "" {
		event, err := app.FindRecordById("events", p.GetString("event"))
		if err != nil {
			return time.Time{}, err
		}
		text = event.GetString("start_date")
	}
	day, _ := events.ParseDay(text)
	return day, nil
}

// clearResult empties the parts of the result that the status of the
// participation does not go with: the time, the rank and the number of people
// ranked are for "finished" only, and the note is for "finished" and "dnf". The
// result of a runner who is no longer a finisher would skew every statistic, and
// asking for it to be emptied by hand first would make a change of status a
// chore.
func clearResult(p *core.Record) {
	status := p.GetString("status")
	if status != statusFinished {
		p.Set("finish_time_s", 0)
		p.Set("rank", 0)
		p.Set("rank_of", 0)
	}
	if status != statusFinished && status != statusDNF {
		p.Set("result_note", "")
	}
}

// validateResult refuses a rank that is past the last place: the rank is not
// above the number of people ranked (apperr.CodeRankAboveTotal on rank). It
// only counts when both are given, a 0 being "not given". The result of a status
// that has none was cleared by clearResult, so a rank that is left here is a
// finisher's.
func validateResult(p *core.Record) error {
	rank, rankOf := p.GetInt("rank"), p.GetInt("rank_of")
	if rank > 0 && rankOf > 0 && rank > rankOf {
		return apperr.Field("rank", apperr.CodeRankAboveTotal)
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
