package invitations_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	"courses/server/invitations"
	"courses/server/testutil"
	"courses/server/wording"
)

// ---------------------------------------------------------------------------
// Fixtures

// at sets the clock of the package to the instant s (RFC 3339) for the test.
func at(t testing.TB, s string) {
	t.Helper()
	instant, err := time.Parse(time.RFC3339, s)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(invitations.SetNow(func() time.Time { return instant }))
}

// save stores a record of a collection.
func save(t testing.TB, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(c)
	for k, v := range values {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("saving a %s record: %v", collection, err)
	}
	return record
}

func newEvent(t testing.TB, app core.App, name, start, end string) *core.Record {
	t.Helper()
	return save(t, app, "events", map[string]any{
		"name": name, "location": "Lieu de " + name, "start_date": start, "end_date": end,
	})
}

func newMonthEvent(t testing.TB, app core.App, name, start, end string) *core.Record {
	t.Helper()
	return save(t, app, "events", map[string]any{
		"name": name, "location": "Lieu de " + name, "start_date": start, "end_date": end,
		"date_precision": "month",
	})
}

// newFormat adds a race to event, measured by km or, when km is 0, by minutes.
func newFormat(t testing.TB, app core.App, event, raceType *core.Record, name, date string, km float64, minutes int) *core.Record {
	t.Helper()
	return save(t, app, "formats", map[string]any{
		"event": event.Id, "race_type": raceType.Id, "name": name, "date": date,
		"distance_km": km, "duration_min": minutes,
	})
}

// join puts runner on event, on format when it is not nil.
func join(t testing.TB, app core.App, runner, event, format *core.Record, status string) *core.Record {
	t.Helper()
	values := map[string]any{"runner": runner.Id, "event": event.Id, "status": status, "confirmed": true}
	if format != nil {
		values["format"] = format.Id
	}
	return save(t, app, "participations", values)
}

func newRunner(t testing.TB, app core.App, name string) *core.Record {
	t.Helper()
	return save(t, app, "runners", map[string]any{"name": name})
}

// inviteSamBy returns the token of an invitation for Sam that the admin made.
func inviteSamBy(t testing.TB, app core.App, fx testutil.Fixture) string {
	t.Helper()
	token, _, err := invitations.Create(app, invitations.CreateInput{
		RunnerID: fx.SamRunner.Id, Kind: invitations.KindInvite, CreatedBy: fx.Admin.Id,
	})
	if err != nil {
		t.Fatal(err)
	}
	return token
}

