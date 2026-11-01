// Package events holds the hooks that keep events and their formats valid.
//
// The creator of an event comes from the request, so it is set by request
// hooks. The rules on dates, measures and prices are invariants of the data, so
// they are model hooks: they also check the writes that do not come from the
// API.
package events

import (
	"database/sql"
	"errors"
	"math"
	"regexp"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
)

// dayLayout is the Go layout of a day, which is stored as YYYY-MM-DD text.
const dayLayout = "2006-01-02"

// dayPattern is checked on top of the layout, which accepts a few more
// spellings (such as a one-digit month).
var dayPattern = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`)

// Register attaches the hooks of the events and formats collections to app.
func Register(app core.App) {
	app.OnRecordCreateRequest("events").BindFunc(func(e *core.RecordRequestEvent) error {
		// Whatever the request says, the creator is the runner of the caller.
		// A superuser has none: the event then has no creator.
		creator := ""
		if e.Auth != nil && !e.HasSuperuserAuth() {
			runner, err := RunnerOf(e.App, e.Auth.Id)
			if err != nil {
				return e.InternalServerError("", err)
			}
			if runner != nil {
				creator = runner.Id
			}
		}
		e.Record.Set("created_by", creator)
		return e.Next()
	})

	app.OnRecordUpdateRequest("events").BindFunc(func(e *core.RecordRequestEvent) error {
		// The update rule lets any member edit an event, so this is what
		// keeps created_by, which grants the right to delete it, unchanged.
		e.Record.Set("created_by", e.Record.Original().GetString("created_by"))
		return e.Next()
	})

	// The system validation runs after these hooks. They call Next first, so
	// that a missing or unknown value is reported by it, and the checks below
	// can rely on every required value being there.
	app.OnRecordValidate("events").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return validateEvent(e.App, e.Record)
	})
	app.OnRecordValidate("formats").BindFunc(func(e *core.RecordEvent) error {
		if err := e.Next(); err != nil {
			return err
		}
		return validateFormat(e.App, e.Record)
	})
}

// RunnerOf returns the runner whose account is userID, or nil, without error,
// when there is none.
func RunnerOf(app core.App, userID string) (*core.Record, error) {
	if userID == "" {
		// Not a lookup: it would find the runners that have no account.
		return nil, nil
	}
	runner, err := app.FindFirstRecordByData("runners", "user", userID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return runner, nil
}

// ParseDay reports whether s is a real calendar day written YYYY-MM-DD, and
// returns that day. The packages that keep a day as text, such as the offers,
// check it with this one.
func ParseDay(s string) (time.Time, bool) {
	if !dayPattern.MatchString(s) {
		return time.Time{}, false
	}
	day, err := time.Parse(dayLayout, s)
	return day, err == nil
}

// InRange reports whether day is in the range of an event: from its start
// date, up to its end date or without end when it has none. The days are
// valid, and YYYY-MM-DD texts sort like the days they stand for.
func InRange(day, start, end string) bool {
	return day >= start && (end == "" || day <= end)
}

func validateEvent(app core.App, event *core.Record) error {
	start, end := event.GetString("start_date"), event.GetString("end_date")
	if _, ok := ParseDay(start); !ok {
		return apperr.Field("start_date", apperr.CodeDateInvalid)
	}
	if end != "" {
		if _, ok := ParseDay(end); !ok {
			return apperr.Field("end_date", apperr.CodeDateInvalid)
		}
		if end < start {
			return apperr.Field("end_date", apperr.CodeEndBeforeStart)
		}
	}

	// The last day to register is not after the first day of the event. It is
	// checked on every save, before the formats: moving the start before the
	// deadline is refused on the deadline, even when the formats are fine with
	// it, and an edit that leaves the dates alone still checks the deadline.
	if deadline := event.GetString("registration_deadline"); deadline != "" {
		if _, ok := ParseDay(deadline); !ok {
			return apperr.Field("registration_deadline", apperr.CodeDateInvalid)
		}
		if deadline > start {
			return apperr.Field("registration_deadline", apperr.CodeRegistrationDeadlineAfterStart)
		}
	}

	// A format stays inside its event: the range of an event cannot move away
	// from the formats it holds. An edit that leaves the dates alone is not
	// held against the formats.
	original := event.Original()
	if event.IsNew() ||
		(start == original.GetString("start_date") && end == original.GetString("end_date")) {
		return nil
	}
	formats, err := app.FindAllRecords("formats", dbx.HashExp{"event": event.Id})
	if err != nil {
		return err
	}
	for _, format := range formats {
		if day := format.GetString("date"); day != "" && !InRange(day, start, end) {
			return apperr.Field("start_date", apperr.CodeFormatDateOutOfRange)
		}
	}
	return nil
}

// measures are the fields of a format that say what the race is: a distance,
// a duration or a time limit.
var measures = []string{"distance_km", "duration_min", "time_limit_min"}

func validateFormat(app core.App, format *core.Record) error {
	if day := format.GetString("date"); day != "" {
		if _, ok := ParseDay(day); !ok {
			return apperr.Field("date", apperr.CodeDateInvalid)
		}
		event, err := app.FindRecordById("events", format.GetString("event"))
		if err != nil {
			return err
		}
		if !InRange(day, event.GetString("start_date"), event.GetString("end_date")) {
			return apperr.Field("date", apperr.CodeFormatDateOutOfRange)
		}
	}

	// Before the measures: the loop below returns at the first one that is set.
	if priceInvalid(format.GetFloat("price_eur")) {
		return apperr.Field("price_eur", apperr.CodePriceInvalid)
	}

	// PocketBase stores a number that is not set as 0, so 0 is not a measure.
	for _, field := range measures {
		if format.GetFloat(field) > 0 {
			return nil
		}
	}
	return apperr.Field("distance_km", apperr.CodeFormatMeasureRequired)
}

// priceInvalid tells whether a price has more than two decimals. A float
// such as 19.99 is 1998.9999999999998 cents: the tolerance absorbs that.
func priceInvalid(eur float64) bool {
	cents := eur * 100
	return math.Abs(cents-math.Round(cents)) > 1e-6
}
