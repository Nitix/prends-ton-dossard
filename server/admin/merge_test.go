package admin_test

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"sort"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

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

// result is the response body of a merge: the counters of the result as JSON,
// every one of them, in the order of the fields. A counter that is not named
// is 0, so that a counter added to MergeResult does not touch the rows that do
// not count it.
func result(want admin.MergeResult) string {
	body, err := json.Marshal(want)
	if err != nil {
		panic(err)
	}
	return string(body)
}

// The front reads these keys: the rows below build their expectation with the
// tags of MergeResult, so a renamed tag would go through them unnoticed.
func TestMergeResult_JSONKeys(t *testing.T) {
	got, err := json.Marshal(admin.MergeResult{
		MovedFormats: 1, MovedParticipations: 2, DroppedParticipations: 3, ClearedFormatDates: 4, ClearedFormatTimes: 7, MovedComments: 5, MovedOffers: 6,
	})
	if err != nil {
		t.Fatal(err)
	}
	const want = `{"movedFormats":1,"movedParticipations":2,"droppedParticipations":3,"clearedFormatDates":4,"clearedFormatTimes":7,"movedComments":5,"movedOffers":6}`
	if string(got) != want {
		t.Errorf("MergeResult as JSON = %s, want %s", got, want)
	}
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

// storedComments returns every comment in the database.
func storedComments(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	comments, err := app.FindAllRecords("comments")
	if err != nil {
		t.Fatalf("listing the comments: %v", err)
	}
	return comments
}

// snapshot is the whole content of the tables that a merge can touch, with the
// date of their last change: a record that was written again is not the same.
func snapshot(t testing.TB, app core.App) string {
	t.Helper()
	var out []byte
	for _, collection := range []string{"events", "formats", "participations", "runners", "comments", "offers", "offer_members"} {
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

// comment adds a comment of author on event.
func comment(t testing.TB, app core.App, event, author *core.Record, text string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("comments")
	if err != nil {
		t.Fatal(err)
	}
	c := core.NewRecord(collection)
	c.Set("event", event.Id)
	c.Set("author", author.Id)
	c.Set("body", text)
	if err := app.Save(c); err != nil {
		t.Fatalf("adding a comment: %v", err)
	}
	return c
}

// offer adds an offer of owner on event: a car of three seats, or a lodging
// without a limit.
func offer(t testing.TB, app core.App, event, owner *core.Record, kind string) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("offers")
	if err != nil {
		t.Fatal(err)
	}
	o := core.NewRecord(collection)
	o.Set("event", event.Id)
	o.Set("kind", kind)
	o.Set("owner", owner.Id)
	o.Set("place", "Lyon, Part-Dieu")
	if kind == "ride" {
		o.Set("seats", 3)
	}
	if err := app.Save(o); err != nil {
		t.Fatalf("adding an offer: %v", err)
	}
	return o
}

// takePlace puts runner in the offer, added by the runner.
func takePlace(t testing.TB, app core.App, offer, runner *core.Record) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("offer_members")
	if err != nil {
		t.Fatal(err)
	}
	p := core.NewRecord(collection)
	p.Set("offer", offer.Id)
	p.Set("runner", runner.Id)
	p.Set("added_by", runner.Id)
	if err := app.Save(p); err != nil {
		t.Fatalf("adding a place: %v", err)
	}
	return p
}

// storedOffers returns every offer in the database.
func storedOffers(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	offers, err := app.FindAllRecords("offers")
	if err != nil {
		t.Fatalf("listing the offers: %v", err)
	}
	return offers
}

// finishedSamOnAFormatToCome is a hook that leaves Sam a finisher of F15, and
// then moves the event and F42 to a day far in the future: the race of F42 has
// not been run, and the one of F15 (no day of its own, so the first day of the
// event) neither. Sam finished F15 when it had been run, and the event moved
// later since. The days move in an order that keeps every save valid: F42 gives
// up its day, the event moves, F42 takes the new day.
func finishedSamOnAFormatToCome(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	setFields(t, app, "participations", fx.P3.Id, map[string]any{"status": "finished"})
	setFields(t, app, "formats", fx.F42.Id, map[string]any{"date": ""})
	setFields(t, app, "events", fx.Event.Id, map[string]any{"start_date": "2099-06-13", "end_date": "2099-06-14"})
	setFields(t, app, "formats", fx.F42.Id, map[string]any{"date": "2099-06-14"})
}

// withRoute is a hook that gives the format a GPX track of that many points
// (none for 0) and a link to its route (none for ""). Two tracks differ by their
// number of points, and two links by their text.
func withRoute(format func(testutil.Fixture) *core.Record, points int, link string) hook {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record := mustStore(t, app, "formats", format(fx).Id)
		if link != "" {
			record.Set("route_url", link)
		}
		if points > 0 {
			file, err := filesystem.NewFileFromBytes(testutil.GPX(t, points), "trace.gpx")
			if err != nil {
				t.Fatal(err)
			}
			record.Set("gpx", file)
		}
		if err := app.Save(record); err != nil {
			t.Fatalf("saving the route of the format %s: %v", record.Id, err)
		}
	}
}