// lookup posts a lookup request the way a browser would and returns the status
// and the body: tests.ApiScenario only checks parts of a body.
func lookup(t testing.TB, app *tests.TestApp, body string) (int, string) {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	var recorder *httptest.ResponseRecorder
	serve := &core.ServeEvent{App: app, Router: router}
	err = app.OnServe().Trigger(serve, func(e *core.ServeEvent) error {
		mux, err := e.Router.BuildMux()
		if err != nil {
			return err
		}
		recorder = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, lookupURL, strings.NewReader(body))
		req.Header.Set("content-type", "application/json")
		mux.ServeHTTP(recorder, req)
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return recorder.Code, recorder.Body.String()
}

// lookupBody is the body of a lookup request with a language.
func lookupBody(token, lang string) string {
	return fmt.Sprintf(`{"token":%q,"lang":%q}`, token, lang)
}

// previewOf looks the invitation up and returns what it answers, and the keys
// of the top level of the answer.
func previewOf(t testing.TB, app *tests.TestApp, token, lang string) (invitations.Preview, []string) {
	t.Helper()
	status, body := lookup(t, app, lookupBody(token, lang))
	if status != http.StatusOK {
		t.Fatalf("lookup: status %d, body %s", status, body)
	}
	var preview invitations.Preview
	if err := json.Unmarshal([]byte(body), &preview); err != nil {
		t.Fatal(err)
	}
	return preview, keysOf(t, []byte(body))
}

// keysOf returns the sorted keys of a JSON object.
func keysOf(t testing.TB, data []byte) []string {
	t.Helper()
	var object map[string]json.RawMessage
	if err := json.Unmarshal(data, &object); err != nil {
		t.Fatal(err)
	}
	keys := make([]string, 0, len(object))
	for k := range object {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func compute(t testing.TB, app core.App, runner *core.Record, today string) invitations.Preview {
	t.Helper()
	preview, err := invitations.ComputePreview(app, runner.Id, "", today, wording.Of("fr"))
	if err != nil {
		t.Fatal(err)
	}
	return preview
}

func eventNames(preview invitations.Preview) []string {
	names := []string{}
	for _, race := range preview.Upcoming.Races {
		names = append(names, race.Event)
	}
	return names
}

func groupNames(preview invitations.Preview) []string {
	names := []string{}
	for _, line := range preview.Group {
		names = append(names, line.Event)
	}
	return names
}

func equal(t testing.TB, what string, got, want any) {
	t.Helper()
	g, _ := json.Marshal(got)
	w, _ := json.Marshal(want)
	if string(g) != string(w) {
		t.Errorf("%s = %s, want %s", what, g, w)
	}
}

// ---------------------------------------------------------------------------
// The route

func TestLookup_InvitePreview(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := inviteSamBy(t, app, fx)

	// Sam has 4 upcoming races.
	a := newEvent(t, app, "Trail A", "2026-11-14", "")
	fa := newFormat(t, app, a, fx.Trail, "Trail long", "2026-11-14", 30, 0)
	join(t, app, fx.SamRunner, a, fa, "registered")
	join(t, app, fx.AliceRunner, a, fa, "registered")
	join(t, app, fx.BobRunner, a, nil, "supporter")
	b := newEvent(t, app, "Course B", "2026-11-20", "")
	join(t, app, fx.SamRunner, b, nil, "interested")
	c := newEvent(t, app, "Course C", "2026-12-01", "")
	join(t, app, fx.SamRunner, c, newFormat(t, app, c, fx.Road, "", "", 10, 0), "interested")
	d := newEvent(t, app, "Course D", "2026-12-10", "")
	join(t, app, fx.SamRunner, d, newFormat(t, app, d, fx.Road, "Dix", "", 10, 0), "interested")

	// The group goes to three other races.
	g1 := newEvent(t, app, "Groupe 1", "2026-12-14", "")
	join(t, app, fx.AliceRunner, g1, nil, "interested")
	g0 := newEvent(t, app, "Groupe 0", "2026-11-30", "")
	join(t, app, fx.BobRunner, g0, newFormat(t, app, g0, fx.Road, "", "", 5, 0), "registered")
	g3 := newEvent(t, app, "Groupe 3", "2027-01-10", "")
	join(t, app, fx.AdminRunner, g3, nil, "interested")

	preview, keys := previewOf(t, app, token, "fr")

	equal(t, "keys", keys, []string{"group", "invitedBy", "kind", "runnerName", "upcoming"})
	if preview.InvitedBy == nil || *preview.InvitedBy != "Admin" {
		t.Errorf("invitedBy = %v, want Admin", preview.InvitedBy)
	}
	if preview.Upcoming.Total != 4 {
		t.Errorf("total = %d, want 4", preview.Upcoming.Total)
	}
	equal(t, "races", eventNames(preview), []string{"Trail A", "Course B", "Course C"})
	first := preview.Upcoming.Races[0]
	equal(t, "formats of the first", first.Formats, []string{"Trail long"})
	equal(t, "people of the first", first.People, []string{"Alice", "Bob"})
	equal(t, "day of the first", first.Day, "2026-11-14")
	equal(t, "formats of an event alone", preview.Upcoming.Races[1].Formats, []string{})
	equal(t, "formats of a generated name", preview.Upcoming.Races[2].Formats, []string{"Route 10 km"})
	equal(t, "group", groupNames(preview), []string{"Groupe 0", "Groupe 1", "Groupe 3"})
	equal(t, "people of a group line", preview.Group[1].People, []string{"Alice"})
	equal(t, "group day", preview.Group[0].Day, "2026-11-30")
}

func TestLookup_NoAuthor(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seed(t, app, fx.SamRunner, invitations.KindInvite, samToken) // no created_by

	status, body := lookup(t, app, lookupBody(samToken, "fr"))
	if status != http.StatusOK || !strings.Contains(body, `"invitedBy":null`) {
		t.Errorf("status %d, body %s: want 200 and invitedBy null", status, body)
	}
}

func TestLookup_ResetUnchanged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seed(t, app, fx.BobRunner, invitations.KindReset, bobToken)
	// Bob's races must not leak into a reset.
	e := newEvent(t, app, "Course secrete", "2099-01-01", "")
	join(t, app, fx.BobRunner, e, nil, "interested")

	status, body := lookup(t, app, lookupBody(bobToken, "fr"))
	if status != http.StatusOK {
		t.Fatalf("status %d, body %s", status, body)
	}
	equal(t, "keys", keysOf(t, []byte(body)), []string{"kind", "runnerName"})
	if strings.Contains(body, "Course secrete") {
		t.Errorf("a reset shows a race: %s", body)
	}
}

func TestLookup_DeadLinksShowNothing(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	e := newEvent(t, app, "EVENT-VISIBLE-NEVER", "2099-01-01", "")
	join(t, app, fx.SamRunner, e, nil, "interested")
	join(t, app, fx.AliceRunner, e, nil, "interested")
	seed(t, app, fx.SamRunner, invitations.KindInvite, "expired-token", expired())
	seed(t, app, fx.AliceRunner, invitations.KindInvite, "used-token", used())

	for _, token := range []string{"unknown-token", "expired-token", "used-token"} {
		status, body := lookup(t, app, lookupBody(token, "fr"))
		if status != http.StatusNotFound || !strings.Contains(body, code(apperr.CodeInvitationInvalid)) {
			t.Errorf("%s: status %d, body %s: want 404 invitation_invalid", token, status, body)
		}
		if strings.Contains(body, "EVENT-VISIBLE-NEVER") || strings.Contains(body, "upcoming") {
			t.Errorf("%s: a dead link shows data: %s", token, body)
		}
	}
}

func TestLookup_ShowsNothingElse(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := inviteSamBy(t, app, fx)

	var secrets []*core.Record
	keep := func(r *core.Record) *core.Record { secrets = append(secrets, r); return r }

	// A race of Sam, and one of the group, with everything a race can hold.
	mine := keep(save(t, app, "events", map[string]any{
		"name": "Course de Sam", "location": "Annecy", "start_date": "2026-11-14",
		"notes": "NOTE-SECRETE", "registration_url": "https://inscription.example/SECRET",
		"created_by": fx.AliceRunner.Id,
	}))
	mineFormat := keep(save(t, app, "formats", map[string]any{
		"event": mine.Id, "race_type": fx.Trail.Id, "distance_km": 20, "price_eur": 987,
	}))
	keep(join(t, app, fx.SamRunner, mine, mineFormat, "registered"))
	keep(join(t, app, fx.AliceRunner, mine, mineFormat, "registered"))
	theirs := keep(save(t, app, "events", map[string]any{
		"name": "Course du groupe", "location": "Lyon", "start_date": "2026-12-14",
		"notes": "NOTE-SECRETE", "registration_url": "https://inscription.example/SECRET",
	}))
	keep(join(t, app, fx.BobRunner, theirs, nil, "interested"))
	for _, event := range []*core.Record{mine, theirs} {
		keep(save(t, app, "comments", map[string]any{
			"event": event.Id, "author": fx.AliceRunner.Id, "body": "COMMENTAIRE-SECRET",
		}))
		keep(save(t, app, "offers", map[string]any{
			"event": event.Id, "kind": "ride", "owner": fx.BobRunner.Id, "place": "TRAJET-SECRET",
			"seats": 3, "notes": "TRAJET-SECRET",
		}))
	}
	secrets = append(secrets, fx.Admin, fx.Alice, fx.Bob, fx.AdminRunner, fx.AliceRunner, fx.BobRunner, fx.SamRunner, fx.Trail)
	all, err := app.FindAllRecords("invitations")
	if err != nil {
		t.Fatal(err)
	}
	secrets = append(secrets, all...)

	status, body := lookup(t, app, lookupBody(token, "fr"))
	if status != http.StatusOK {
		t.Fatalf("status %d, body %s", status, body)
	}
	for _, marker := range []string{"NOTE-SECRETE", "inscription.example", "987", "COMMENTAIRE-SECRET", "TRAJET-SECRET", "@", "token_hash", token} {
		if strings.Contains(body, marker) {
			t.Errorf("the body shows %q: %s", marker, body)
		}
	}
	for _, record := range secrets {
		if strings.Contains(body, record.Id) {
			t.Errorf("the body shows the id of a %s record", record.Collection().Name)
		}
	}

	// The keys are exactly those of the spec § 4.1.
	var parsed struct {
		Upcoming struct {
			Races []json.RawMessage `json:"races"`
		} `json:"upcoming"`
		Group []json.RawMessage `json:"group"`
	}
	if err := json.Unmarshal([]byte(body), &parsed); err != nil {
		t.Fatal(err)
	}
	if len(parsed.Upcoming.Races) != 1 || len(parsed.Group) != 1 {
		t.Fatalf("want one race and one group line: %s", body)
	}
	equal(t, "top keys", keysOf(t, []byte(body)), []string{"group", "invitedBy", "kind", "runnerName", "upcoming"})
	var upcoming map[string]json.RawMessage
	_ = json.Unmarshal([]byte(body), &upcoming)
	equal(t, "upcoming keys", keysOf(t, upcoming["upcoming"]), []string{"races", "total"})
	equal(t, "race keys", keysOf(t, parsed.Upcoming.Races[0]),
		[]string{"day", "event", "formats", "location", "monthOnly", "morePeople", "people"})
	equal(t, "group keys", keysOf(t, parsed.Group[0]),
		[]string{"day", "event", "location", "monthOnly", "morePeople", "people"})
}

func TestLookup_LangEnglish(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := inviteSamBy(t, app, fx)

	e := newEvent(t, app, "Course", "2026-11-14", "")
	join(t, app, fx.SamRunner, e, newFormat(t, app, e, fx.Road, "", "", 0, 360), "interested")
	e2 := newEvent(t, app, "Course 2", "2026-11-15", "")
	join(t, app, fx.SamRunner, e2, newFormat(t, app, e2, fx.Road, "", "", 42.5, 0), "interested")

	for _, lang := range []string{"en", "de", ""} {
		preview, _ := previewOf(t, app, token, lang)
		w := wording.Of(lang)
		equal(t, "formats for "+lang, []string{preview.Upcoming.Races[0].Formats[0], preview.Upcoming.Races[1].Formats[0]},
			[]string{w.RaceName("", "Route", 0, 360, 0), w.RaceName("", "Route", 42.5, 0, 0)})
	}
	en, _ := previewOf(t, app, token, "en")
	de, _ := previewOf(t, app, token, "de")
	equal(t, "english", en.Upcoming.Races[1].Formats, []string{"Route 42.5 km"})
	equal(t, "an unknown language is French", de.Upcoming.Races[1].Formats, []string{"Route 42,5 km"})
}

// ---------------------------------------------------------------------------
// The preview

func TestPreview_Days(t *testing.T) {
	t.Run("a race", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		e := newEvent(t, app, "Course", "2026-11-14", "")
		join(t, app, fx.SamRunner, e, newFormat(t, app, e, fx.Road, "", "", 10, 0), "interested")
		p := compute(t, app, fx.SamRunner, "2026-11-09")
		equal(t, "day", p.Upcoming.Races[0].Day, "2026-11-14")
		equal(t, "monthOnly", p.Upcoming.Races[0].MonthOnly, false)
	})

	t.Run("two formats of an event make one line", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		e := newEvent(t, app, "Week-end", "2026-11-13", "2026-11-15")
		join(t, app, fx.SamRunner, e, newFormat(t, app, e, fx.Road, "", "2026-11-13", 10, 0), "interested")
		join(t, app, fx.SamRunner, e, newFormat(t, app, e, fx.Road, "", "2026-11-15", 20, 0), "interested")

		p := compute(t, app, fx.SamRunner, "2026-11-09")
		if len(p.Upcoming.Races) != 1 || p.Upcoming.Total != 1 {
			t.Fatalf("want one line, got %+v", p.Upcoming)
		}
		equal(t, "formats", p.Upcoming.Races[0].Formats, []string{"Route 10 km", "Route 20 km"})
		equal(t, "day", p.Upcoming.Races[0].Day, "2026-11-13")

		// The first race is behind: the day is the one of the next race.
		p = compute(t, app, fx.SamRunner, "2026-11-14")
		equal(t, "day once the first race is behind", p.Upcoming.Races[0].Day, "2026-11-15")
		equal(t, "formats once the first race is behind", p.Upcoming.Races[0].Formats, []string{"Route 20 km"})
	})

	t.Run("an event alone is kept until its last day", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		e := newEvent(t, app, "Camp", "2026-11-08", "2026-11-10")
		join(t, app, fx.SamRunner, e, nil, "interested")
		p := compute(t, app, fx.SamRunner, "2026-11-09")
		equal(t, "names", eventNames(p), []string{"Camp"})
		equal(t, "day", p.Upcoming.Races[0].Day, "2026-11-08")
		equal(t, "formats", p.Upcoming.Races[0].Formats, []string{})
		equal(t, "gone after its last day", eventNames(compute(t, app, fx.SamRunner, "2026-11-11")), []string{})
	})

	t.Run("a month-only race", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		e := newMonthEvent(t, app, "Un jour de juin", "2027-06-01", "2027-06-30")
		join(t, app, fx.SamRunner, e, nil, "interested")
		p := compute(t, app, fx.SamRunner, "2027-06-30")
		equal(t, "names on the last day", eventNames(p), []string{"Un jour de juin"})
		equal(t, "day", p.Upcoming.Races[0].Day, "2027-06-01")
		equal(t, "monthOnly", p.Upcoming.Races[0].MonthOnly, true)
		equal(t, "names the day after", eventNames(compute(t, app, fx.SamRunner, "2027-07-01")), []string{})
	})

	t.Run("dns is absent, unconfirmed is present", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		out := newEvent(t, app, "Absent", "2026-11-14", "")
		join(t, app, fx.SamRunner, out, newFormat(t, app, out, fx.Road, "", "", 10, 0), "dns")
		in := newEvent(t, app, "Present", "2026-11-15", "")
		p := join(t, app, fx.SamRunner, in, nil, "interested")
		p.Set("confirmed", false)
		if err := app.Save(p); err != nil {
			t.Fatal(err)
		}
		equal(t, "names", eventNames(compute(t, app, fx.SamRunner, "2026-11-09")), []string{"Present"})
	})
}

