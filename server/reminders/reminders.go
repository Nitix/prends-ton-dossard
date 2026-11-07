// Package reminders holds the choice that each person makes of the warnings
// they want before a registration opens: one day before, one hour before, both
// or none. One choice serves every channel: the alarms of the calendar feed
// read it through Of, and the notifications do too.
package reminders

import (
	"errors"
	"net/http"
	"slices"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
)

// The kinds of reminder, as the users.reminders field stores them.
const (
	// KindDay is the reminder of one day before.
	KindDay = "day"
	// KindHour is the reminder of one hour before.
	KindHour = "hour"
)

// path is the route of the choice of the account.
const path = "/api/app/me/reminders"

// kinds is every kind, in the order that the choice is kept and answered.
var kinds = []string{KindDay, KindHour}

// Register adds GET and PUT /api/app/me/reminders, which a member uses to read
// and to replace their own choice. Both want a session of the site, and neither
// exists on the demo, whose account everybody shares: nobody's warnings would
// be the right ones.
//
// It also adds the scheduler (schedule.go): when the server starts and the
// notifier is available (its keys are read), the cron job "ptd-reminders", every
// minute, which sends the reminders that are due. The notifier is registered
// before, so that its keys are read first.
func Register(app core.App, cfg config.Config, notifier Notifier) {
	if cfg.Demo() {
		return
	}
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET(path, showRoute).Bind(apis.RequireAuth("users"))
		e.Router.PUT(path, saveRoute).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
	if notifier != nil {
		registerJob(app, notifier)
	}
}

// Of returns the kinds of reminder that the account chose, "day" before "hour"
// (none: an empty list, not nil, so that it is written as []).
func Of(user *core.Record) []string {
	chosen := user.GetStringSlice("reminders")
	out := []string{}
	for _, kind := range kinds {
		if slices.Contains(chosen, kind) {
			out = append(out, kind)
		}
	}
	return out
}

// answer is the response of both routes.
type answer struct {
	Reminders []string `json:"reminders"`
}

func showRoute(e *core.RequestEvent) error {
	return e.JSON(http.StatusOK, answer{Reminders: Of(e.Auth)})
}

// saveRoute replaces the choice of the account with the one of the body, and
// answers what is stored. The order and the duplicates of the body do not
// matter. A value that is not a kind is refused by the select field, under
// "reminders", as for any record; the choice is saved through the record, so it
// is the model that validates it.
func saveRoute(e *core.RequestEvent) error {
	var body struct {
		// A pointer: a missing key and null are not an empty list.
		Reminders *[]string `json:"reminders"`
	}
	// A body that cannot be read is a request that is wrong, not a choice.
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	// A body with no list ({}, null, a key with a typo) is a mistake of the caller,
	// not the wish to have none: only an explicit [] clears the choice.
	if body.Reminders == nil {
		return apperr.Field("reminders", "validation_required")
	}
	user, err := e.App.FindRecordById("users", e.Auth.Id)
	if err != nil {
		return e.InternalServerError("", err)
	}
	user.Set("reminders", ordered(*body.Reminders))
	if err := e.App.Save(user); err != nil {
		var invalid validation.Errors
		if errors.As(err, &invalid) {
			return invalid
		}
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, answer{Reminders: Of(user)})
}

// ordered puts the kinds of chosen in the order that they are kept, "day" then
// "hour", each once. What is not a kind goes last, as it came, for the field to
// refuse it.
func ordered(chosen []string) []string {
	out := []string{}
	for _, kind := range kinds {
		if slices.Contains(chosen, kind) {
			out = append(out, kind)
		}
	}
	for _, other := range chosen {
		if !slices.Contains(kinds, other) {
			out = append(out, other)
		}
	}
	return out
}
