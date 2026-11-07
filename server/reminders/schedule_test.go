package reminders_test

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/push"
	"courses/server/reminders"
	"courses/server/testutil"
)

var paris = func() *time.Location {
	zone, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		panic(err)
	}
	return zone
}()

// parisAt is a wall time of Paris. The openings of these tests are at :05 and
// not on the hour: the first pass of each hour deletes the old rows by their
// real creation date, which is not the date of the fake clock.
func parisAt(day, hhmm string) time.Time {
	moment, err := time.ParseInLocation("2006-01-02 15:04", day+" "+hhmm, paris)
	if err != nil {
		panic(err)
	}
	return moment
}

// sending is what the fake notifier was asked.
type sending struct {
	user   string
	opts   push.Options
	bodies map[string]push.Message // by the language of a device
}

// notifier is a Notifier of the tests: it records the sendings, and says that
// each device of the account took the message.
type notifier struct {
	mu        sync.Mutex
	unusable  bool
	err       error
	delivery  *push.Delivery
	sendings  []sending
	beforeEnd func()
	// sendCtxErr is the state of the context of the last sending, once it ended.
	sendCtxErr error
}

func (n *notifier) Available() bool {
	n.mu.Lock()
	defer n.mu.Unlock()
	return !n.unusable
}

func (n *notifier) SendToUser(ctx context.Context, app core.App, userID string,
	message func(lang string) push.Message, opts push.Options) (push.Delivery, error) {
	devices, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": userID})
	if err != nil {
		return push.Delivery{}, err
	}
	n.mu.Lock()
	defer n.mu.Unlock()
	if n.err != nil {
		return push.Delivery{}, n.err
	}
	s := sending{user: userID, opts: opts, bodies: map[string]push.Message{}}
	for _, device := range devices {
		s.bodies[device.GetString("lang")] = message(device.GetString("lang"))
	}
	n.sendings = append(n.sendings, s)
	if n.beforeEnd != nil {
		n.beforeEnd()
	}
	n.sendCtxErr = ctx.Err()
	if n.delivery != nil {
		return *n.delivery, nil
	}
	return push.Delivery{Sent: len(devices)}, nil
}

// users returns who was sent to, in order.
func (n *notifier) users() []string {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []string
	for _, s := range n.sendings {
		out = append(out, s.user)
	}
	return out
}

// world is an application, its accounts and what the tests add to it.
type world struct {
	t   *testing.T
	app *tests.TestApp
	fx  testutil.Fixture
	n   *notifier
	seq atomic.Int32
}

func newWorld(t *testing.T) *world {
	t.Helper()
	app := testutil.NewApp(t)
	return &world{t: t, app: app, fx: testutil.Seed(t, app), n: &notifier{}}
}

func (w *world) save(collection string, values map[string]any) *core.Record {
	w.t.Helper()
	c, err := w.app.FindCollectionByNameOrId(collection)
	if err != nil {
		w.t.Fatal(err)
	}
	record := core.NewRecord(c)
	for k, v := range values {
		record.Set(k, v)
	}
	if err := w.app.Save(record); err != nil {
		w.t.Fatalf("saving a %s record: %v", collection, err)
	}
	return record
}

// event makes an event whose registration opens on day at hhmm (or all day).
func (w *world) event(name, day, hhmm string) *core.Record {
	return w.save("events", map[string]any{
		"name": name, "location": "Annecy", "start_date": "2028-03-01", "created_by": w.fx.AliceRunner.Id,
		"registration_opening": day, "registration_opening_time": hhmm,
	})
}

// moveOpening changes the opening of the event.
func (w *world) moveOpening(event *core.Record, day, hhmm string) {
	w.t.Helper()
	event.Set("registration_opening", day)
	event.Set("registration_opening_time", hhmm)
	if err := w.app.Save(event); err != nil {
		w.t.Fatal(err)
	}
}

// take gives the runner a participation on a new format of the event.
func (w *world) take(runner, event *core.Record, status string) {
	w.t.Helper()
	format := w.save("formats", map[string]any{"event": event.Id, "race_type": w.fx.Trail.Id, "distance_km": 10})
	w.save("participations", map[string]any{
		"runner": runner.Id, "format": format.Id, "status": status, "confirmed": true, "added_by": w.fx.AliceRunner.Id,
	})
}