// trackOf returns the content of the track of the format, as it is read from the
// storage of the application. It fails the test when the format has no track or
// when the file is not there.
func trackOf(t testing.TB, app core.App, id string) []byte {
	t.Helper()
	format := mustStore(t, app, "formats", id)
	name := format.GetString("gpx")
	if name == "" {
		t.Fatalf("the format %s has no track", id)
	}
	fsys, err := app.NewFilesystem()
	if err != nil {
		t.Fatal(err)
	}
	defer fsys.Close()
	reader, err := fsys.GetReader(format.BaseFilesPath() + "/" + name)
	if err != nil {
		t.Fatalf("reading the track %s of the format %s: %v", name, id, err)
	}
	defer reader.Close()
	content, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	return content
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
	// withResult gives a participation a complete result, withNote only the note
	// of one that gave up.
	withResult := func(p *core.Record) *core.Record {
		p.Set("finish_time_s", 15130)
		p.Set("rank", 12)
		p.Set("rank_of", 340)
		p.Set("result_note", "3e V1H")
		return p
	}
	withNote := func(p *core.Record) *core.Record {
		p.Set("result_note", "abandon au km 30")
		return p
	}

	type winnerRow struct {
		name        string
		keep, other *core.Record
		wantOther   bool
	}
	rows := []winnerRow{
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
		// A supporter is as low as an interested runner: neither is further
		// along than the other, so the kept one wins whichever it is.
		{"a supporter and an interested runner, neither confirmed: the kept supporter wins", participation(false, "supporter"), participation(false, "interested"), false},
		{"a supporter and an interested runner, neither confirmed: the kept interested one wins", participation(false, "interested"), participation(false, "supporter"), false},
		{"a supporter is below a registered runner", participation(false, "supporter"), participation(false, "registered"), true},
		{"a confirmed supporter beats an interested runner who is not", participation(false, "interested"), participation(true, "supporter"), true},

		// A result is what the runner entered after the race: it decides a tie
		// of the confirmation and of the status, so that it is not deleted with
		// the participation that does not have it.
		{"a result on the merged side wins a tie", participation(false, "finished"), withResult(participation(false, "finished")), true},
		{"a result on the kept side stays", withResult(participation(false, "finished")), participation(false, "finished"), false},
		{"two results keep the kept one", withResult(participation(false, "finished")), withResult(participation(false, "finished")), false},
		{"no result on either side keeps the kept one", participation(false, "finished"), participation(false, "finished"), false},
		{"a result wins a tie of confirmed participations", participation(true, "finished"), withResult(participation(true, "finished")), true},
		{"a note is a result: on the merged side of two retirements", participation(false, "dnf"), withNote(participation(false, "dnf")), true},
		// The result only breaks a tie.
		{"a confirmed one beats a result that is not", participation(true, "finished"), withResult(participation(false, "finished")), false},
		{"a confirmed one beats a result whichever side it is on", withResult(participation(false, "finished")), participation(true, "finished"), true},
	}
	// Each part of a result counts alone.
	for field, value := range map[string]any{"finish_time_s": 15130, "rank": 12, "rank_of": 340, "result_note": "3e V1H"} {
		other := participation(false, "finished")
		other.Set(field, value)
		rows = append(rows, winnerRow{"a result that is only " + field + " counts", participation(false, "finished"), other, true})
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

// testRowMonth merges Event (F42 dated on the 14th of June) into Event2 made a race known by
// its month, June 2026: the date is inside the month, but a month has no format dates.
func testRowMonth(name string, dryRun bool) testutil.Row {
	return testutil.Row{
		Name: name,
		Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			setFields(t, app, "events", fx.Event2.Id, map[string]any{"date_precision": "month", "start_date": "2026-06-01"})
		},
		As:       "admin",
		Method:   http.MethodPost,
		URL:      path(mergeEvents),
		Body:     merge(id(event2), id(event), dryRun),
		Status:   http.StatusOK,
		Contains: []string{result(admin.MergeResult{MovedFormats: 2, MovedParticipations: 3, ClearedFormatDates: 1})},
		After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			if dryRun {
				return
			}
			if got := mustStore(t, app, "formats", fx.F42.Id).GetString("date"); got != "" {
				t.Errorf("the date of F42 is %q, want it empty", got)
			}
			gone(t, app, "events", fx.Event)
		},
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
	// Admin is interested in Event without a format and has not confirmed it,
	// and has confirmed being interested in Event2, without a format.
	adminConfirmedInMergedEvent := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		droppedUndecided = undecided(t, app, fx.AdminRunner, fx.Event, false)
		movedUndecided = undecided(t, app, fx.AdminRunner, fx.Event2, true)
	}
	// The other way round: the confirmed one is in Event.
	adminConfirmedInKeptEvent := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptUndecided = undecided(t, app, fx.AdminRunner, fx.Event, true)
		droppedUndecided = undecided(t, app, fx.AdminRunner, fx.Event2, false)
	}
	// Admin is interested in Event without a format, and is on FLyon: the merge
	// gives Admin a format of Event.
	adminUndecidedOnEventAndOnLyon := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		droppedUndecided = undecided(t, app, fx.AdminRunner, fx.Event, false)
		onLyon = participate(t, app, fx.AdminRunner, fx.FLyon, "interested", false)
	}

	// The comments that the rows below set up: the one of the kept event, and
	// the ones of the merged event, which move.
	var keptComment *core.Record
	var movedComments []*core.Record
	// Alice comments on Event; Bob and Alice comment on Event2.
	commentsOnBothEvents := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptComment = comment(t, app, fx.Event, fx.AliceRunner, "Je prends la voiture")
		movedComments = []*core.Record{
			comment(t, app, fx.Event2, fx.BobRunner, "Qui part de Lyon ?"),
			comment(t, app, fx.Event2, fx.AliceRunner, "Moi !"),
		}
	}
	// Alice comments on the kept event only.
	commentOnKeptEventOnly := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptComment = comment(t, app, fx.Event, fx.AliceRunner, "Je prends la voiture")
	}

	// The offers that the rows below set up: the one of the kept event, and the
	// ones of the merged event, which move with their places.
	var keptOffer *core.Record
	var movedOffers, movedPlaces []*core.Record
	// Alice has a car on Event; Bob has a car on Event2 with Alice and Sam in it,
	// and Admin a lodging on Event2 with Bob in it. Once merged, Alice has a car
	// and a place in another one for the same event: the rule of one car per
	// runner and per event is for the writes, and the admin cleans up.
	offersOnBothEvents := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptOffer = offer(t, app, fx.Event, fx.AliceRunner, "ride")
		bobsCar := offer(t, app, fx.Event2, fx.BobRunner, "ride")
		adminsLodging := offer(t, app, fx.Event2, fx.AdminRunner, "lodging")
		movedOffers = []*core.Record{bobsCar, adminsLodging}
		movedPlaces = []*core.Record{
			takePlace(t, app, bobsCar, fx.AliceRunner),
			takePlace(t, app, bobsCar, fx.SamRunner),
			takePlace(t, app, adminsLodging, fx.BobRunner),
		}
	}
	// Alice has a car on the kept event only, with Sam in it.
	offerOnKeptEventOnly := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		keptOffer = offer(t, app, fx.Event, fx.AliceRunner, "ride")
		takePlace(t, app, keptOffer, fx.SamRunner)
	}

	testutil.RunRows(t, []testutil.Row{
		unchanged(testutil.Row{
			Name:     "a dry run counts what would move and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1})},
		}, nil),
		unchanged(testutil.Row{
			Name:   "a dry run counts the dates it would clear and the participations it would move",
			As:     "admin",
			Method: http.MethodPost,
			URL:    path(mergeEvents),
			// Event ends in June 14: F42 (dated) would lose its date, F15 has none.
			Body:     merge(id(event2), id(event), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 2, MovedParticipations: 3, ClearedFormatDates: 1})},
		}, nil),
		{
			Name:     "the formats move to the kept event and the other event is deleted",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.FLyon.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("FLyon is in the event %q, want %q", got, fx.Event.Id)
				}
				mustStore(t, app, "events", fx.Event.Id)
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testRowMonth("a dry run into a race known by its month counts the dates of the formats it would clear", true), nil),
		testRowMonth("a format dated in the month of a kept race known by its month loses its date", false),
		{
			Name: "a format with a start time merged into a race known by its month loses the time too",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "events", fx.Event2.Id, map[string]any{"date_precision": "month", "start_date": "2026-06-01"})
				setFields(t, app, "formats", fx.F42.Id, map[string]any{"start_time": "07:30"})
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event2), id(event), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 2, MovedParticipations: 3, ClearedFormatDates: 1, ClearedFormatTimes: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("start_time"); got != "" {
					t.Errorf("the start time of F42 is %q, want it empty", got)
				}
			},
		},
		{
			Name: "a format with a start time keeps it in a race that has days",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "formats", fx.FLyon.Id, map[string]any{"start_time": "09:00"})
			},
			As:     "admin",
			Method: http.MethodPost,
			URL:    path(mergeEvents),
			Body:   merge(id(event), id(event2), false),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.FLyon.Id).GetString("start_time"); got != "09:00" {
					t.Errorf("the start time of FLyon is %q, want 09:00", got)
				}
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, ClearedFormatDates: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 2, MovedParticipations: 3})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1})},
		}, adminUndecidedOnEvent2),
		{
			Name:     "a participation without a format is dropped when its runner is on a format of the kept event",
			Before:   bobUndecidedOnEvent2,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
		}, bobUndecidedOnEvent2),
		{
			Name:     "a runner without a format in both events keeps the participation of the kept event",
			Before:   adminUndecidedOnBoth,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
		}, adminUndecidedOnBoth),
		{
			Name:     "a runner without a format in both events keeps the confirmed participation of the kept event",
			Before:   adminConfirmedInKeptEvent,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				got := mustStore(t, app, "participations", keptUndecided.Id)
				if got.GetString("event") != fx.Event.Id || !got.GetBool("confirmed") {
					t.Errorf("the participation is in the event %q, confirmed %v, want %q and confirmed",
						got.GetString("event"), got.GetBool("confirmed"), fx.Event.Id)
				}
				gone(t, app, "participations", droppedUndecided)
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the confirmed participation of the kept event that would stay",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, DroppedParticipations: 1})},
		}, adminConfirmedInKeptEvent),
		{
			// The runner said it is true: the one of the merged event survives
			// and moves to the kept event, the one of the kept event goes.
			Name:     "a runner without a format in both events keeps the confirmed participation of the merged event",
			Before:   adminConfirmedInMergedEvent,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1, DroppedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				got := mustStore(t, app, "participations", movedUndecided.Id)
				if got.GetString("event") != fx.Event.Id || got.GetString("format") != "" || !got.GetBool("confirmed") {
					t.Errorf("the participation is in the event %q on the format %q, confirmed %v, want %q, none and confirmed",
						got.GetString("event"), got.GetString("format"), got.GetBool("confirmed"), fx.Event.Id)
				}
				gone(t, app, "participations", droppedUndecided)
				if got := undecidedOf(t, app, fx.AdminRunner, fx.Event); got == nil || got.Id != movedUndecided.Id {
					t.Errorf("Admin must have the confirmed participation in the event only, has %v", got)
				}
				gone(t, app, "events", fx.Event2)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the confirmed participation of the merged event that would replace the other",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1, DroppedParticipations: 1})},
		}, adminConfirmedInMergedEvent),
		{
			Name:     "a participation without a format of the kept event is dropped when its runner gets a format by the merge",
			Before:   adminUndecidedOnEventAndOnLyon,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1, DroppedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedParticipations: 1, DroppedParticipations: 1})},
		}, adminUndecidedOnEventAndOnLyon),
		{
			Name:     "the comments of the merged event move to the kept one",
			Before:   commentsOnBothEvents,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedComments: 2})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				for _, moved := range movedComments {
					got := mustStore(t, app, "comments", moved.Id)
					// Only the event changes: who wrote it, what, and when. The date
					// of the last change stays too: the front shows a comment whose
					// two dates differ as edited, and a merge is not an edit.
					if got.GetString("event") != fx.Event.Id {
						t.Errorf("the comment %q is in the event %q, want the kept one %q", moved.GetString("body"), got.GetString("event"), fx.Event.Id)
					}
					if got.GetString("author") != moved.GetString("author") || got.GetString("body") != moved.GetString("body") {
						t.Errorf("the comment %q changed beyond its event: author %q, body %q",
							moved.GetString("body"), got.GetString("author"), got.GetString("body"))
					}
					if got.GetDateTime("created").String() != moved.GetDateTime("created").String() {
						t.Errorf("the comment %q was created %s, now %s", moved.GetString("body"),
							moved.GetDateTime("created"), got.GetDateTime("created"))
					}
					if got.GetDateTime("updated").String() != moved.GetDateTime("updated").String() {
						t.Errorf("the comment %q was updated %s, now %s: a merge must not make it look edited", moved.GetString("body"),
							moved.GetDateTime("updated"), got.GetDateTime("updated"))
					}
				}
				if got := mustStore(t, app, "comments", keptComment.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("the comment of the kept event is in the event %q, want %q", got, fx.Event.Id)
				}
				gone(t, app, "events", fx.Event2)
				if got := len(storedComments(t, app)); got != 3 {
					t.Errorf("%d comments after the merge, want the 3 that there were", got)
				}
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the comments it would move and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedComments: 2})},
		}, commentsOnBothEvents),
		{
			Name:     "the comments of the kept event do not count as moved",
			Before:   commentOnKeptEventOnly,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "comments", keptComment.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("the comment is in the event %q, want %q", got, fx.Event.Id)
				}
			},
		},
		{
			Name:     "the offers of the merged event move to the kept one, with their members",
			Before:   offersOnBothEvents,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedOffers: 2})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				for _, moved := range movedOffers {
					got := mustStore(t, app, "offers", moved.Id)
					// Only the event changes: who offers it, what, and when. The date
					// of the last change stays too, as it does for a comment.
					if got.GetString("event") != fx.Event.Id {
						t.Errorf("the offer of %q is in the event %q, want the kept one %q", moved.GetString("owner"), got.GetString("event"), fx.Event.Id)
					}
					for _, field := range []string{"kind", "owner", "place", "seats"} {
						if got.GetString(field) != moved.GetString(field) {
							t.Errorf("the offer %s changed beyond its event: %s = %q, was %q",
								moved.Id, field, got.GetString(field), moved.GetString(field))
						}
					}
					if got.GetDateTime("created").String() != moved.GetDateTime("created").String() ||
						got.GetDateTime("updated").String() != moved.GetDateTime("updated").String() {
						t.Errorf("the offer %s was created %s and updated %s, now %s and %s: a merge only changes its event",
							moved.Id, moved.GetDateTime("created"), moved.GetDateTime("updated"),
							got.GetDateTime("created"), got.GetDateTime("updated"))
					}
				}
				// The places follow their offer, as they are.
				for _, place := range movedPlaces {
					got := mustStore(t, app, "offer_members", place.Id)
					for _, field := range []string{"offer", "runner", "added_by"} {
						if got.GetString(field) != place.GetString(field) {
							t.Errorf("the place %s changed: %s = %q, was %q", place.Id, field, got.GetString(field), place.GetString(field))
						}
					}
					if got.GetDateTime("updated").String() != place.GetDateTime("updated").String() {
						t.Errorf("the place %s was updated %s, now %s", place.Id, place.GetDateTime("updated"), got.GetDateTime("updated"))
					}
				}
				if got := mustStore(t, app, "offers", keptOffer.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("the offer of the kept event is in the event %q, want %q", got, fx.Event.Id)
				}
				gone(t, app, "events", fx.Event2)
				if got := len(storedOffers(t, app)); got != 3 {
					t.Errorf("%d offers after the merge, want the 3 that there were", got)
				}
				if got, err := app.CountRecords("offer_members"); err != nil || got != 3 {
					t.Errorf("%d places after the merge (error %v), want the 3 that there were", got, err)
				}
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run counts the offers it would move and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1, MovedOffers: 2})},
		}, offersOnBothEvents),
		{
			Name:     "the offers of the kept event do not count as moved",
			Before:   offerOnKeptEventOnly,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeEvents),
			Body:     merge(id(event), id(event2), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedFormats: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "offers", keptOffer.Id).GetString("event"); got != fx.Event.Id {
					t.Errorf("the offer is in the event %q, want %q", got, fx.Event.Id)
				}
				if got, err := app.CountRecords("offer_members"); err != nil || got != 1 {
					t.Errorf("%d places after the merge (error %v), want the 1 that there was", got, err)
				}
			},
		},
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
			Contains: []string{result(admin.MergeResult{})},
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

	// Alice has finished both formats, with her confirmation on both, and the
	// result of the race is on the participation of F42 (P1) or of F15.
	aliceFinishedBoth := func(resultOnF42 bool) hook {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			onF15 := participate(t, app, fx.AliceRunner, fx.F15, "finished", true)
			setFields(t, app, "participations", fx.P1.Id, map[string]any{"status": "finished"})
			withResult := onF15.Id
			if resultOnF42 {
				withResult = fx.P1.Id
			}
			setFields(t, app, "participations", withResult, map[string]any{
				"finish_time_s": 15130, "rank": 12, "rank_of": 340, "result_note": "3e V1H",
			})
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
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
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
			// Merging two copies of one race moves the participations to the copy
			// that is kept: what a runner has acquired goes along (the spec of
			// the statuses leaves a participation that already has its status
			// alone when its race moves). The preview said it would work.
			Name:     "a finisher moves onto a kept format that has not been run: still finished",
			Before:   finishedSamOnAFormatToCome,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				sam := mustStore(t, app, "participations", fx.P3.Id)
				if sam.GetString("format") != fx.F42.Id || sam.GetString("status") != "finished" {
					t.Errorf("Sam is %q on the format %q, want finished on F42 %q", sam.GetString("status"), sam.GetString("format"), fx.F42.Id)
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			// Whatever a merge saves is validated, and a record that does not hold
			// together is the caller's problem to fix, not a server error. Here
			// the kept format has a day outside of its event (a write that went
			// round the validation), and the track of the other one is carried
			// to it.
			Name: "a record that the merge saves and that does not validate is a 400",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				withRoute(f15, 0, "https://www.komoot.com/tour/15")(t, app, fx)
				f42 := mustStore(t, app, "formats", fx.F42.Id)
				f42.Set("date", "2026-07-01")
				if err := app.SaveNoValidate(f42); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusBadRequest,
			Contains: []string{`"date":{"code":"format_date_out_of_range"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				// Undone: F15 is still there, with its participation.
				mustStore(t, app, "formats", fx.F15.Id)
				if got := mustStore(t, app, "participations", fx.P3.Id).GetString("format"); got != fx.F15.Id {
					t.Errorf("Sam is on the format %q, want F15 %q", got, fx.F15.Id)
				}
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
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1, DroppedParticipations: 1})},
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
			Contains: []string{result(admin.MergeResult{MovedParticipations: 2, DroppedParticipations: 1})},
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
		{
			// Alice finished both, and confirmed both: nothing but the result
			// tells them apart. The one with the result must not be deleted.
			Name:     "a runner who finished both formats keeps the participation that has a result: the merged one",
			Before:   aliceFinishedBoth(false),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 2, DroppedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				gone(t, app, "participations", fx.P1)
				got, err := app.FindFirstRecordByFilter("participations", "runner = {:runner} && format = {:format}",
					dbx.Params{"runner": fx.AliceRunner.Id, "format": fx.F42.Id})
				if err != nil {
					t.Fatalf("Alice has no participation on F42: %v", err)
				}
				if got.GetInt("finish_time_s") != 15130 || got.GetInt("rank") != 12 || got.GetInt("rank_of") != 340 || got.GetString("result_note") != "3e V1H" {
					t.Errorf("the result of Alice is %v, want the one of the participation that moved", got.FieldsData())
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			Name:     "a runner who finished both formats keeps the participation that has a result: the kept one",
			Before:   aliceFinishedBoth(true),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1, DroppedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				p1 := mustStore(t, app, "participations", fx.P1.Id)
				if p1.GetString("format") != fx.F42.Id || p1.GetInt("finish_time_s") != 15130 || p1.GetString("result_note") != "3e V1H" {
					t.Errorf("P1 changed: %v", p1.FieldsData())
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			// Deleting the format would delete its link: an admin cleaning up the
			// duplicates of an event must not lose what a member added.
			Name:     "the route link of the merged format goes to the kept one when it has none",
			Before:   withRoute(f15, 0, "https://www.komoot.com/tour/15"),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("route_url"); got != "https://www.komoot.com/tour/15" {
					t.Errorf("route_url of F42 = %q, want the link of F15", got)
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			// The file goes with the record that holds it: it has to be copied,
			// and the copy has to be readable once the merged format is gone.
			Name:     "the track of the merged format goes to the kept one when it has none",
			Before:   withRoute(f15, 30, ""),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				gone(t, app, "formats", fx.F15)
				kept := mustStore(t, app, "formats", fx.F42.Id)
				if got := trackOf(t, app, fx.F42.Id); !bytes.Equal(got, testutil.GPX(t, 30)) {
					t.Errorf("the track of F42 is not the one of F15:\n%s", got)
				}
				// The name keeps its shape: a random part was added once, not twice.
				if name := kept.GetString("gpx"); !regexp.MustCompile(`^trace_[a-z0-9]{10}\.gpx$`).MatchString(name) {
					t.Errorf("the track of F42 is named %q, want trace_<10 characters>.gpx", name)
				}
				if got := kept.GetString("route_url"); got != "" {
					t.Errorf("route_url of F42 = %q, want none: F15 had no link", got)
				}
			},
		},
		{
			Name: "the track and the link of the kept format stay when the merged one has its own",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				withRoute(f42, 20, "https://www.komoot.com/tour/42")(t, app, fx)
				withRoute(f15, 30, "https://www.komoot.com/tour/15")(t, app, fx)
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := trackOf(t, app, fx.F42.Id); !bytes.Equal(got, testutil.GPX(t, 20)) {
					t.Errorf("the track of F42 changed:\n%s", got)
				}
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("route_url"); got != "https://www.komoot.com/tour/42" {
					t.Errorf("route_url of F42 = %q, want its own link", got)
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		{
			Name:     "the track and the link of the kept format stay when the merged one has none",
			Before:   withRoute(f42, 20, "https://www.komoot.com/tour/42"),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := trackOf(t, app, fx.F42.Id); !bytes.Equal(got, testutil.GPX(t, 20)) {
					t.Errorf("the track of F42 changed:\n%s", got)
				}
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("route_url"); got != "https://www.komoot.com/tour/42" {
					t.Errorf("route_url of F42 = %q, want its own link", got)
				}
			},
		},
		{
			// The other way round: F15 is kept and F42, the merged one, holds
			// the track and the link.
			Name:     "the route of the merged format goes to the kept one: the other way round",
			Before:   withRoute(f42, 20, "https://www.komoot.com/tour/42"),
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f15), id(f42), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 2})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := trackOf(t, app, fx.F15.Id); !bytes.Equal(got, testutil.GPX(t, 20)) {
					t.Errorf("the track of F15 is not the one of F42:\n%s", got)
				}
				if got := mustStore(t, app, "formats", fx.F15.Id).GetString("route_url"); got != "https://www.komoot.com/tour/42" {
					t.Errorf("route_url of F15 = %q, want the link of F42", got)
				}
				gone(t, app, "formats", fx.F42)
			},
		},
		{
			// A format whose track is in no file any more still merges: there is
			// nothing to carry, and the admin has no other way to clean up.
			Name: "a track that is missing from the storage does not stop the merge",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				withRoute(f15, 30, "")(t, app, fx)
				record := mustStore(t, app, "formats", fx.F15.Id)
				fsys, err := app.NewFilesystem()
				if err != nil {
					t.Fatal(err)
				}
				defer fsys.Close()
				if err := fsys.Delete(record.BaseFilesPath() + "/" + record.GetString("gpx")); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), false),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustStore(t, app, "formats", fx.F42.Id).GetString("gpx"); got != "" {
					t.Errorf("the track of F42 is %q, want none", got)
				}
				gone(t, app, "formats", fx.F15)
			},
		},
		unchanged(testutil.Row{
			Name:     "a dry run writes no route either",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1})},
		}, withRoute(f15, 30, "https://www.komoot.com/tour/15")),
		unchanged(testutil.Row{
			Name:     "a dry run counts what would move and drop and writes nothing",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f42), id(f15), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 1, DroppedParticipations: 1})},
		}, aliceOnF15("finished", false)),
		unchanged(testutil.Row{
			Name:     "a dry run says the same when the other participation would win",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(mergeFormats),
			Body:     merge(id(f15), id(f42), true),
			Status:   http.StatusOK,
			Contains: []string{result(admin.MergeResult{MovedParticipations: 2, DroppedParticipations: 1})},
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

	t.Run("merge-formats with a track", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// The track of F15 is copied to F42, then the deletion of F15, which is
		// the last write, fails: F42 must not keep the copy, in the database or
		// in the storage, and F15 keeps its own file.
		withRoute(f15, 30, "https://www.komoot.com/tour/15")(t, app, fx)
		before := snapshot(t, app)
		app.OnRecordDelete("formats").BindFunc(func(e *core.RecordEvent) error {
			if e.Record.Id == fx.F15.Id {
				return boom
			}
			return e.Next()
		})

		_, err := admin.MergeFormats(app, fx.F42.Id, fx.F15.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		if got := trackOf(t, app, fx.F15.Id); !bytes.Equal(got, testutil.GPX(t, 30)) {
			t.Errorf("the track of F15 changed:\n%s", got)
		}
		fsys, err := app.NewFilesystem()
		if err != nil {
			t.Fatal(err)
		}
		defer fsys.Close()
		files, err := fsys.List(mustStore(t, app, "formats", fx.F42.Id).BaseFilesPath() + "/")
		if err != nil {
			t.Fatal(err)
		}
		if len(files) != 0 {
			t.Errorf("%d files are left in the storage of F42 after the rollback, want none", len(files))
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

	t.Run("merge-events with comments", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// The comments move with one statement of SQL, which no hook of a record
		// sees: the failure is the last write, the deletion of the merged event,
		// after the formats and the comments have moved.
		first := comment(t, app, fx.Event2, fx.BobRunner, "Qui part de Lyon ?")
		second := comment(t, app, fx.Event2, fx.AliceRunner, "Moi !")
		before := snapshot(t, app)
		app.OnRecordDelete("events").BindFunc(func(e *core.RecordEvent) error {
			if e.Record.Id == fx.Event2.Id {
				return boom
			}
			return e.Next()
		})

		_, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		mustStore(t, app, "events", fx.Event2.Id)
		for _, c := range []*core.Record{first, second} {
			if got := mustStore(t, app, "comments", c.Id).GetString("event"); got != fx.Event2.Id {
				t.Errorf("the comment %q is in the event %q, want Event2 %q", c.GetString("body"), got, fx.Event2.Id)
			}
		}
	})

	t.Run("merge-events with offers", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// The offers move with one statement of SQL, like the comments: the
		// failure is the deletion of the merged event, after the offers moved.
		car := offer(t, app, fx.Event2, fx.BobRunner, "ride")
		lodging := offer(t, app, fx.Event2, fx.AdminRunner, "lodging")
		takePlace(t, app, car, fx.AliceRunner)
		before := snapshot(t, app)
		app.OnRecordDelete("events").BindFunc(func(e *core.RecordEvent) error {
			if e.Record.Id == fx.Event2.Id {
				return boom
			}
			return e.Next()
		})

		_, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, false)
		if !errors.Is(err, boom) {
			t.Fatalf("error = %v, want the failure of the write", err)
		}

		if got := snapshot(t, app); got != before {
			t.Errorf("the database changed:\nbefore:\n%s\nafter:\n%s", before, got)
		}
		mustStore(t, app, "events", fx.Event2.Id)
		for _, o := range []*core.Record{car, lodging} {
			if got := mustStore(t, app, "offers", o.Id).GetString("event"); got != fx.Event2.Id {
				t.Errorf("the offer %s is in the event %q, want Event2 %q", o.Id, got, fx.Event2.Id)
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

	t.Run("events with a confirmed participation of the merged event that wins", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			// Admin is without a format on both events, and has confirmed the
			// one of Event2: it replaces the one of Event.
			undecided(t, app, fx.AdminRunner, fx.Event, false)
			undecided(t, app, fx.AdminRunner, fx.Event2, true)
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

	t.Run("events with comments", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			comment(t, app, fx.Event, fx.AliceRunner, "Je prends la voiture")
			comment(t, app, fx.Event2, fx.BobRunner, "Qui part de Lyon ?")
			comment(t, app, fx.Event2, fx.AliceRunner, "Moi !")
			got, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, dryRun)
			if err != nil {
				t.Fatal(err)
			}
			results[i] = got
		}
		if results[0] != results[1] {
			t.Errorf("dry run = %+v, real run = %+v", results[0], results[1])
		}
		if want := (admin.MergeResult{MovedFormats: 1, MovedComments: 2}); results[1] != want {
			t.Errorf("result = %+v, want %+v", results[1], want)
		}
	})

	t.Run("events with offers", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			offer(t, app, fx.Event, fx.AliceRunner, "ride")
			car := offer(t, app, fx.Event2, fx.BobRunner, "ride")
			offer(t, app, fx.Event2, fx.AdminRunner, "lodging")
			takePlace(t, app, car, fx.AliceRunner)
			got, err := admin.MergeEvents(app, fx.Event.Id, fx.Event2.Id, dryRun)
			if err != nil {
				t.Fatal(err)
			}
			results[i] = got
		}
		if results[0] != results[1] {
			t.Errorf("dry run = %+v, real run = %+v", results[0], results[1])
		}
		if want := (admin.MergeResult{MovedFormats: 1, MovedOffers: 2}); results[1] != want {
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

	t.Run("formats with a finisher moving onto a format that has not been run", func(t *testing.T) {
		var results [2]admin.MergeResult
		for i, dryRun := range []bool{true, false} {
			app, fx := setup(t)
			finishedSamOnAFormatToCome(t, app, fx)
			got, err := admin.MergeFormats(app, fx.F42.Id, fx.F15.Id, dryRun)
			if err != nil {
				t.Fatalf("dry run = %v: %v", dryRun, err)
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
