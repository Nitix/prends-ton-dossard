package admin_test

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/admin"
	"courses/server/apperr"
	"courses/server/testutil"
)

const (
	mergeEvents  = "/api/app/admin/merge-events"
	mergeFormats = "/api/app/admin/merge-formats"
)

// hook is a step of a test on the database of a test application.
type hook = func(testing.TB, *tests.TestApp, testutil.Fixture)

func path(url string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return url }
}

// merge builds the request body of a merge: the record kept, the one merged
// into it, and whether it is a dry run.
func merge(keep, other func(testutil.Fixture) string, dryRun bool) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		return fmt.Sprintf(`{"keepId":%q,"mergeId":%q,"dryRun":%t}`, keep(fx), other(fx), dryRun)
	}
}

// id returns the id of a fixture record.
func id(of func(testutil.Fixture) *core.Record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string { return of(fx).Id }
}

// literal returns an id that is not the one of any record.
func literal(s string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return s }
}

func event(fx testutil.Fixture) *core.Record  { return fx.Event }
func event2(fx testutil.Fixture) *core.Record { return fx.Event2 }
func f42(fx testutil.Fixture) *core.Record    { return fx.F42 }
func f15(fx testutil.Fixture) *core.Record    { return fx.F15 }
func fLyon(fx testutil.Fixture) *core.Record  { return fx.FLyon }

// code is how the API reports a refused request: data.code.
func code(c string) string { return `"code":"` + c + `"` }

// result is the response body of a merge.
func result(movedFormats, movedParticipations, droppedParticipations, clearedFormatDates int) string {
	return fmt.Sprintf(`{"movedFormats":%d,"movedParticipations":%d,"droppedParticipations":%d,"clearedFormatDates":%d}`,
		movedFormats, movedParticipations, droppedParticipations, clearedFormatDates)
}

// stored returns the record as it is in the database, or nil when it is not.
func stored(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	records, err := app.FindAllRecords(collection)
	if err != nil {
		t.Fatalf("listing %s: %v", collection, err)
	}
	for _, r := range records {
		if r.Id == id {
			return r
		}
	}
	return nil
}

// mustStore is stored for a record that has to be there.
func mustStore(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	r := stored(t, app, collection, id)
	if r == nil {
		t.Fatalf("the %s %s is not in the database", collection, id)
	}
	return r
}

// gone asserts that the records no longer are in the database.
func gone(t testing.TB, app core.App, collection string, records ...*core.Record) {
	t.Helper()
	for _, r := range records {
		if stored(t, app, collection, r.Id) != nil {
			t.Errorf("the %s %s is still in the database", collection, r.Id)
		}
	}
}

// snapshot is the whole content of the tables that a merge can touch, with the
// date of their last change: a record that was written again is not the same.
func snapshot(t testing.TB, app core.App) string {
	t.Helper()
	var out []byte
	for _, collection := range []string{"events", "formats", "participations", "runners"} {
		records, err := app.FindAllRecords(collection)
		if err != nil {
			t.Fatalf("listing %s: %v", collection, err)
		}
		sort.Slice(records, func(i, j int) bool { return records[i].Id < records[j].Id })
		out = append(out, collection...)
		out = append(out, '\n')
		for _, r := range records {
			line, err := json.Marshal(r)
			if err != nil {
				t.Fatalf("encoding a %s: %v", collection, err)
			}
			out = append(append(out, line...), '\n')
		}
	}
	return string(out)
}

// unchanged turns row into one that asserts the database is as it was: setup
// runs first, then the snapshot is taken, and After compares with it.
func unchanged(row testutil.Row, setup hook) testutil.Row {
	var before string
	row.Before = func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		if setup != nil {
			setup(t, app, fx)
		}
		before = snapshot(t, app)
	}
	row.After = func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
	}
	return row
}

// participate adds a participation of runner in format, added by the runner.
func participate(t testing.TB, app core.App, runner, format *core.Record, status string, confirmed bool) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	p := core.NewRecord(collection)
	p.Set("runner", runner.Id)
	p.Set("format", format.Id)
	p.Set("status", status)
	p.Set("confirmed", confirmed)
	p.Set("added_by", runner.Id)
	if err := app.Save(p); err != nil {
		t.Fatalf("adding a participation: %v", err)
	}
	return p
}