// takeEvent gives the runner a participation on the event alone.
func (w *world) takeEvent(runner, event *core.Record, status string) {
	w.t.Helper()
	w.save("participations", map[string]any{
		"runner": runner.Id, "event": event.Id, "status": status, "confirmed": true, "added_by": w.fx.AliceRunner.Id,
	})
}

// choose sets the reminders of the account.
func (w *world) choose(user *core.Record, kinds ...string) {
	w.t.Helper()
	fresh, err := w.app.FindRecordById("users", user.Id)
	if err != nil {
		w.t.Fatal(err)
	}
	fresh.Set("reminders", kinds)
	if err := w.app.Save(fresh); err != nil {
		w.t.Fatal(err)
	}
}

// device gives the account a device of that language.
func (w *world) device(user *core.Record, lang string) {
	w.t.Helper()
	w.save("push_subscriptions", map[string]any{
		"user": user.Id, "endpoint": fmt.Sprintf("https://fcm.googleapis.com/fcm/send/device-%d", w.seq.Add(1)),
		"p256dh": "k", "auth": "a", "lang": lang,
	})
}

// run is a pass at the moment.
func (w *world) run(moment time.Time) reminders.Report {
	w.t.Helper()
	report, err := reminders.Run(context.Background(), w.app, moment, w.n)
	if err != nil {
		w.t.Fatal(err)
	}
	return report
}

// deliveries is how many rows the table holds.
func (w *world) deliveries() int {
	w.t.Helper()
	n, err := w.app.CountRecords("reminder_deliveries")
	if err != nil {
		w.t.Fatal(err)
	}
	return int(n)
}

// account makes an account with a runner and a choice.
func (w *world) account(name string, disabled bool, kinds ...string) (*core.Record, *core.Record) {
	w.t.Helper()
	user := w.save("users", map[string]any{
		"email": name + "@example.test", "password": testutil.Password, "role": "member", "verified": true,
		"reminders": kinds, "disabled": disabled,
	})
	runner := w.save("runners", map[string]any{"name": name, "user": user.Id})
	return user, runner
}

func TestReminders_Due(t *testing.T) {
	T := parisAt("2027-01-12", "10:05")
	both, day, hour := []string{"day", "hour"}, []string{"day"}, []string{"hour"}
	for _, row := range []struct {
		name  string
		now   time.Time
		kinds []string
		want  string
	}{
		{"25 hours before", T.Add(-25 * time.Hour), both, ""},
		{"just over 24 hours before", T.Add(-24*time.Hour - time.Second), both, ""},
		{"24 hours before", T.Add(-24 * time.Hour), both, "day"},
		{"90 minutes before", T.Add(-90 * time.Minute), both, "day"},
		{"60 minutes before, both chosen: the hour", T.Add(-60 * time.Minute), both, "hour"},
		{"60 minutes before, only the day chosen", T.Add(-60 * time.Minute), day, "day"},
		{"30 seconds before", T.Add(-30 * time.Second), hour, "hour"},
		{"30 seconds before, only the day", T.Add(-30 * time.Second), day, "day"},
		{"90 minutes before, only the hour", T.Add(-90 * time.Minute), hour, ""},
		{"at T", T, both, ""},
		{"a minute after T", T.Add(time.Minute), both, ""},
		{"an empty choice", T.Add(-30 * time.Minute), nil, ""},
		{"a choice that is not a kind", T.Add(-30 * time.Minute), []string{"week"}, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			got, ok := reminders.Due(T, row.now, row.kinds)
			if got != row.want || ok != (row.want != "") {
				t.Errorf("due = %q, %v; want %q", got, ok, row.want)
			}
		})
	}
}

