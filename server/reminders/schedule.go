package reminders

import (
	"context"
	"errors"
	"log/slog"
	"slices"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"

	"courses/server/events"
	"courses/server/push"
	"courses/server/wording"
)

// jobName is the cron job that sends the reminders, every minute.
const jobName = "ptd-reminders"

// retention is how long a delivery is remembered. An opening is over long before.
const retention = 60 * 24 * time.Hour

// now is the clock of the scheduler; the tests replace it (SetNow).
var now = time.Now

// Notifier is what the scheduler sends with: push.Service, or a fake in tests.
type Notifier interface {
	// Available says whether notifications can be sent now: the keys are read.
	Available() bool
	SendToUser(ctx context.Context, app core.App, userID string,
		message func(lang string) push.Message, opts push.Options) (push.Delivery, error)
}

// Report is what a pass did, in reminders (a person and a kind for one event):
// Due were due and had a device, Sent reached at least one device, Failed
// reached none, Skipped were already done or had no device to reach.
type Report struct{ Due, Sent, Failed, Skipped int }

// registerJob adds the cron job of the scheduler. It is bound to the start of
// the server, after the keys of the push service were read (which is also at the
// start of the server): a service whose keys cannot be read has no job.
func registerJob(app core.App, notifier Notifier) {
	// Cancelled when the program ends, so that a pass that is sending stops
	// without counting the devices it did not reach.
	ctx, cancel := context.WithCancel(context.Background())
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		cancel()
		return e.Next()
	})

	var running sync.Mutex
	run := func() {
		// A pass that is still going makes the next tick return at once.
		if !running.TryLock() {
			return
		}
		defer running.Unlock()
		defer func() {
			if recover() != nil {
				// Never the value: it could hold anything.
				app.Logger().Error("reminders: a pass failed")
			}
		}()
		report, err := Run(ctx, app, now(), notifier)
		if err != nil && ctx.Err() == nil {
			app.Logger().Error("reminders: a pass could not run", "error", errors.New("the database or the notifier refused it"))
		}
		// One line for a pass that did something, none for the minutes with nothing
		// to do, and never an address, a name or a message.
		if report.Due > 0 {
			app.Logger().Info("reminders: a pass", slog.Int("due", report.Due), slog.Int("sent", report.Sent),
				slog.Int("failed", report.Failed), slog.Int("skipped", report.Skipped))
		}
	}
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		if notifier.Available() {
			if err := e.App.Cron().Add(jobName, "* * * * *", run); err != nil {
				e.App.Logger().Error("reminders: the job could not be added")
			}
		}
		return e.Next()
	})
}

// due is the kind of reminder due at now for an opening at T and a choice
// (kinds), if any (spec § 4.3). "hour" is due from T - 1 h to T, "day" from
// T - 24 h to T, except that "day" gives way when "hour" is due and chosen: two
// notifications in an hour would be too many. Both windows end at T, and the one
// that is late is still sent (a program that was stopped catches up).
func due(T, now time.Time, kinds []string) (kind string, ok bool) {
	left := T.Sub(now)
	if left <= 0 {
		return "", false
	}
	if left <= time.Hour && slices.Contains(kinds, KindHour) {
		return KindHour, true
	}
	if left <= 24*time.Hour && slices.Contains(kinds, KindDay) {
		return KindDay, true
	}
	return "", false
}

// Run sends the reminders that are due at at (spec § 4.3, § 4.6), and returns
// what it did. Nothing is sent, and nothing is recorded, while the notifier is
// not available: the pass is a no-op that the next minute tries again.
//
// For each event whose opening is today, tomorrow or the day after in Paris and
// within the next 24 hours, for each person who gets its reminders (§ 4.2), the
// kind that is due: a row of reminder_deliveries is inserted first, and a row that
// the unique index refuses means that the reminder is already done; then the
// message is sent to the devices of the person. A person with no device has no
// row, so that a device activated before T still gets the reminder. A program
// stopped between the insert and the send loses that reminder rather than sending
// two. Once an hour, at minute 0, the rows older than 60 days are deleted.
func Run(ctx context.Context, app core.App, at time.Time, notifier Notifier) (Report, error) {
	var report Report
	if notifier == nil || !notifier.Available() {
		return report, nil
	}
	if at.Minute() == 0 {
		cutoff, err := types.ParseDateTime(at.Add(-retention).UTC())
		if err == nil {
			_, err = app.DB().NewQuery("DELETE FROM reminder_deliveries WHERE created < {:cutoff}").
				Bind(dbx.Params{"cutoff": cutoff.String()}).Execute()
		}
		if err != nil {
			app.Logger().Error("reminders: the old deliveries could not be deleted")
		}
	}

	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return report, err
	}
	local := at.In(paris)
	days := make([]any, 3)
	for i := range days {
		days[i] = local.AddDate(0, 0, i).Format("2006-01-02")
	}
	opening, err := app.FindAllRecords("events", dbx.In("registration_opening", days...))
	if err != nil {
		return report, err
	}

	var firstErr error
	for _, event := range opening {
		T, ok := events.OpeningInstant(event.GetString("registration_opening"), event.GetString("registration_opening_time"))
		if !ok || !at.Before(T) || T.Sub(at) > 24*time.Hour {
			continue
		}
		recipients, err := recipientsOf(app, event.Id)
		if err != nil {
			firstErr = errors.Join(firstErr, err)
			continue
		}
		for _, user := range recipients {
			if ctx.Err() != nil {
				return report, ctx.Err()
			}
			kind, ok := due(T, at, Of(user))
			if !ok {
				continue
			}
			remind(ctx, app, notifier, &report, event, user, kind, T, at)
		}
	}
	return report, firstErr
}