// undecided adds a participation of runner in the event only, without a format:
// the runner is interested and has not chosen yet. The runner added it.
func undecided(t testing.TB, app core.App, runner, event *core.Record, confirmed bool) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	p := core.NewRecord(collection)
	p.Set("runner", runner.Id)
	p.Set("event", event.Id)
	p.Set("status", "interested")
	p.Set("confirmed", confirmed)
	p.Set("added_by", runner.Id)
	if err := app.Save(p); err != nil {
		t.Fatalf("adding a participation without a format: %v", err)
	}
	return p
}

// undecidedOf returns the participation of the runner in the event only, as it
// is in the database, or nil when the runner has none.
func undecidedOf(t testing.TB, app core.App, runner, event *core.Record) *core.Record {
	t.Helper()
	found, err := app.FindAllRecords("participations",
		dbx.HashExp{"runner": runner.Id, "event": event.Id, "format": ""})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) == 0 {
		return nil
	}
	return found[0]
}

// setFields saves values on the record that has that id.
func setFields(t testing.TB, app core.App, collection, id string, values map[string]any) {
	t.Helper()
	r := mustStore(t, app, collection, id)
	for k, v := range values {
		r.Set(k, v)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("saving the %s %s: %v", collection, id, err)
	}
}

func TestWinner(t *testing.T) {
	app := testutil.NewApp(t)
	collection, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	participation := func(confirmed bool, status string) *core.Record {
		p := core.NewRecord(collection)
		p.Set("confirmed", confirmed)
		p.Set("status", status)
		return p
	}

	rows := []struct {
		name        string
		keep, other *core.Record
		wantOther   bool
	}{
		{"a confirmed one beats a higher status", participation(true, "interested"), participation(false, "finished"), false},
		{"a higher status beats a lower one", participation(false, "interested"), participation(false, "registered"), true},
		{"the same rank keeps the kept one", participation(false, "dnf"), participation(false, "finished"), false},
		// What the table of the brief does not spell out.
		{"the confirmed one wins whichever side it is on", participation(false, "finished"), participation(true, "interested"), true},
		{"two confirmed ones go by status", participation(true, "interested"), participation(true, "registered"), true},
		{"two confirmed ones of the same rank keep the kept one", participation(true, "registered"), participation(true, "registered"), false},
		{"registered is above interested", participation(false, "registered"), participation(false, "interested"), false},
		{"dns is as high as finished", participation(false, "dns"), participation(false, "finished"), false},
		{"finished is above registered", participation(false, "registered"), participation(false, "dns"), true},
		{"nothing set keeps the kept one", participation(false, "interested"), participation(false, "interested"), false},
	}
	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			want := row.keep
			if row.wantOther {
				want = row.other
			}
			if got := admin.Winner(row.keep, row.other); got != want {
				which := func(r *core.Record) string {
					if r == row.keep {
						return "the kept one"
					}
					return "the other one"
				}
				t.Errorf("winner = %s, want %s", which(got), which(want))
			}
		})
	}
}