func TestReminders_Recipients(t *testing.T) {
	w := newWorld(t)
	T := parisAt("2027-01-12", "10:05")
	event := w.event("Trail d'Hiver", "2027-01-12", "10:05")
	other := w.event("Trail sans personne", "2027-01-12", "10:05")

	// Alice: two formats of one race, one reminder. Bob: the event alone. Admin: registered.
	w.choose(w.fx.Alice, "day")
	w.choose(w.fx.Bob, "day")
	w.choose(w.fx.Admin, "day")
	for _, user := range []*core.Record{w.fx.Alice, w.fx.Bob, w.fx.Admin} {
		w.device(user, "fr")
	}
	w.take(w.fx.AliceRunner, event, "interested")
	w.take(w.fx.AliceRunner, event, "registered")
	w.takeEvent(w.fx.BobRunner, event, "interested")
	w.take(w.fx.AdminRunner, event, "registered")

	// Nobody else: a supporter, a person who does not start, a runner with no
	// account, a disabled account, an empty choice.
	supporter, supporterRunner := w.account("sue", false, "day")
	w.device(supporter, "fr")
	w.takeEvent(supporterRunner, event, "supporter")
	dns, dnsRunner := w.account("dan", false, "day")
	w.device(dns, "fr")
	w.take(dnsRunner, event, "dns")
	w.take(w.fx.SamRunner, event, "interested")
	disabled, disabledRunner := w.account("eve", true, "day")
	w.device(disabled, "fr")
	w.take(disabledRunner, event, "interested")
	never, neverRunner := w.account("fay", false)
	w.device(never, "fr")
	w.take(neverRunner, event, "interested")
	// And somebody who has a part in another event only.
	elsewhere, elsewhereRunner := w.account("gus", false, "day")
	w.device(elsewhere, "fr")
	w.takeEvent(elsewhereRunner, other, "supporter")

	report := w.run(T.Add(-3 * time.Hour))
	got := w.n.users()
	slices.Sort(got)
	want := []string{w.fx.Admin.Id, w.fx.Alice.Id, w.fx.Bob.Id}
	slices.Sort(want)
	if !slices.Equal(got, want) {
		t.Errorf("sent to %v, want Admin, Alice and Bob once each: %v", got, want)
	}
	if report.Due != 3 || report.Sent != 3 || report.Failed != 0 {
		t.Errorf("report = %+v, want 3 due and sent", report)
	}
}