func TestPreview_ParisMidnight(t *testing.T) {
	for _, tc := range []struct {
		name, now string
		want      []string
	}{
		{"23:30 in Paris is still the 9th", "2026-11-09T22:30:00Z", []string{"Course du 9"}},
		{"00:30 in Paris is the 10th", "2026-11-09T23:30:00Z", []string{}},
	} {
		t.Run(tc.name, func(t *testing.T) {
			at(t, tc.now)
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			token := inviteSamBy(t, app, fx)
			e := newEvent(t, app, "Course du 9", "2026-11-09", "")
			join(t, app, fx.SamRunner, e, newFormat(t, app, e, fx.Road, "", "", 10, 0), "interested")

			preview, _ := previewOf(t, app, token, "fr")
			equal(t, "races", eventNames(preview), tc.want)
		})
	}
}

func TestPreview_People(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	e := newEvent(t, app, "Course", "2026-11-14", "")
	f1 := newFormat(t, app, e, fx.Road, "", "", 10, 0)
	f2 := newFormat(t, app, e, fx.Road, "", "", 20, 0)
	join(t, app, fx.SamRunner, e, f1, "registered")
	join(t, app, fx.AliceRunner, e, f1, "registered")
	join(t, app, fx.AliceRunner, e, f2, "interested") // twice on the event: once in the list
	join(t, app, fx.BobRunner, e, nil, "supporter")
	join(t, app, fx.AdminRunner, e, f2, "dns") // not going: absent
	for _, name := range []string{"Éric", "Chloé", "Zed"} {
		join(t, app, newRunner(t, app, name), e, f1, "interested")
	}

	line := compute(t, app, fx.SamRunner, "2026-11-09").Upcoming.Races[0]
	equal(t, "people", line.People, []string{"Alice", "Bob", "Chloé"})
	equal(t, "morePeople", line.MorePeople, 2)
}