// remind does the reminder of one person for one event, and counts it in report.
func remind(ctx context.Context, app core.App, notifier Notifier, report *Report,
	event, user *core.Record, kind string, T, at time.Time) {
	devices, err := app.CountRecords("push_subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		report.Failed++
		return
	}
	if devices == 0 {
		report.Skipped++
		return
	}
	report.Due++

	collection, err := app.FindCollectionByNameOrId("reminder_deliveries")
	if err != nil {
		report.Failed++
		return
	}
	row := core.NewRecord(collection)
	row.Set("user", user.Id)
	row.Set("event", event.Id)
	row.Set("kind", kind)
	row.Set("opening_at", T.UTC().Format(time.RFC3339))
	row.Set("delivered", 0)
	if err := app.Save(row); err != nil {
		if notUnique(err) {
			report.Skipped++ // already done
			return
		}
		app.Logger().Error("reminders: a delivery could not be recorded")
		report.Failed++
		return
	}

	timeKnown := events.ValidTime(event.GetString("registration_opening_time"))
	name, url := event.GetString("name"), "/evenements/"+event.Id
	message := func(lang string) push.Message {
		return push.Message{
			Title: name,
			Body:  wording.Of(lang).ReminderBody(T, timeKnown, at),
			URL:   url,
			Tag:   "opening-" + event.Id,
		}
	}
	opts := push.Options{TTL: max(T.Sub(at), time.Minute), Urgency: "normal", Topic: "opening-" + event.Id}
	if kind == KindHour {
		opts.Urgency = "high"
	}
	out, err := notifier.SendToUser(ctx, app, user.Id, message, opts)
	if err != nil || (out.Sent+out.Failed == 0 && ctx.Err() != nil) {
		// Nothing was tried (the service is not ready, the devices cannot be read, the
		// program is stopping): the row is taken back, so that the next minute tries
		// again, and the reminder is not lost.
		if delErr := app.Delete(row); delErr != nil {
			app.Logger().Error("reminders: a delivery could not be taken back")
		}
		report.Failed++
		return
	}
	if out.Sent > 0 {
		row.Set("delivered", out.Sent)
		if err := app.Save(row); err != nil {
			app.Logger().Error("reminders: a delivery could not be recorded")
		}
		report.Sent++
		return
	}
	report.Failed++
}

// recipientsOf returns the accounts that get the reminders of the event
// (§ 4.2): those whose runner is interested in it or registered to it, on a
// format or on the event alone, whose account is not disabled. A person is once,
// however many formats. A runner with no account, a supporter and a person who
// does not start have none.
func recipientsOf(app core.App, eventID string) ([]*core.Record, error) {
	participations, err := app.FindAllRecords("participations",
		dbx.HashExp{"event": eventID}, dbx.In("status", "interested", "registered"))
	if err != nil {
		return nil, err
	}
	var runnerIDs []string
	for _, p := range participations {
		if id := p.GetString("runner"); id != "" && !slices.Contains(runnerIDs, id) {
			runnerIDs = append(runnerIDs, id)
		}
	}
	if len(runnerIDs) == 0 {
		return nil, nil
	}
	runners, err := app.FindRecordsByIds("runners", runnerIDs)
	if err != nil {
		return nil, err
	}
	var userIDs []string
	for _, runner := range runners {
		if id := runner.GetString("user"); id != "" && !slices.Contains(userIDs, id) {
			userIDs = append(userIDs, id)
		}
	}
	if len(userIDs) == 0 {
		return nil, nil
	}
	users, err := app.FindRecordsByIds("users", userIDs)
	if err != nil {
		return nil, err
	}
	out := users[:0]
	for _, user := range users {
		if !user.GetBool("disabled") {
			out = append(out, user)
		}
	}
	slices.SortFunc(out, func(a, b *core.Record) int { return strings.Compare(a.Id, b.Id) })
	return out, nil
}

// notUnique says whether a save was refused because the row is already there: by
// the validation of the unique index (PocketBase checks it before the insert), or
// by the index itself when two programs insert at once.
func notUnique(err error) bool {
	var invalid validation.Errors
	if errors.As(err, &invalid) {
		for _, fieldErr := range invalid {
			var coded validation.Error
			if errors.As(fieldErr, &coded) && coded.Code() == "validation_not_unique" {
				return true
			}
		}
	}
	return strings.Contains(err.Error(), "UNIQUE constraint failed")
}