func TestReminders_Windows(t *testing.T) {
	for _, row := range []struct{ name, day string }{
		{"in winter (UTC+1)", "2027-01-12"},
		{"in summer (UTC+2)", "2027-07-13"},
	} {
		t.Run(row.name, func(t *testing.T) {
			w := newWorld(t)
			T := parisAt(row.day, "10:05")
			event := w.event("Trail", row.day, "10:05")
			w.choose(w.fx.Alice, "day", "hour")
			w.device(w.fx.Alice, "fr")
			w.take(w.fx.AliceRunner, event, "interested")

			w.run(T.Add(-24*time.Hour - time.Minute))
			if n := len(w.n.users()); n != 0 {
				t.Fatalf("a reminder was sent more than 24 hours before (%d)", n)
			}
			w.run(T.Add(-24 * time.Hour))
			if n := len(w.n.users()); n != 1 || w.n.sendings[0].opts.Urgency != "normal" {
				t.Fatalf("at T-24h: %d sent, want the day's", n)
			}
			w.run(T.Add(-time.Hour - time.Minute))
			if n := len(w.n.users()); n != 1 {
				t.Fatalf("a second reminder was sent before the hour (%d)", n)
			}
			w.run(T.Add(-time.Hour))
			if n := len(w.n.users()); n != 2 || w.n.sendings[1].opts.Urgency != "high" {
				t.Fatalf("at T-1h: %d sent, want the hour's too", n)
			}
			w.run(T)
			if n := len(w.n.users()); n != 2 {
				t.Errorf("a reminder was sent at T (%d)", n)
			}
			// The wall clock of Paris, not of UTC: the row says the instant in UTC.
			rows, _ := w.app.FindAllRecords("reminder_deliveries")
			if len(rows) != 2 {
				t.Fatalf("%d rows, want 2", len(rows))
			}
			if got := rows[0].GetString("opening_at"); got != T.UTC().Format(time.RFC3339) {
				t.Errorf("opening_at = %q, want %s", got, T.UTC().Format(time.RFC3339))
			}
		})
	}

	// § 4.1 promises « la veille à 9 h »: across the two changes of hour, the day
	// reminder of an opening with no time still comes at 9:00 in Paris (it would
	// be 8:00 or 10:00 if the window were counted as 24 hours of the clock).
	for _, row := range []struct{ name, day, eve string }{
		{"the eve of the change to summer time", "2027-03-28", "2027-03-27"},
		{"the eve of the change to winter time", "2027-10-31", "2027-10-30"},
	} {
		t.Run(row.name, func(t *testing.T) {
			w := newWorld(t)
			event := w.event("Trail du Jour", row.day, "")
			w.choose(w.fx.Alice, "day")
			w.device(w.fx.Alice, "fr")
			w.take(w.fx.AliceRunner, event, "interested")
			for _, early := range []string{"08:00", "08:59", "09:00"} {
				w.run(parisAt(row.eve, early))
				if sent := len(w.n.users()); (early == "09:00") != (sent == 1) {
					t.Fatalf("at %s the day before: %d sendings, want one from 09:00 and none before", early, sent)
				}
			}
		})
	}

	t.Run("an opening with no time is at 9:00: the day before at 9:00, the day at 8:00", func(t *testing.T) {
		w := newWorld(t)
		event := w.event("Trail du Jour", "2027-02-03", "")
		w.choose(w.fx.Alice, "day", "hour")
		w.device(w.fx.Alice, "en")
		w.take(w.fx.AliceRunner, event, "interested")

		w.run(parisAt("2027-02-02", "08:59"))
		if len(w.n.users()) != 0 {
			t.Fatal("sent before 9:00 the day before")
		}
		w.run(parisAt("2027-02-02", "09:00"))
		if len(w.n.users()) != 1 {
			t.Fatal("not sent at 9:00 the day before")
		}
		if body := w.n.sendings[0].bodies["en"].Body; body != "Registration opens tomorrow." {
			t.Errorf("body = %q", body)
		}
		w.run(parisAt("2027-02-03", "07:59"))
		if len(w.n.users()) != 1 {
			t.Fatal("the hour's reminder was sent before 8:00")
		}
		w.run(parisAt("2027-02-03", "08:00"))
		if len(w.n.users()) != 2 {
			t.Fatal("not sent at 8:00 the day itself")
		}
		if body := w.n.sendings[1].bodies["en"].Body; body != "Registration opens today." {
			t.Errorf("body = %q", body)
		}
	})
}

func TestReminders_OncePerOpening(t *testing.T) {
	setUp := func(t *testing.T) (*world, time.Time) {
		w := newWorld(t)
		event := w.event("Trail", "2027-01-12", "10:05")
		w.choose(w.fx.Alice, "day")
		w.device(w.fx.Alice, "fr")
		w.take(w.fx.AliceRunner, event, "interested")
		return w, parisAt("2027-01-12", "10:05")
	}

	t.Run("two passes a minute apart", func(t *testing.T) {
		w, T := setUp(t)
		first := w.run(T.Add(-3 * time.Hour))
		second := w.run(T.Add(-3*time.Hour + time.Minute))
		if n := len(w.n.users()); n != 1 {
			t.Errorf("%d sendings, want 1", n)
		}
		if second.Due != 0 {
			t.Errorf("a reminder that was done counts as due again: %+v", second)
		}
		if first.Sent != 1 || second.Sent != 0 || second.Skipped != 1 {
			t.Errorf("reports %+v then %+v, want 1 sent then 1 skipped", first, second)
		}
		row, err := w.app.FindFirstRecordByFilter("reminder_deliveries", "kind = 'day'")
		if err != nil {
			t.Fatal(err)
		}
		if row.GetInt("delivered") != 1 {
			t.Errorf("delivered = %d, want 1", row.GetInt("delivered"))
		}
	})

	t.Run("two programs at once", func(t *testing.T) {
		w, T := setUp(t)
		var wg sync.WaitGroup
		for range 8 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				// An error of the database under the pressure is not the point: the
				// rows and the sendings are.
				_, _ = reminders.Run(context.Background(), w.app, T.Add(-3*time.Hour), w.n)
			}()
		}
		wg.Wait()
		if n := len(w.n.users()); n != 1 {
			t.Errorf("%d sendings, want exactly 1", n)
		}
		if w.deliveries() != 1 {
			t.Errorf("%d rows, want 1", w.deliveries())
		}
	})
}