func TestMergeEvents(t *testing.T) {
	// An event whose range holds the whole of Event, for the formats that must
	// keep their date.
	var wide *core.Record

	// The participations that the rows below set up, for what they check after.
	var sam, movedUndecided, keptUndecided, droppedUndecided, onLyon *core.Record
	// Admin is interested in Event2, without a format.
	adminUndecidedOnEvent2 := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		movedUndecided = undecided(t, app, fx.AdminRunner, fx.Event2, false)
	}
	// Bob is on F42, and interested in Event2 without a format.
	bobUndecidedOnEvent2 := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		droppedUndecided = undecided(t, app, fx.BobRunner, fx.Event2, false)
	}
	// Admin is interested in Event and in Event2, without a format in both.
	adminUndecidedOnBoth := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptUndecided = undecided(t, app, fx.AdminRunner, fx.Event, false)
		droppedUndecided = undecided(t, app, fx.AdminRunner, fx.Event2, false)
	}
	// Admin is interested in Event without a format, and is on FLyon: the merge
	// gives Admin a format of Event.
	adminUndecidedOnEventAndOnLyon := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		droppedUndecided = undecided(t, app, fx.AdminRunner, fx.Event, false)
		onLyon = participate(t, app, fx.AdminRunner, fx.FLyon, "interested", false)
	}

	testutil.RunRows(t, []testutil.Row{
		unchanged(testutil.Row{
			Name:     "a dry run counts what would move and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 0, 0)},
		}, nil),
		unchanged(testutil.Row{
			Name:   "a dry run counts the dates it would clear and the participations it would move",
			As:     "admin",
			Method: http.MethodPost,
			URL:    path(mergeEvents),
			// Event ends in June 14: F42 (dated) would lose its date, F15 has none.
			Body:     merge(id(event2), id(event), true),
			Status:   http.StatusOK,
			Contains: []string{result(2, 3, 0, 1)},
		}, nil),
		{
			Name:     "the formats move to the kept event and the other event is deleted",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.FLyon.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("FLyon is in the event %q, want %q", got, fx.Event.Id)
				}
				mustStore(t, app, "events", fx.Event.Id)
				gone(t, app, "events", fx.Event2)
			},
		},
		{
			Name: "a format dated outside the range of the kept event loses its date",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "formats", fx.FLyon.Id, map[string]any{"date": "2026-06-22"})
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 0, 1)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				lyon := mustStore(t, app, "formats", fx.FLyon.Id)
				if got := lyon.GetString("date"); got != "" {
					t.Errorf("the date of FLyon is %q, want it empty", got)
				}
				if got := lyon.GetString("event"); got != fx.Event.Id {
					t.Errorf("FLyon is in the event %q, want %q", got, fx.Event.Id)
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		{
			Name: "the participations and the dates inside the range follow the formats",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				collection, err := app.FindCollectionByNameOrId("events")
				if err != nil {
					t.Fatal(err)
				}
				wide = core.NewRecord(collection)
				wide.Set("name", "Mois de juin")
				wide.Set("location", "Annecy")
				wide.Set("start_date", "2026-06-01")
				wide.Set("end_date", "2026-06-30")
				if err := app.Save(wide); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     func(fx testutil.Fixture) string { return merge(literal(wide.Id), id(event), false)(fx) },
			Status:   http.StatusOK,
			Contains: []string{result(2, 3, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				for _, format := range []*core.Record{fx.F42, fx.F15} {
					if got := mustStore(t, app, "formats", format.Id).GetString("event"); got != wide.Id {
						t.Errorf("the format %s is in the event %q, want %q", format.Id, got, wide.Id)
					}
				}
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("date"); got != "2026-06-14" {
					t.Errorf("the date of F42 is %q, want 2026-06-14", got)
				}
				for _, p := range []*core.Record{fx.P1, fx.P2, fx.P3} {
					got := mustStore(t, app, "participations", p.Id)
					if got.GetString("format") != p.GetString("format") {
						t.Errorf("the participation %s is on the format %q, want %q", p.Id, got.GetString("format"), p.GetString("format"))
					}
					// A participation is in the event of its format.
					if got.GetString("event") != wide.Id {
						t.Errorf("the participation %s is in the event %q, want %q", p.Id, got.GetString("event"), wide.Id)
					}
				}
				gone(t, app, "events", fx.Event)
			},
		},
		{
			Name: "the participations of the moved formats follow them",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				sam = participate(t, app, fx.SamRunner, fx.FLyon, "interested", false)
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 1, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				got := mustStore(t, app, "participations", sam.Id)
				if got.GetString("event") != fx.Event.Id || got.GetString("format") != fx.FLyon.Id {
					t.Errorf("Sam is in the event %q on the format %q, want %q and FLyon %q",
						got.GetString("event"), got.GetString("format"), fx.Event.Id, fx.FLyon.Id)
				}
				inEvent, err := app.FindAllRecords("participations", dbx.HashExp{"event": fx.Event.Id})
				if err != nil {
					t.Fatal(err)
				}
				found := false
				for _, p := range inEvent {
					found = found || p.Id == sam.Id
				}
				if !found {
					t.Errorf("the participations of the event %s do not hold the one of Sam", fx.Event.Id)
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		{
			Name:     "a participation without a format moves to the kept event",
			Before:   adminUndecidedOnEvent2,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 1, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				got := mustStore(t, app, "participations", movedUndecided.Id)
				if got.GetString("event") != fx.Event.Id || got.GetString("format") != "" {
					t.Errorf("the participation is in the event %q on the format %q, want %q and none",
						got.GetString("event"), got.GetString("format"), fx.Event.Id)
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the participation without a format that would move",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(1, 1, 0, 0)},
		}, adminUndecidedOnEvent2),
		{
			Name:     "a participation without a format is dropped when its runner is on a format of the kept event",
			Before:   bobUndecidedOnEvent2,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 1, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				gone(t, app, "participations", droppedUndecided)
				p2 := mustStore(t, app, "participations", fx.P2.Id)
				if p2.GetString("event") != fx.Event.Id || p2.GetString("format") != fx.F42.Id {
					t.Errorf("P2 changed: %v", p2.FieldsData())
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the participation without a format that would be dropped for a format",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 1, 0)},
		}, bobUndecidedOnEvent2),
		{
			Name:     "a runner without a format in both events keeps the participation of the kept event",
			Before:   adminUndecidedOnBoth,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 1, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				mustStore(t, app, "participations", keptUndecided.Id)
				gone(t, app, "participations", droppedUndecided)
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the participation without a format that would be dropped for another one",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(1, 0, 1, 0)},
		}, adminUndecidedOnBoth),
		{
			Name:     "a participation without a format of the kept event is dropped when its runner gets a format by the merge",
			Before:   adminUndecidedOnEventAndOnLyon,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(1, 1, 1, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := undecidedOf(t, app, fx.AdminRunner, fx.Event); got != nil {
					t.Errorf("Admin still has a participation in the event only: %v", got.FieldsData())
				}
				gone(t, app, "participations", droppedUndecided)
				lyon := mustStore(t, app, "participations", onLyon.Id)
				if lyon.GetString("event") != fx.Event.Id || lyon.GetString("format") != fx.FLyon.Id {
					t.Errorf("the participation of Admin is in the event %q on the format %q, want %q and FLyon %q",
						lyon.GetString("event"), lyon.GetString("format"), fx.Event.Id, fx.FLyon.Id)
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the participation without a format that a moved format would replace",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(1, 1, 1, 0)},
		}, adminUndecidedOnEventAndOnLyon),
		{
			Name: "an event without formats merges too",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if err := app.Delete(fx.FLyon); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(0, 0, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a member is forbidden",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusForbidden,
			Contains: []string{code(apperr.CodeForbidden)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "an anonymous caller is unauthorized",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
		}, nil),
		unchanged(testutil.Row{
			Name:     "an event cannot be merged into itself",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event), false),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeMergeSameRecord)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "the event to keep must exist",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(literal("unknown"), id(event2), false),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "the event to merge must exist",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), literal("unknown"), false),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
		unchanged(testutil.Row{
			Name:   "a body that cannot be read names no record and writes nothing",
			As:     "admin",
			Method: http.MethodPost,
			URL:    path(mergeEvents),
			// A dry run that is not a boolean must not turn into a real merge.
			Body: func(fx testutil.Fixture) string {
				return fmt.Sprintf(`{"keepId":%q,"mergeId":%q,"dryRun":"yes"}`, fx.Event.Id, fx.Event2.Id)
			},
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
	})
}

func TestMergeFormats(t *testing.T) {
	// Alice is also on F15, which she did not confirm and has finished.
	aliceOnF15 := func(status string, confirmed bool) hook {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			participate(t, app, fx.AliceRunner, fx.F15, status, confirmed)
		}
	}

	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "the participations move to the kept format and the other format is deleted",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(0, 1, 0, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				sam := mustStore(t, app, "participations", fx.P3.Id)
				// Moved as it is, not recreated.
				if got := sam.GetString("format"); got != fx.F42.Id {
					t.Errorf("Sam is on the format %q, want F42 %q", got, fx.F42.Id)
				}
				if sam.GetString("status") != "interested" || sam.GetBool("confirmed") ||
					sam.GetString("added_by") != fx.AliceRunner.Id {
					t.Errorf("Sam's participation changed: %v", sam.FieldsData())
				}
				for _, p := range []*core.Record{fx.P1, fx.P2} {
					if got := mustStore(t, app, "participations", p.Id).GetString("format"); got != fx.F42.Id {
						t.Errorf("the participation %s is on the format %q, want F42", p.Id, got)
					}
				}
				mustStore(t, app, "formats", fx.F42.Id)
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			Name:     "a runner on both formats keeps the winning participation: the kept one",
			Before:   aliceOnF15("finished", false),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(0, 1, 1, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				// P1 is confirmed: it wins over a finished one that is not.
				p1 := mustStore(t, app, "participations", fx.P1.Id)
				if p1.GetString("format") != fx.F42.Id || p1.GetString("status") != "registered" || !p1.GetBool("confirmed") {
					t.Errorf("P1 changed: %v", p1.FieldsData())
				}
				if got := mustStore(t, app, "participations", fx.P3.Id).GetString("format"); got != fx.F42.Id {
					t.Errorf("Sam is on the format %q, want F42", got)
				}
				gone(t, app, "formats", fx.F15)
				n, err := app.CountRecords("participations")
				if err != nil {
					t.Fatal(err)
				}
				// P1, P2, P3: Alice's second participation is dropped.
				if n != 3 {
					t.Errorf("%d participations left, want 3", n)
				}
			},
		},
		{
			Name: "a runner on both formats keeps the winning participation: the other one",
			// F15 is kept. Alice is there as interested, and confirmed on F42
			// (P1, registered): P1 wins and takes her place.
			Before:   aliceOnF15("interested", false),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f15), id(f42), false),
			Status:   http.StatusOK,
			Contains: []string{result(0, 2, 1, 0)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				p1 := mustStore(t, app, "participations", fx.P1.Id)
				if p1.GetString("format") != fx.F15.Id || p1.GetString("status") != "registered" || !p1.GetBool("confirmed") {
					t.Errorf("P1 is not the participation of Alice on F15 any more: %v", p1.FieldsData())
				}
				if got := mustStore(t, app, "participations", fx.P2.Id).GetString("format"); got != fx.F15.Id {
					t.Errorf("Bob is on the format %q, want F15", got)
				}
				gone(t, app, "formats", fx.F42)
				n, err := app.CountRecords("participations")
				if err != nil {
					t.Fatal(err)
				}
				// P1, P2, P3: the interested one of Alice is dropped.
				if n != 3 {
					t.Errorf("%d participations left, want 3", n)
				}
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts what would move and drop and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), true),
			Status:   http.StatusOK,
			Contains: []string{result(0, 1, 1, 0)},
		}, aliceOnF15("finished", false)),
		unchanged(testutil.Row{
			Name:     "a dry run says the same when the other participation would win",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f15), id(f42), true),
			Status:   http.StatusOK,
			Contains: []string{result(0, 2, 1, 0)},
		}, aliceOnF15("interested", false)),
		unchanged(testutil.Row{
			Name:     "a member is forbidden",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusForbidden,
			Contains: []string{code(apperr.CodeForbidden)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "an anonymous caller is unauthorized",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
		}, nil),
		unchanged(testutil.Row{
			Name:     "a format cannot be merged into itself",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f42), false),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeMergeSameRecord)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "the formats must be of the same event",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(fLyon), false),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeMergeFormatsDifferentEvents)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "the format to keep must exist",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(literal("unknown"), id(f15), false),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
		unchanged(testutil.Row{
			Name:     "the format to merge must exist",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), literal("unknown"), false),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
		unchanged(testutil.Row{
			Name:   "a body that cannot be read names no record and writes nothing",
			As:     "admin",
			Method: http.MethodPost,
			URL:    path(mergeFormats),
			Body: func(fx testutil.Fixture) string {
				return fmt.Sprintf(`{"keepId":%q,"mergeId":%q,"dryRun":"yes"}`, fx.F42.Id, fx.F15.Id)
			},
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
		}, nil),
	})
}