func TestPreview_Group(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	carol := newRunner(t, app, "Carol")

	// Sam is dns on one: it is not for the group block.
	dns := newEvent(t, app, "Sam dns", "2026-11-12", "")
	join(t, app, fx.SamRunner, dns, newFormat(t, app, dns, fx.Road, "", "", 10, 0), "dns")
	join(t, app, fx.AliceRunner, dns, nil, "interested")
	// Only supporters, nobody, and one in the past.
	supporters := newEvent(t, app, "Supporters", "2026-11-13", "")
	join(t, app, fx.AliceRunner, supporters, nil, "supporter")
	newEvent(t, app, "Personne", "2026-11-13", "")
	past := newEvent(t, app, "Passee", "2026-11-01", "")
	join(t, app, fx.AliceRunner, past, nil, "interested")
	// Four with starters, ordered by day; only the first 3 stay.
	for name, day := range map[string]string{"S4": "2026-12-15", "S1": "2026-11-20", "S2": "2026-12-01", "S3": "2026-12-10"} {
		e := newEvent(t, app, name, day, "")
		join(t, app, carol, e, newFormat(t, app, e, fx.Road, "", "", 10, 0), "registered")
	}
	// An event that has started and goes on: still ahead for the group.
	running := newEvent(t, app, "S0", "2026-11-08", "2026-11-10")
	join(t, app, carol, running, nil, "interested")

	p := compute(t, app, fx.SamRunner, "2026-11-09")
	equal(t, "group", groupNames(p), []string{"S0", "S1", "S2"})
	equal(t, "first day", p.Group[0].Day, "2026-11-08")
	equal(t, "people", p.Group[1].People, []string{"Carol"})

	// Nothing for the group: [] and not null.
	empty := testutil.NewApp(t)
	emptyFx := testutil.Seed(t, empty)
	data, err := json.Marshal(compute(t, empty, emptyFx.SamRunner, "2026-11-09"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(data), `"group":[]`) || !strings.Contains(string(data), `"races":[]`) {
		t.Errorf("want empty lists, got %s", data)
	}
}

// ---------------------------------------------------------------------------
// The create route

// created posts a create request as the admin and returns its response as a map.
func created(t *testing.T, app *tests.TestApp, fx testutil.Fixture, body string) map[string]any {
	t.Helper()
	response := testutil.NewSequence(t, app).Step("create", http.MethodPost, baseURL, testutil.Token(t, fx.Admin), body, http.StatusOK, `"url"`)
	var out map[string]any
	if err := json.Unmarshal([]byte(response), &out); err != nil {
		t.Fatal(err)
	}
	return out
}

func TestCreate_Validity(t *testing.T) {
	for kind, days := range map[invitations.Kind]int{invitations.KindInvite: 30, invitations.KindReset: 7} {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		runner := fx.SamRunner
		if kind == invitations.KindReset {
			runner = fx.BobRunner
		}
		out := created(t, app, fx, fmt.Sprintf(`{"runnerId":%q,"kind":%q}`, runner.Id, kind))
		got, err := time.Parse(time.RFC3339, out["expiresAt"].(string))
		if err != nil {
			t.Fatal(err)
		}
		want := time.Now().Add(time.Duration(days) * 24 * time.Hour)
		if got.Before(want.Add(-time.Minute)) || got.After(want.Add(time.Minute)) {
			t.Errorf("%s: expiresAt = %s, want about %s", kind, got, want)
		}
	}
}

func TestCreate_Message(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	a := newEvent(t, app, "Trail A", "2026-11-14", "")
	join(t, app, fx.SamRunner, a, nil, "interested")
	b := newEvent(t, app, "Course B", "2026-11-20", "")
	join(t, app, fx.SamRunner, b, nil, "interested")
	sam := fmt.Sprintf(`{"runnerId":%q,"kind":"invite"`, fx.SamRunner.Id)

	for lang, body := range map[string]string{"fr": sam + `}`, "en": sam + `,"lang":"en"}`, "de": sam + `,"lang":"de"}`} {
		out := created(t, app, fx, body)
		url, _ := out["url"].(string)
		wordsLang := lang
		if lang != "en" {
			wordsLang = "fr"
		}
		want := wording.Of(wordsLang).InvitationMessage(wording.InvitationMessage{
			Invitee: "Sam", Inviter: "Admin", Total: 2, NextEvent: "Trail A", NextDay: "2026-11-14", URL: url,
		})
		if out["message"] != want {
			t.Errorf("lang %s: message = %q, want %q", lang, out["message"], want)
		}
		if !strings.HasSuffix(want, url) {
			t.Errorf("lang %s: the message does not end with the url", lang)
		}
	}

	out := created(t, app, fx, fmt.Sprintf(`{"runnerId":%q,"kind":"reset"}`, fx.BobRunner.Id))
	if _, has := out["message"]; has {
		t.Error("a reset has a message")
	}
}

// An author whose account has no runner is shown as nobody.
func TestLookup_AuthorWithoutRunner(t *testing.T) {
	at(t, "2026-11-09T12:00:00Z")
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	orphan := save(t, app, "users", map[string]any{"email": "orphan@example.test", "password": "a-long-password", "verified": true, "role": "admin"})
	inv := seed(t, app, fx.SamRunner, invitations.KindInvite, samToken)
	inv.Set("created_by", orphan.Id)
	if err := app.Save(inv); err != nil {
		t.Fatal(err)
	}

	status, body := lookup(t, app, lookupBody(samToken, "fr"))
	if status != http.StatusOK || !strings.Contains(body, `"invitedBy":null`) {
		t.Errorf("status %d, body %s: want 200 and invitedBy null", status, body)
	}
}