func TestReminders_MovedOpeningRearms(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day")
	w.device(w.fx.Alice, "fr")
	w.take(w.fx.AliceRunner, event, "interested")
	T := parisAt("2027-01-12", "10:05")

	w.run(T.Add(-20 * time.Hour))
	if len(w.n.users()) != 1 {
		t.Fatal("the first reminder was not sent")
	}
	// Moved to the next day.
	w.moveOpening(event, "2027-01-13", "10:05")
	w.run(T.Add(-20 * time.Hour))
	if len(w.n.users()) != 1 {
		t.Fatal("a reminder was sent for an opening that is 44 hours away")
	}
	w.run(parisAt("2027-01-13", "10:05").Add(-20 * time.Hour))
	if len(w.n.users()) != 2 {
		t.Fatalf("the moved opening did not send again: %d sendings", len(w.n.users()))
	}
	// And to another hour of that day.
	w.moveOpening(event, "2027-01-13", "11:05")
	w.run(parisAt("2027-01-13", "11:05").Add(-20 * time.Hour))
	if len(w.n.users()) != 3 || w.deliveries() != 3 {
		t.Errorf("a new hour did not send again: %d sendings, %d rows", len(w.n.users()), w.deliveries())
	}
}

func TestReminders_CatchUpAfterRestart(t *testing.T) {
	setUp := func(t *testing.T, hhmm string) (*world, time.Time) {
		w := newWorld(t)
		event := w.event("Trail", "2027-01-12", hhmm)
		w.choose(w.fx.Alice, "day")
		w.device(w.fx.Alice, "fr")
		w.take(w.fx.AliceRunner, event, "interested")
		return w, parisAt("2027-01-12", hhmm)
	}

	t.Run("the same day", func(t *testing.T) {
		w, T := setUp(t, "10:05")
		// Nothing ran from T-24h to T-3h.
		w.run(T.Add(-3 * time.Hour))
		if n := len(w.n.users()); n != 1 {
			t.Fatalf("%d sendings, want the late one", n)
		}
		if body := w.n.sendings[0].bodies["fr"].Body; body != "Les inscriptions ouvrent aujourd'hui à 10:05." {
			t.Errorf("body = %q", body)
		}
	})
	t.Run("the day before by the clock of Paris", func(t *testing.T) {
		w, T := setUp(t, "02:05")
		w.run(T.Add(-3 * time.Hour))
		if len(w.n.users()) != 1 {
			t.Fatal("not sent")
		}
		if body := w.n.sendings[0].bodies["fr"].Body; body != "Les inscriptions ouvrent demain à 02:05." {
			t.Errorf("body = %q", body)
		}
	})
	t.Run("within 2 hours", func(t *testing.T) {
		w, T := setUp(t, "10:05")
		w.run(T.Add(-45 * time.Minute))
		if len(w.n.users()) != 1 {
			t.Fatal("not sent")
		}
		if body := w.n.sendings[0].bodies["fr"].Body; body != "Les inscriptions ouvrent à 10:05, dans 45 min." {
			t.Errorf("body = %q", body)
		}
	})
	t.Run("after T, nothing", func(t *testing.T) {
		w, T := setUp(t, "10:05")
		w.run(T)
		w.run(T.Add(time.Minute))
		w.run(T.Add(5 * time.Hour))
		if len(w.n.users()) != 0 || w.deliveries() != 0 {
			t.Errorf("%d sendings, %d rows after the opening", len(w.n.users()), w.deliveries())
		}
	})
}