// A merge is all or nothing: when a write fails halfway, what was already
// written is undone.
func TestMerge_RollsBackWhenAWriteFails(t *testing.T) {
	boom := errors.New("write refused by the test")

	// failOn makes the n-th save of a record of the collection fail.
	failOn := func(app core.App, collection string, n int) {
		saves := 0
		app.OnRecordUpdate(collection).BindFunc(func(e *core.RecordEvent) error {
			saves++
			if saves == n {
				return boom
			}
			return e.Next()
		})
	}

	t.Run("merge-formats", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// F15 holds Sam, Alice again (dropped: P1 wins) and the admin: two
		// participations move, the second move fails.
		participate(t, app, fx.AliceRunner, fx.F15, "finished", false)
		participate(t, app, fx.AdminRunner, fx.F15, "interested", false)
		before := snapshot(t, app)
		failOn(app, "participations", 2)

		_, err := admin.MergeFormats(app, fx.F42.Id, fx.F15.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		mustStore(t, app, "formats", fx.F15.Id)
		if got := mustStore(t, app, "participations", fx.P3.Id).GetString("format"); got != fx.F15.Id {
			t.Errorf("Sam is on the format %q, want F15 %q", got, fx.F15.Id)
		}
	})

	t.Run("merge-events", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// Event2 holds two formats: the second move fails.
		other := core.NewRecord(fx.FLyon.Collection())
		other.Set("event", fx.Event2.Id)
		other.Set("race_type", fx.Road.Id)
		other.Set("distance_km", 5)
		if err := app.Save(other); err != nil {
			t.Fatal(err)
		}
		before := snapshot(t, app)
		failOn(app, "formats", 2)

		_, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		mustStore(t, app, "events", fx.Event2.Id)
		for _, format := range []*core.Record{fx.FLyon, other} {
			if got := mustStore(t, app, "formats", format.Id).GetString("event"); got != fx.Event2.Id {
				t.Errorf("the format %s is in the event %q, want Event2", format.Id, got)
			}
		}
	})

	t.Run("merge-events with participations", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// Sam follows FLyon (the first save of a participation), then Admin,
		// who is on Event2 without a format, moves to Event: that one fails.
		sam := participate(t, app, fx.SamRunner, fx.FLyon, "interested", false)
		adminUndecided := undecided(t, app, fx.AdminRunner, fx.Event2, false)
		before := snapshot(t, app)
		failOn(app, "participations", 2)

		_, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		mustStore(t, app, "events", fx.Event2.Id)
		if got := mustStore(t, app, "participations", sam.Id).GetString("event"); got != fx.Event2.Id {
			t.Errorf("Sam is in the event %q, want Event2 %q", got, fx.Event2.Id)
		}
		if got := mustStore(t, app, "participations", adminUndecided.Id).GetString("event"); got != fx.Event2.Id {
			t.Errorf("Admin is in the event %q, want Event2 %q", got, fx.Event2.Id)
		}
	})
}

