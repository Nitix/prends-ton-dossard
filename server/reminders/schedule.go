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

// stopGrace is how long the end of the program waits for a pass that is running
// (Docker gives a container 10 seconds).
var stopGrace = 5 * time.Second

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

// Report is what a pass did, in reminders (a person and a kind for one opening of
// one event, an opening being a format's own or the event's):
// Due were due and had a device, Sent reached at least one device, Failed
// reached none, Skipped were already done or had no device to reach.
type Report struct{ Due, Sent, Failed, Skipped int }

// registerJob adds the cron job of the scheduler. It is bound to the start of
// the server, after the keys of the push service were read (which is also at the
// start of the server): a service whose keys cannot be read has no job.
func registerJob(app core.App, notifier Notifier) {
	// Cancelled when the program ends, but only after a pass that is running has
	// had a few seconds to finish: a request cut short may already be at the push
	// service, and the reminder is then not sent again after the restart.
	ctx, cancel := context.WithCancel(context.Background())
	var running sync.Mutex
	app.OnTerminate().BindFunc(func(e *core.TerminateEvent) error {
		finished := make(chan struct{})
		go func() {
			running.Lock()
			running.Unlock() //nolint:staticcheck // waiting is the point
			close(finished)
		}()
		select {
		case <-finished:
		case <-time.After(stopGrace):
		}
		cancel()
		return e.Next()
	})

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
// the same wall time of Paris the day before (T - 24 h, but for the two nights of
// the change of hour) to T, except that "day" gives way when "hour" is due and chosen: two
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
	if slices.Contains(kinds, KindDay) && !now.Before(dayOpens(T)) {
		return KindDay, true
	}
	return "", false
}

// Run sends the reminders that are due at at (spec § 4.3, § 4.6), and returns
// what it did. Nothing is sent, and nothing is recorded, while the notifier is
// not available: the pass is a no-op that the next minute tries again.
//
// The events considered are those with an opening today, tomorrow or the day
// after in Paris, of their own or of one of their formats. For each person who
// gets their reminders (§ 4.2), the openings that count are those of the formats
// they are on (the event's, or the next to come, for a person with no format or a
// format with no opening of its own), taken at the instant of their turn. For
// each of them that is due from the same wall-clock time of Paris the day before
// (see dayOpens; not 24 hours of the clock, which two nights of the year are not
// the same hour), the kind that is due: a row of reminder_deliveries is inserted
// first, and a row that the unique index refuses means that the reminder is
// already done; then the message is sent to the devices of the person. A person
// with no device has no row, so that a device activated before T still gets the
// reminder. A program stopped between the insert and the send loses that reminder
// rather than sending two. An event that cannot be read is skipped, and the
// others go on. Once an hour, at minute 0, the rows older than 60 days are deleted.
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

	local := at.In(parisZone())
	days := make([]any, 3)
	for i := range days {
		days[i] = local.AddDate(0, 0, i).Format("2006-01-02")
	}
	// The events that have an opening in these days, of their own or of one of
	// their formats (a format with a time alone opens on its event's day, which the
	// first query already finds).
	candidates, err := app.FindAllRecords("events", dbx.In("registration_opening", days...))
	if err != nil {
		return report, err
	}
	formatDays, err := app.FindAllRecords("formats", dbx.In("registration_opening", days...))
	if err != nil {
		return report, err
	}
	var more []string
	for _, f := range formatDays {
		id := f.GetString("event")
		if id != "" && !slices.Contains(more, id) && !slices.ContainsFunc(candidates, func(e *core.Record) bool { return e.Id == id }) {
			more = append(more, id)
		}
	}
	if len(more) > 0 {
		extra, err := app.FindRecordsByIds("events", more)
		if err != nil {
			return report, err
		}
		candidates = append(candidates, extra...)
	}

	// The openings of each event, kept only when one of them can be due now. The
	// day window opens at the wall clock of the day before, which is up to 25 hours
	// before T across the change of hour.
	type candidate struct {
		event    *core.Record
		openings events.EventOpenings
		formats  map[string]*core.Record
	}
	var todo []candidate
	var ids []any
	var firstErr error
	for _, event := range candidates {
		formats, err := app.FindAllRecords("formats", dbx.HashExp{"event": event.Id})
		if err != nil {
			// One event that cannot be read does not stop the others.
			firstErr = errors.Join(firstErr, err)
			continue
		}
		fields := make([]events.FormatOpeningFields, 0, len(formats))
		byID := make(map[string]*core.Record, len(formats))
		for _, f := range formats {
			byID[f.Id] = f
			fields = append(fields, events.FormatOpeningFields{
				ID: f.Id, Day: f.GetString("registration_opening"), Time: f.GetString("registration_opening_time"),
			})
		}
		openings := events.OpeningsOf(event.GetString("registration_opening"), event.GetString("registration_opening_time"), fields)
		soon := func(o events.Opening) bool {
			T, ok := o.Instant()
			return ok && at.Before(T) && T.Sub(at) <= 25*time.Hour
		}
		possible := openings.Event != nil && soon(*openings.Event)
		for _, o := range openings.Formats {
			possible = possible || soon(o)
		}
		if !possible {
			continue
		}
		// The names of the race types are only needed for the titles.
		if err := expandFormats(app, formats); err != nil {
			firstErr = errors.Join(firstErr, err)
			continue
		}
		todo = append(todo, candidate{event, openings, byID})
		ids = append(ids, event.Id)
	}
	if len(todo) == 0 {
		return report, firstErr
	}
	// What was already done for them: one query for the whole pass, so that a
	// minute with nothing new makes no failing insert. The unique index stays the
	// real guard.
	done, err := doneOf(app, ids)
	if err != nil {
		return report, err
	}

	// The clock moves during a pass, and a send can take seconds: each person is
	// handled at the instant when their turn comes, never after T.
	start := time.Now()
	for _, c := range todo {
		recipients, err := recipientsOf(app, c.event.Id)
		if err != nil {
			firstErr = errors.Join(firstErr, err)
			continue
		}
		for _, who := range recipients {
			if ctx.Err() != nil {
				return report, ctx.Err()
			}
			current := at.Add(time.Since(start))
			// Their openings: the one of each format they count on, or the general
			// one when they have no format, as of this instant.
			var theirs []events.Opening
			for _, formatID := range who.formats {
				if o, ok := c.openings.Of(formatID, events.PastAt(current)); ok {
					theirs = append(theirs, o)
				}
			}
			for _, o := range events.MergeSameInstant(theirs) {
				T, ok := o.Instant()
				if !ok || !current.Before(T) || T.Sub(current) > 25*time.Hour {
					continue
				}
				kind, ok := due(T, current, Of(who.user))
				if !ok {
					continue
				}
				if done[deliveryKey(who.user.Id, c.event.Id, kind, T)] {
					report.Skipped++
					continue
				}
				// The time is known when any of the formats opening at this instant has one.
				timeKnown := events.ValidTime(o.Time)
				for _, id := range o.FormatIDs {
					timeKnown = timeKnown || events.ValidTime(c.openings.Formats[id].Time)
				}
				remind(ctx, app, notifier, &report, c.event, who.user, kind, o, T, timeKnown, c.formats, current)
			}
		}
	}
	return report, firstErr
}