func TestReminders_NoDeviceNoRow(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day", "hour")
	w.take(w.fx.AliceRunner, event, "interested")
	T := parisAt("2027-01-12", "10:05")

	report := w.run(T.Add(-3 * time.Hour))
	if len(w.n.users()) != 0 || w.deliveries() != 0 || report.Skipped != 1 || report.Due != 0 {
		t.Fatalf("no device: %d sendings, %d rows, %+v", len(w.n.users()), w.deliveries(), report)
	}
	// A device activated before T still gets the reminder that is due.
	w.device(w.fx.Alice, "fr")
	w.run(T.Add(-2 * time.Hour))
	if len(w.n.users()) != 1 || w.deliveries() != 1 {
		t.Errorf("after the device: %d sendings, %d rows, want 1 and 1", len(w.n.users()), w.deliveries())
	}
}

func TestReminders_Payload(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail d'Hiver", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day", "hour")
	w.device(w.fx.Alice, "fr")
	w.device(w.fx.Alice, "en")
	w.take(w.fx.AliceRunner, event, "interested")
	T := parisAt("2027-01-12", "10:05")

	w.run(T.Add(-3 * time.Hour))
	w.run(T.Add(-30 * time.Minute))
	if len(w.n.sendings) != 2 {
		t.Fatalf("%d sendings, want 2", len(w.n.sendings))
	}
	day, hour := w.n.sendings[0], w.n.sendings[1]
	for name, got := range map[string]sending{"day": day, "hour": hour} {
		for lang, m := range got.bodies {
			if m.Title != "Trail d'Hiver" || m.URL != "/evenements/"+event.Id || m.Tag != "opening-"+event.Id {
				t.Errorf("%s/%s: message %+v", name, lang, m)
			}
		}
		if got.opts.Topic != "opening-"+event.Id {
			t.Errorf("%s: topic %q, want opening-<id>", name, got.opts.Topic)
		}
	}
	for _, row := range []struct {
		name    string
		got     sending
		fr, en  string
		ttl     time.Duration
		urgency string
	}{
		{"day", day, "Les inscriptions ouvrent aujourd'hui à 10:05.", "Registration opens today at 10:05.", 3 * time.Hour, "normal"},
		{"hour", hour, "Les inscriptions ouvrent à 10:05, dans 30 min.", "Registration opens at 10:05, in 30 min.", 30 * time.Minute, "high"},
	} {
		if row.got.bodies["fr"].Body != row.fr || row.got.bodies["en"].Body != row.en {
			t.Errorf("%s: bodies %q / %q", row.name, row.got.bodies["fr"].Body, row.got.bodies["en"].Body)
		}
		if row.got.opts.TTL != row.ttl || row.got.opts.Urgency != row.urgency {
			t.Errorf("%s: TTL %v and urgency %q, want %v and %q", row.name, row.got.opts.TTL, row.got.opts.Urgency, row.ttl, row.urgency)
		}
	}

	// Less than a minute left: the TTL is the least that the push services take.
	w.n.mu.Lock()
	w.n.sendings = nil
	w.n.mu.Unlock()
	other := w.event("Trail du Soir", "2027-01-12", "18:05")
	w.take(w.fx.AliceRunner, other, "interested")
	w.run(parisAt("2027-01-12", "18:05").Add(-20 * time.Second))
	if len(w.n.sendings) != 1 || w.n.sendings[0].opts.TTL != time.Minute {
		t.Errorf("TTL with 20 s left: %+v, want 1 minute", w.n.sendings)
	}
}

func TestReminders_Retention(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	now := parisAt("2027-03-20", "10:00")
	row := func(kind string, age time.Duration) string {
		r := w.save("reminder_deliveries", map[string]any{
			"user": w.fx.Alice.Id, "event": event.Id, "kind": kind, "opening_at": fmt.Sprint(age), "delivered": 1,
		})
		stamp := now.Add(-age).UTC().Format("2006-01-02 15:04:05.000Z")
		if _, err := w.app.DB().NewQuery("UPDATE reminder_deliveries SET created = {:c} WHERE id = {:id}").
			Bind(dbx.Params{"c": stamp, "id": r.Id}).Execute(); err != nil {
			t.Fatal(err)
		}
		return r.Id
	}
	old := row("day", 61*24*time.Hour)
	recent := row("hour", 59*24*time.Hour)

	// Not at minute 30.
	w.run(now.Add(30 * time.Minute))
	if w.deliveries() != 2 {
		t.Fatalf("a row was deleted at minute 30: %d left", w.deliveries())
	}
	// The first pass of the hour.
	w.run(now)
	if _, err := w.app.FindRecordById("reminder_deliveries", old); err == nil {
		t.Error("a row of 61 days is still there")
	}
	if _, err := w.app.FindRecordById("reminder_deliveries", recent); err != nil {
		t.Errorf("a row of 59 days was deleted: %v", err)
	}
}