// The functions answer with the same result whether they write or not.
func TestMerge_DryRunGivesTheResultOfTheRealRun(t *testing.T) {
	setup := func(t *testing.T) (*tests.TestApp, testutil.Fixture) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		participate(t, app, fx.AliceRunner, fx.F15, "finished", false)
		return app, fx
	}

	t.Run("events", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			got, err := admin.MergeEvents(app, fx.Event2.Id, fx.Event.Id, dryRun)
			if err != nil {
				t.Fatal(err)
			}
			results[i] = got
		}
		if results[0] != results[1] {
			t.Errorf("dry run = %+v, real run = %+v", results[0], results[1])
		}
		if want := (admin.MergeResult{MovedFormats: 2, MovedParticipations: 4, ClearedFormatDates: 1}); results[1] != want {
			t.Errorf("result = %+v, want %+v", results[1], want)
		}
	})

	t.Run("events with undecided participations", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			// Admin is without a format on Event, and on FLyon.
			undecided(t, app, fx.AdminRunner, fx.Event, false)
			participate(t, app, fx.AdminRunner, fx.FLyon, "interested", false)
			got, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, dryRun)
			if err != nil {
				t.Fatal(err)
			}
			results[i] = got
		}
		if results[0] != results[1] {
			t.Errorf("dry run = %+v, real run = %+v", results[0], results[1])
		}
		if want := (admin.MergeResult{MovedFormats: 1, MovedParticipations: 1, DroppedParticipations: 1}); results[1] != want {
			t.Errorf("result = %+v, want %+v", results[1], want)
		}
	})

	t.Run("formats", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			got, err := admin.MergeFormats(app, fx.F42.Id, fx.F15.Id, dryRun)
			if err != nil {
				t.Fatal(err)
			}
			results[i] = got
		}
		if results[0] != results[1] {
			t.Errorf("dry run = %+v, real run = %+v", results[0], results[1])
		}
		if want := (admin.MergeResult{MovedParticipations: 1, DroppedParticipations: 1}); results[1] != want {
			t.Errorf("result = %+v, want %+v", results[1], want)
		}
	})
}