// deliveryKey is what the unique index of reminder_deliveries holds.
func deliveryKey(userID, eventID, kind string, T time.Time) string {
	return userID + "|" + eventID + "|" + kind + "|" + T.UTC().Format(time.RFC3339)
}

// doneOf returns the keys of the deliveries of the events.
func doneOf(app core.App, eventIDs []any) (map[string]bool, error) {
	rows, err := app.FindAllRecords("reminder_deliveries", dbx.In("event", eventIDs...))
	if err != nil {
		return nil, err
	}
	done := make(map[string]bool, len(rows))
	for _, row := range rows {
		done[strings.Join([]string{row.GetString("user"), row.GetString("event"), row.GetString("kind"), row.GetString("opening_at")}, "|")] = true
	}
	return done, nil
}

// remind does the reminder of one person for one event at the instant at, and
// counts it in report.
func remind(ctx context.Context, app core.App, notifier Notifier, report *Report,
	event, user *core.Record, kind string, opening events.Opening, T time.Time, timeKnown bool,
	formats map[string]*core.Record, at time.Time) {
	devices, err := app.CountRecords("push_subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		report.Failed++
		return
	}
	if devices == 0 {
		report.Skipped++
		return
	}

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
			report.Skipped++ // done by another program since the pass began
			return
		}
		app.Logger().Error("reminders: a delivery could not be recorded")
		report.Failed++
		return
	}
	report.Due++

	name, url := event.GetString("name"), "/evenements/"+event.Id
	// An opening of formats says which ones; one of the event does not. The id of
	// the first format keeps two openings of an event apart in the notification
	// tray (at most 32 characters: "opening-" and a 15-character id).
	tag := "opening-" + event.Id
	if len(opening.FormatIDs) > 0 {
		tag = "opening-" + opening.FormatIDs[0]
	}
	message := func(lang string) push.Message {
		w := wording.Of(lang)
		title := name
		var names []string
		for _, id := range opening.FormatIDs {
			f := formats[id]
			if f == nil {
				continue
			}
			label := ""
			if raceType := f.ExpandedOne("race_type"); raceType != nil {
				label = raceType.GetString("label")
			}
			names = append(names, w.RaceName(f.GetString("name"), label,
				f.GetFloat("distance_km"), f.GetInt("duration_min"), f.GetInt("time_limit_min")))
		}
		if len(names) > 0 {
			title += wording.Separator + strings.Join(names, ", ")
		}
		return push.Message{
			Title: title,
			Body:  w.ReminderBody(T, timeKnown, at),
			URL:   url,
			Tag:   tag,
		}
	}
	opts := push.Options{TTL: max(T.Sub(at).Round(time.Second), time.Minute), Urgency: "normal", Topic: tag}
	if kind == KindHour {
		opts.Urgency = "high"
	}
	out, err := notifier.SendToUser(ctx, app, user.Id, message, opts)
	if err != nil {
		// An error means that no device was tried (the service is not ready, the
		// devices cannot be read): the row is taken back, so that the next minute
		// tries again and the reminder is not lost. A sending that was cut short by
		// the end of the program is no error: some device may already have the
		// message, and the row stays (spec § 4.6: lose rather than send twice).
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

// recipient is an account that gets the reminders of an event, with the formats
// it counts on: the id of each format of an interested or registered
// participation, "" for one on the event alone.
type recipient struct {
	user    *core.Record
	formats []string
}

// recipientsOf returns the accounts that get the reminders of the event
// (§ 4.2): those whose runner is interested in it or registered to it, on a
// format or on the event alone, whose account is not disabled. A person is once,
// however many formats. A runner with no account, a supporter and a person who
// does not start have none.
func recipientsOf(app core.App, eventID string) ([]recipient, error) {
	participations, err := app.FindAllRecords("participations",
		dbx.HashExp{"event": eventID}, dbx.In("status", "interested", "registered"))
	if err != nil {
		return nil, err
	}
	formatsOfRunner := map[string][]string{}
	var runnerIDs []string
	for _, p := range participations {
		id := p.GetString("runner")
		if id == "" {
			continue
		}
		if !slices.Contains(runnerIDs, id) {
			runnerIDs = append(runnerIDs, id)
		}
		if f := p.GetString("format"); !slices.Contains(formatsOfRunner[id], f) {
			formatsOfRunner[id] = append(formatsOfRunner[id], f)
		}
	}
	if len(runnerIDs) == 0 {
		return nil, nil
	}
	runners, err := app.FindRecordsByIds("runners", runnerIDs)
	if err != nil {
		return nil, err
	}
	formatsOfUser := map[string][]string{}
	var userIDs []string
	for _, runner := range runners {
		id := runner.GetString("user")
		if id == "" {
			continue
		}
		if !slices.Contains(userIDs, id) {
			userIDs = append(userIDs, id)
		}
		for _, f := range formatsOfRunner[runner.Id] {
			if !slices.Contains(formatsOfUser[id], f) {
				formatsOfUser[id] = append(formatsOfUser[id], f)
			}
		}
	}
	if len(userIDs) == 0 {
		return nil, nil
	}
	users, err := app.FindRecordsByIds("users", userIDs)
	if err != nil {
		return nil, err
	}
	var out []recipient
	for _, user := range users {
		if !user.GetBool("disabled") {
			out = append(out, recipient{user, formatsOfUser[user.Id]})
		}
	}
	slices.SortFunc(out, func(a, b recipient) int { return strings.Compare(a.user.Id, b.user.Id) })
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

// parisZone is Paris, loaded once.
var parisZone = sync.OnceValue(func() *time.Location {
	zone, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		return time.UTC // a build without time/tzdata; the program embeds it
	}
	return zone
})

// dayOpens is the instant from which the "day" reminder is due: the wall clock
// of Paris of the day before, so that "la veille à 9 h" stays 9 h across the two
// changes of hour of the year (it is T - 24 h on every other day).
func dayOpens(T time.Time) time.Time {
	return T.In(parisZone()).AddDate(0, 0, -1)
}

// expandFormats reads the race types of the formats, for their names; the tests
// replace it to make one event unreadable.
var expandFormats = func(app core.App, formats []*core.Record) error {
	if failed := app.ExpandRecords(formats, []string{"race_type"}, nil); len(failed) > 0 {
		return errors.New("the race types of the formats could not be read")
	}
	return nil
}