// Before the keys are read there is nothing to send with: the pass does
// nothing, records nothing, and is not an error; the next minute tries again.
func TestReminders_NotReadyIsHarmless(t *testing.T) {
	T := parisAt("2027-01-12", "10:05")
	setUp := func(t *testing.T) *world {
		w := newWorld(t)
		event := w.event("Trail", "2027-01-12", "10:05")
		w.choose(w.fx.Alice, "day")
		w.device(w.fx.Alice, "fr")
		w.take(w.fx.AliceRunner, event, "interested")
		return w
	}

	t.Run("the keys are not read yet", func(t *testing.T) {
		w := setUp(t)
		w.n.unusable = true
		report := w.run(T.Add(-3 * time.Hour))
		if report != (reminders.Report{}) || w.deliveries() != 0 || len(w.n.users()) != 0 {
			t.Fatalf("a pass without keys: %+v, %d rows, %d sendings", report, w.deliveries(), len(w.n.users()))
		}
		w.n.unusable = false
		w.run(T.Add(-3*time.Hour + time.Minute))
		if len(w.n.users()) != 1 {
			t.Error("the next minute did not send")
		}
	})

	t.Run("a notifier that is gone between the check and the send: the row is taken back", func(t *testing.T) {
		w := setUp(t)
		w.n.err = push.ErrUnavailable
		report := w.run(T.Add(-3 * time.Hour))
		if w.deliveries() != 0 || report.Failed != 1 || report.Sent != 0 {
			t.Fatalf("with ErrUnavailable: %d rows, %+v; want the row taken back", w.deliveries(), report)
		}
		w.n.err = nil
		w.run(T.Add(-3*time.Hour + time.Minute))
		if len(w.n.users()) != 1 || w.deliveries() != 1 {
			t.Error("the minute after ErrUnavailable did not send")
		}
	})
}

// Devices that all failed: the reminder is not tried again (spec § 4.5.7).
func TestReminders_FailedDevicesAreNotRetried(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day")
	w.device(w.fx.Alice, "fr")
	w.take(w.fx.AliceRunner, event, "interested")
	T := parisAt("2027-01-12", "10:05")
	w.n.delivery = &push.Delivery{Failed: 1}

	if report := w.run(T.Add(-3 * time.Hour)); report.Failed != 1 || report.Sent != 0 {
		t.Errorf("report = %+v, want 1 failed", report)
	}
	w.run(T.Add(-3*time.Hour + time.Minute))
	if len(w.n.users()) != 1 || w.deliveries() != 1 {
		t.Errorf("%d sendings, %d rows: a failed reminder must not be sent again", len(w.n.users()), w.deliveries())
	}
}

// A program that stops in the middle of a sending may already have handed the
// message to a push service: the row stays, and the reminder is not sent again
// after the restart (spec § 4.6: lose rather than send twice).
func TestReminders_StoppingKeepsTheReminder(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day")
	w.device(w.fx.Alice, "fr")
	w.take(w.fx.AliceRunner, event, "interested")
	T := parisAt("2027-01-12", "10:05")

	ctx, cancel := context.WithCancel(context.Background())
	w.n.delivery = &push.Delivery{} // the sending was cut short: nobody counted
	w.n.beforeEnd = cancel
	if _, err := reminders.Run(ctx, w.app, T.Add(-3*time.Hour), w.n); err != nil {
		t.Fatal(err)
	}
	if w.deliveries() != 1 {
		t.Fatal("the row of a cut-short sending was taken back: the reminder would be sent twice")
	}
	// The restart, a minute later and before T.
	w.n.delivery, w.n.beforeEnd = nil, nil
	w.run(T.Add(-3*time.Hour + time.Minute))
	if len(w.n.users()) != 1 {
		t.Errorf("%d sendings after the restart, want the one that was cut short and no other", len(w.n.users()))
	}
}

// The end of the program waits for a pass that is running, so that its sending
// is not cut short.
func TestReminders_StopWaitsForARunningPass(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	w.choose(w.fx.Alice, "day")
	w.device(w.fx.Alice, "fr")
	w.take(w.fx.AliceRunner, event, "interested")
	reminders.SetNow(t, parisAt("2027-01-12", "10:05").Add(-3*time.Hour))
	reminders.RegisterJob(w.app, w.n)
	reminders.Serve(t, w.app)

	started := make(chan struct{})
	w.n.beforeEnd = func() {
		close(started)
		time.Sleep(400 * time.Millisecond)
	}
	var job interface{ Run() }
	for _, j := range w.app.Cron().Jobs() {
		if j.Id() == reminders.JobName {
			job = j
		}
	}
	if job == nil {
		t.Fatal("no job")
	}
	finished := make(chan struct{})
	go func() { job.Run(); close(finished) }()
	<-started
	begun := time.Now()
	if err := w.app.OnTerminate().Trigger(&core.TerminateEvent{App: w.app}, func(*core.TerminateEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	if time.Since(begun) < 300*time.Millisecond {
		t.Error("the end of the program did not wait for the running pass")
	}
	<-finished
	if w.n.sendCtxErr != nil {
		t.Errorf("the sending was cancelled while it ran: %v", w.n.sendCtxErr)
	}
}

func TestReminders_JobRegistered(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)
	reminders.Serve(t, app)
	var found bool
	for _, job := range app.Cron().Jobs() {
		if job.Id() == reminders.JobName {
			found = true
			if job.Expression() != "* * * * *" {
				t.Errorf("the job runs at %q, want every minute", job.Expression())
			}
			// A tick with nothing to send is harmless.
			reminders.SetNow(t, parisAt("2027-01-12", "10:05"))
			job.Run()
		}
	}
	if !found {
		t.Errorf("no cron job %q after the start", reminders.JobName)
	}
}

func TestReminders_NoJobOnTheDemo(t *testing.T) {
	t.Run("the demo", func(t *testing.T) {
		app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
		testutil.Seed(t, app)
		reminders.Serve(t, app)
		if hasJob(app) {
			t.Errorf("the demo has the job %q", reminders.JobName)
		}
	})
	t.Run("a notifier that is not available", func(t *testing.T) {
		app := testutil.NewApp(t)
		testutil.Seed(t, app)
		if err := os.WriteFile(filepath.Join(app.DataDir(), "push_vapid.json"), []byte("garbage"), 0o600); err != nil {
			t.Fatal(err)
		}
		reminders.Serve(t, app)
		if hasJob(app) {
			t.Errorf("the job %q is there although the keys cannot be read", reminders.JobName)
		}
	})
}

func hasJob(app core.App) bool {
	for _, job := range app.Cron().Jobs() {
		if job.Id() == reminders.JobName {
			return true
		}
	}
	return false
}

// A pass that is long does not send after T: each person is handled at the
// instant of their turn, with the text and the TTL of that instant.
func TestReminders_LongPassStopsAtT(t *testing.T) {
	w := newWorld(t)
	event := w.event("Trail", "2027-01-12", "10:05")
	for _, runner := range []*core.Record{w.fx.AliceRunner, w.fx.BobRunner} {
		w.take(runner, event, "interested")
	}
	for _, user := range []*core.Record{w.fx.Alice, w.fx.Bob} {
		w.choose(user, "hour")
		w.device(user, "fr")
	}
	w.n.beforeEnd = func() { time.Sleep(1500 * time.Millisecond) }
	// A second before T: the first send takes longer than that.
	w.run(parisAt("2027-01-12", "10:05").Add(-time.Second))
	if n := len(w.n.users()); n != 1 {
		t.Errorf("%d sendings, want 1: the second person was reached after T", n)
	}
}
