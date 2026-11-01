package calendar_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/logger"

	"courses/server/invitations"
	"courses/server/testutil"
)

const (
	calendarURL = "/api/app/calendar"
	// appURL is the APP_URL of the test application (testutil.NewApp).
	appURL = "http://localhost:5173"
)

func at(path string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return path }
}

func lang(value string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return fmt.Sprintf(`{"lang":%q}`, value) }
}

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return fmt.Sprintf(`"%s":{"code":"%s"`, field, code)
}

// save saves a new record of the collection, through the hooks of the
// application, as its own code does.
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

// feeds returns the calendar links that are stored.
func feeds(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	records, err := app.FindAllRecords("calendar_feeds")
	if err != nil {
		t.Fatal(err)
	}
	return records
}

// hashOf is what the table stores for the token t.
var hashOf = invitations.Hash

// linkOf stores a calendar link for the user, whose token is token.
func linkOf(t testing.TB, app core.App, user *core.Record, token, lang string) *core.Record {
	t.Helper()
	return save(t, app, "calendar_feeds", map[string]any{"user": user.Id, "token_hash": hashOf(token), "lang": lang})
}

func TestCalendarRoutes(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "anon cannot create a link", As: "anon", Method: http.MethodPost, URL: at(calendarURL), Body: lang("fr"),
			Status: http.StatusUnauthorized,
			After: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				if got := len(feeds(t, app)); got != 0 {
					t.Errorf("%d links stored, want none", got)
				}
			},
		},
		{Name: "anon cannot ask whether there is a link", As: "anon", Method: http.MethodGet, URL: at(calendarURL), Status: http.StatusUnauthorized},
		{
			Name: "anon cannot delete a link", As: "anon", Method: http.MethodDelete, URL: at(calendarURL), Status: http.StatusUnauthorized,
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { linkOf(t, app, fx.Alice, "tok", "fr") },
			After: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				if got := len(feeds(t, app)); got != 1 {
					t.Errorf("%d links stored, want the one that was there", got)
				}
			},
		},

		{
			Name: "alice creates a link", As: "alice", Method: http.MethodPost, URL: at(calendarURL), Body: lang("fr"),
			Status:   http.StatusOK,
			Contains: []string{`"url":"` + appURL + `/api/app/calendar/`, `.ics"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				stored := feeds(t, app)
				if len(stored) != 1 {
					t.Fatalf("%d links stored, want 1", len(stored))
				}
				if stored[0].GetString("user") != fx.Alice.Id || stored[0].GetString("lang") != "fr" {
					t.Errorf("the link is for user %q in %q, want Alice in fr", stored[0].GetString("user"), stored[0].GetString("lang"))
				}
				if !regexp.MustCompile(`^[0-9a-f]{64}$`).MatchString(stored[0].GetString("token_hash")) {
					t.Errorf("token_hash = %q, want the 64 hexadecimal digits of a SHA-256", stored[0].GetString("token_hash"))
				}
			},
		},
		{
			Name: "the language of the link is in English when asked", As: "alice", Method: http.MethodPost, URL: at(calendarURL), Body: lang("en"),
			Status: http.StatusOK, Contains: []string{`.ics"`},
			After: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				if stored := feeds(t, app); len(stored) != 1 || stored[0].GetString("lang") != "en" {
					t.Errorf("stored links = %v, want one in en", stored)
				}
			},
		},
		{
			Name: "a language that the site does not speak is refused", As: "alice", Method: http.MethodPost, URL: at(calendarURL), Body: lang("de"),
			Status: http.StatusBadRequest, Contains: []string{fieldError("lang", "validation_invalid_value")},
			After: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				if got := len(feeds(t, app)); got != 0 {
					t.Errorf("%d links stored, want none", got)
				}
			},
		},
		{
			Name: "a link needs a language", As: "alice", Method: http.MethodPost, URL: at(calendarURL),
			Body:   func(testutil.Fixture) string { return `{}` },
			Status: http.StatusBadRequest, Contains: []string{fieldError("lang", "validation_required")},
		},
		{
			Name: "a body that is not JSON is the same as an empty one", As: "alice", Method: http.MethodPost, URL: at(calendarURL),
			Body:   func(testutil.Fixture) string { return `not json` },
			Status: http.StatusBadRequest, Contains: []string{fieldError("lang", "validation_required")},
		},
		{
			Name: "a new link replaces the one the account had", As: "alice", Method: http.MethodPost, URL: at(calendarURL), Body: lang("fr"),
			Status: http.StatusOK, Contains: []string{`.ics"`},
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				linkOf(t, app, fx.Alice, "old", "en")
				linkOf(t, app, fx.Bob, "bobs", "en")
			},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				var alices, bobs []*core.Record
				for _, stored := range feeds(t, app) {
					switch stored.GetString("user") {
					case fx.Alice.Id:
						alices = append(alices, stored)
					case fx.Bob.Id:
						bobs = append(bobs, stored)
					}
				}
				if len(alices) != 1 || alices[0].GetString("lang") != "fr" || alices[0].GetString("token_hash") == hashOf("old") {
					t.Errorf("Alice's links = %v, want one, in fr, with a new token", alices)
				}
				if len(bobs) != 1 || bobs[0].GetString("token_hash") != hashOf("bobs") {
					t.Errorf("Bob's links = %v, want his own, untouched", bobs)
				}
			},
		},

		{Name: "there is no link yet", As: "alice", Method: http.MethodGet, URL: at(calendarURL), Status: http.StatusOK, Contains: []string{`"exists":false`}},
		{
			Name: "there is a link", As: "alice", Method: http.MethodGet, URL: at(calendarURL), Status: http.StatusOK,
			Contains:    []string{`"exists":true`},
			NotContains: []string{"token", "hash"},
			Before:      func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { linkOf(t, app, fx.Alice, "tok", "fr") },
		},
		{
			Name: "the link of somebody else does not count", As: "alice", Method: http.MethodGet, URL: at(calendarURL), Status: http.StatusOK,
			Contains: []string{`"exists":false`},
			Before:   func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { linkOf(t, app, fx.Bob, "tok", "fr") },
		},

		{
			Name: "alice deletes her link and only hers", As: "alice", Method: http.MethodDelete, URL: at(calendarURL), Status: http.StatusNoContent,
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				linkOf(t, app, fx.Alice, "alices", "fr")
				linkOf(t, app, fx.Bob, "bobs", "fr")
			},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				stored := feeds(t, app)
				if len(stored) != 1 || stored[0].GetString("user") != fx.Bob.Id {
					t.Errorf("stored links = %v, want only Bob's", stored)
				}
			},
		},
		{
			Name: "deleting what is not there is not an error", As: "alice", Method: http.MethodDelete, URL: at(calendarURL), Status: http.StatusNoContent,
		},

		{
			Name: "the table is not open through the collection API", As: "alice", Method: http.MethodGet, URL: at("/api/collections/calendar_feeds/records"),
			Status:      http.StatusForbidden,
			NotContains: []string{"token_hash"},
			Before:      func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { linkOf(t, app, fx.Alice, "tok", "fr") },
		},
	})
}

// request calls the API as the user (anonymous when nil), fails the test when
// the status is not the expected one, and returns the headers and the body.
func request(t *testing.T, app *tests.TestApp, method, url string, user *core.Record, payload string, status int) (http.Header, string) {
	t.Helper()

	headers := map[string]string{}
	if user != nil {
		headers["Authorization"] = testutil.Token(t, user)
	}
	var body io.Reader
	if payload != "" {
		body = strings.NewReader(payload)
	}
	var (
		header http.Header
		text   string
	)
	(&tests.ApiScenario{
		Method:         method,
		URL:            url,
		Body:           body,
		Headers:        headers,
		ExpectedStatus: status,
		// A text that no response can contain: the body is read below.
		NotExpectedContent:    []string{"\x00"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			read, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			header, text = res.Header, string(read)
		},
	}).Test(t)
	return header, text
}

// subscribe creates the calendar link of the user, as the site does, and
// returns the path of its feed.
func subscribe(t *testing.T, app *tests.TestApp, user *core.Record, lang string) string {
	t.Helper()
	_, body := request(t, app, http.MethodPost, calendarURL, user, fmt.Sprintf(`{"lang":%q}`, lang), http.StatusOK)
	var response struct {
		URL string `json:"url"`
	}
	if err := json.Unmarshal([]byte(body), &response); err != nil {
		t.Fatalf("the response %q is not JSON: %v", body, err)
	}
	path, ok := strings.CutPrefix(response.URL, appURL)
	if !ok || !strings.HasPrefix(path, calendarURL+"/") || !strings.HasSuffix(path, ".ics") {
		t.Fatalf("the link %q is not %s/api/app/calendar/<token>.ics", response.URL, appURL)
	}
	return path
}

// TestCalendarRoutes_Replace and the ones that follow need several requests on
// one application, which the rows cannot do.
func TestCalendarRoutes_Replace(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	first := subscribe(t, app, fx.Alice, "fr")
	request(t, app, http.MethodGet, first, nil, "", http.StatusOK)

	second := subscribe(t, app, fx.Alice, "fr")
	if second == first {
		t.Fatal("a new link must have a new token")
	}
	_, body := request(t, app, http.MethodGet, first, nil, "", http.StatusNotFound)
	if !strings.Contains(body, `"code":"not_found"`) {
		t.Errorf("the old link answers %q, want the code not_found", body)
	}
	request(t, app, http.MethodGet, second, nil, "", http.StatusOK)

	// The link that is deleted stops working too.
	request(t, app, http.MethodDelete, calendarURL, fx.Alice, "", http.StatusNoContent)
	request(t, app, http.MethodGet, second, nil, "", http.StatusNotFound)
	_, body = request(t, app, http.MethodGet, calendarURL, fx.Alice, "", http.StatusOK)
	if !strings.Contains(body, `"exists":false`) {
		t.Errorf("after deleting the link, the answer is %q, want exists false", body)
	}
}

// vevent is the properties of an event of a feed, by name, without their
// parameters: DTSTART;VALUE=DATE is DTSTART. The values are as they are in the
// file (escaped).
type vevent map[string]string

// parseFeed reads the events of a feed, in the order of the file. It checks the
// frame of the calendar on the way.
func parseFeed(t *testing.T, feed string) []vevent {
	t.Helper()
	all := lines(t, feed)
	if all[0] != "BEGIN:VCALENDAR" || all[len(all)-1] != "END:VCALENDAR" {
		t.Fatalf("the feed is not framed by VCALENDAR:\n%q", feed)
	}

	var events []vevent
	var current vevent
	for _, line := range unfold(feed) {
		switch line {
		case "BEGIN:VEVENT":
			current = vevent{}
		case "END:VEVENT":
			events = append(events, current)
			current = nil
		default:
			if current == nil {
				continue
			}
			name, value, _ := strings.Cut(line, ":")
			name, _, _ = strings.Cut(name, ";")
			current[name] = value
		}
	}
	return events
}

// dropStamps removes the DTSTAMP lines of a feed, the only ones that come from
// the clock.
func dropStamps(feed string) string {
	return regexp.MustCompile(`DTSTAMP:\d{8}T\d{6}Z\r\n`).ReplaceAllString(feed, "")
}

// agenda is what the tests of the feed set up for Alice, and what they expect
// of it: the ids that name events, formats and participations.
type agenda struct {
	// registered is the participation of the fixture: Alice is registered to
	// F42, a race of the event "Trail des Crêtes" which has a deadline too.
	registered *core.Record
	// lyon is Alice, interested in the 10 km of Lyon, whose deadline is over.
	lyon, lyonEvent *core.Record
	// marathon and short are two races of one event, whose name has a comma
	// and a semicolon, and that Alice is interested in: one deadline for both.
	marathon, short, crests *core.Record
	// supporter is Alice, supporter of an event of two days.
	supporter, festival *core.Record
	// dns is Alice, who does not start a race.
	dns, dnsEvent *core.Record
}

// setUpAgenda adds to the fixture what the feed of Alice is made of. Bob is
// interested in F42 and Sam in F15 (the fixture): none of them is in her feed.
func setUpAgenda(t *testing.T, app *tests.TestApp, fx testutil.Fixture) agenda {
	t.Helper()
	var a agenda
	a.registered = fx.P1

	deadline := func(event *core.Record, day string) {
		t.Helper()
		event.Set("registration_deadline", day)
		if err := app.Save(event); err != nil {
			t.Fatal(err)
		}
	}
	// Alice is registered to F42: there is nothing to close for her.
	deadline(fx.Event, "2026-05-01")

	deadline(fx.Event2, "2026-06-01")
	a.lyonEvent = fx.Event2
	a.lyon = save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": fx.FLyon.Id, "status": "interested", "added_by": fx.BobRunner.Id,
	})

	a.crests = save(t, app, "events", map[string]any{
		"name": "Course, des; Crêtes", "location": "Aix-les-Bains, Savoie",
		"start_date": "2026-09-05", "end_date": "2026-09-06", "registration_deadline": "2026-08-01",
		"created_by": fx.AliceRunner.Id,
	})
	marathon := save(t, app, "formats", map[string]any{
		"event": a.crests.Id, "race_type": fx.Trail.Id, "name": "Marathon", "distance_km": 42, "date": "2026-09-06",
	})
	short := save(t, app, "formats", map[string]any{
		"event": a.crests.Id, "race_type": fx.Road.Id, "duration_min": 360,
	})
	a.marathon = save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": marathon.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	a.short = save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": short.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})

	a.festival = save(t, app, "events", map[string]any{
		"name": "Fête du Trail", "location": "Chamonix",
		"start_date": "2026-07-04", "end_date": "2026-07-05", "created_by": fx.AliceRunner.Id,
	})
	a.supporter = save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "event": a.festival.Id, "status": "supporter", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})

	a.dnsEvent = save(t, app, "events", map[string]any{
		"name": "Course annulée", "location": "Pau",
		"start_date": "2026-10-10", "registration_deadline": "2026-10-01", "created_by": fx.AliceRunner.Id,
	})
	dnsFormat := save(t, app, "formats", map[string]any{
		"event": a.dnsEvent.Id, "race_type": fx.Road.Id, "distance_km": 21.1,
	})
	a.dns = save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": dnsFormat.Id, "status": "dns", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	return a
}

// uid is the UID of the event of a participation, or of the closing of the
// registrations of an event for a runner.
func uid(participation *core.Record) string {
	return "participation-" + participation.Id + "@prends-ton-dossard"
}

func deadlineUID(event, runner *core.Record) string {
	return "deadline-" + event.Id + "-" + runner.Id + "@prends-ton-dossard"
}

func TestCalendarFeed(t *testing.T) {
	t.Run("the feed of Alice", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		a := setUpAgenda(t, app, fx)
		path := subscribe(t, app, fx.Alice, "fr")

		header, feed := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
		if got := header.Get("Content-Type"); got != "text/calendar; charset=utf-8" {
			t.Errorf("Content-Type = %q, want text/calendar; charset=utf-8", got)
		}
		events := parseFeed(t, feed)

		byUID := map[string]vevent{}
		var uids []string
		for _, event := range events {
			if _, twice := byUID[event["UID"]]; twice {
				t.Errorf("the UID %s is in the feed twice", event["UID"])
			}
			byUID[event["UID"]] = event
			uids = append(uids, event["UID"])
		}

		// What is in the feed: her races and her days at an event, and the day
		// the registrations close for the events that she is only interested in
		// (once, even with two races), the one whose deadline is over included.
		want := []string{
			uid(a.registered), uid(a.lyon), uid(a.marathon), uid(a.short), uid(a.supporter),
			deadlineUID(a.lyonEvent, fx.AliceRunner), deadlineUID(a.crests, fx.AliceRunner),
		}
		for _, id := range want {
			if _, ok := byUID[id]; !ok {
				t.Errorf("the feed has no event %s; it has %q", id, uids)
			}
		}
		if len(events) != len(want) {
			t.Errorf("%d events in the feed, want %d: %q", len(events), len(want), uids)
		}
		// What is not: a race she does not start, the others' races, and the
		// closing of an event that she is registered to.
		for name, id := range map[string]string{
			"her race that she does not start":            uid(a.dns),
			"Bob's race":                                  uid(fx.P2),
			"Sam's race":                                  uid(fx.P3),
			"the deadline of her registered event":        deadlineUID(fx.Event, fx.AliceRunner),
			"the deadline of the race she does not start": deadlineUID(a.dnsEvent, fx.AliceRunner),
			"the deadline of Bob's event":                 deadlineUID(fx.Event, fx.BobRunner),
		} {
			if _, ok := byUID[id]; ok {
				t.Errorf("the feed has %s (%s)", name, id)
			}
		}
		for _, leak := range []string{"Course annulée", "Pau"} {
			if strings.Contains(feed, leak) {
				t.Errorf("the feed of Alice mentions %q, which is only in the race she does not start", leak)
			}
		}

		eventURL := func(event *core.Record) string { return appURL + "/evenements/" + event.Id }
		for _, tt := range []struct {
			name string
			uid  string
			want vevent
		}{
			{
				// The race has a date of its own, the day after the first of the event.
				"a race with a date", uid(a.registered),
				vevent{
					"SUMMARY": "Trail des Crêtes · Trail 42 km", "DTSTART": "20260614", "DTEND": "20260615",
					"DESCRIPTION": `Inscrit\n` + eventURL(fx.Event), "URL": eventURL(fx.Event), "LOCATION": "Annecy",
				},
			},
			{
				// No date on the race: the first day of the event. Not confirmed.
				"a race without a date", uid(a.lyon),
				vevent{
					"SUMMARY": "10 km de Lyon · Route 10 km", "DTSTART": "20260622", "DTEND": "20260623",
					"DESCRIPTION": `Intéressé · non confirmé\n` + eventURL(a.lyonEvent), "URL": eventURL(a.lyonEvent), "LOCATION": "Lyon",
				},
			},
			{
				// The comma and the semicolon of a name are escaped, those of a
				// location too. The race is called by its name.
				"escaped text", uid(a.marathon),
				vevent{
					"SUMMARY": `Course\, des\; Crêtes · Marathon`, "DTSTART": "20260906", "DTEND": "20260907",
					"DESCRIPTION": `Intéressé\n` + eventURL(a.crests), "URL": eventURL(a.crests), "LOCATION": `Aix-les-Bains\, Savoie`,
				},
			},
			{
				"a race with a duration", uid(a.short),
				vevent{"SUMMARY": `Course\, des\; Crêtes · Route 6h`, "DTSTART": "20260905", "DTEND": "20260906"},
			},
			{
				// An event of two days, from the 4th to the 5th: the end is the 6th.
				"a supporter has the days of the event", uid(a.supporter),
				vevent{
					"SUMMARY": "Fête du Trail", "DTSTART": "20260704", "DTEND": "20260706",
					"DESCRIPTION": `Supporteur\n` + eventURL(a.festival), "URL": eventURL(a.festival), "LOCATION": "Chamonix",
				},
			},
			{
				// A deadline that is over is in the feed, as a day of its own. It
				// has no place: a registration does not close in Lyon.
				"a deadline", deadlineUID(a.lyonEvent, fx.AliceRunner),
				vevent{
					"SUMMARY": "Clôture des inscriptions · 10 km de Lyon", "DTSTART": "20260601", "DTEND": "20260602",
					"DESCRIPTION": eventURL(a.lyonEvent), "URL": eventURL(a.lyonEvent), "LOCATION": "",
				},
			},
			{
				"a deadline of an event with two races", deadlineUID(a.crests, fx.AliceRunner),
				vevent{
					"SUMMARY": `Clôture des inscriptions · Course\, des\; Crêtes`, "DTSTART": "20260801", "DTEND": "20260802",
					"DESCRIPTION": eventURL(a.crests), "LOCATION": "",
				},
			},
		} {
			t.Run(tt.name, func(t *testing.T) {
				got, ok := byUID[tt.uid]
				if !ok {
					t.Fatalf("no event %s in the feed", tt.uid)
				}
				for name, value := range tt.want {
					if got[name] != value {
						t.Errorf("%s = %q, want %q", name, got[name], value)
					}
				}
				if !regexp.MustCompile(`^\d{8}T\d{6}Z$`).MatchString(got["DTSTAMP"]) {
					t.Errorf("DTSTAMP = %q, want a UTC date and time", got["DTSTAMP"])
				}
			})
		}

		// The events are in the order of their first day, then of their UID.
		sorted := slices.IsSortedFunc(events, func(x, y vevent) int {
			if c := strings.Compare(x["DTSTART"], y["DTSTART"]); c != 0 {
				return c
			}
			return strings.Compare(x["UID"], y["UID"])
		})
		if !sorted {
			t.Errorf("the events are not by first day, then UID: %q", uids)
		}

		// A calendar app that reads the feed again must find the same events:
		// an UID that changes makes it add them instead of updating them.
		_, again := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
		if dropStamps(again) != dropStamps(feed) {
			t.Errorf("a second reading differs from the first, beyond the stamps:\n%q\n%q", dropStamps(feed), dropStamps(again))
		}
		var againUIDs []string
		for _, event := range parseFeed(t, again) {
			againUIDs = append(againUIDs, event["UID"])
		}
		if !slices.Equal(againUIDs, uids) {
			t.Errorf("the UIDs of a second reading = %q, want %q", againUIDs, uids)
		}
	})

	t.Run("the feed in English", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		a := setUpAgenda(t, app, fx)
		_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Alice, "en"), nil, "", http.StatusOK)

		got := map[string]vevent{}
		for _, event := range parseFeed(t, feed) {
			got[event["UID"]] = event
		}
		if !strings.Contains(feed, "PRODID:-//Prends ton dossard//EN\r\n") {
			t.Errorf("the product is not in English:\n%q", feed)
		}
		eventURL := appURL + "/evenements/" + fx.Event.Id
		for _, tt := range []struct{ uid, name, want string }{
			{uid(a.registered), "DESCRIPTION", `Registered\n` + eventURL},
			{uid(a.lyon), "DESCRIPTION", `Interested · unconfirmed\n` + appURL + "/evenements/" + a.lyonEvent.Id},
			{uid(a.supporter), "DESCRIPTION", `Supporter\n` + appURL + "/evenements/" + a.festival.Id},
			{deadlineUID(a.lyonEvent, fx.AliceRunner), "SUMMARY", "Registration closes · 10 km de Lyon"},
			{uid(a.short), "SUMMARY", `Course\, des\; Crêtes · Route 6h`},
		} {
			if got[tt.uid][tt.name] != tt.want {
				t.Errorf("%s of %s = %q, want %q", tt.name, tt.uid, got[tt.uid][tt.name], tt.want)
			}
		}
	})

	// The name of a race, as on the site (formatDisplayName): the name that was
	// typed, else the type and the distance, else the type and the duration,
	// else the type and the time limit.
	t.Run("the names of the races", func(t *testing.T) {
		races := []struct {
			name     string
			format   func(testutil.Fixture) map[string]any
			fr, en   string
			describe string
		}{
			{"a name", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Road.Id, "name": "  Marathon de Lyon ", "distance_km": 42.195}
			}, "Marathon de Lyon", "Marathon de Lyon", ""},
			{"a distance with decimals", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Road.Id, "distance_km": 42.195}
			}, "Route 42,2 km", "Route 42.2 km", ""},
			{"a whole distance", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Trail.Id, "distance_km": 15}
			}, "Trail 15 km", "Trail 15 km", ""},
			{"a distance below one", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Trail.Id, "distance_km": 0.5}
			}, "Trail 0,5 km", "Trail 0.5 km", ""},
			{"the distance comes before the duration", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Cross.Id, "distance_km": 8, "duration_min": 60}
			}, "Cross 8 km", "Cross 8 km", ""},
			{"hours and minutes", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Trail.Id, "duration_min": 90}
			}, "Trail 1h 30min", "Trail 1h 30m", ""},
			{"hours only", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Trail.Id, "duration_min": 360}
			}, "Trail 6h", "Trail 6h", ""},
			{"minutes only", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Trail.Id, "duration_min": 45}
			}, "Trail 45min", "Trail 45m", ""},
			{"a time limit", func(fx testutil.Fixture) map[string]any {
				return map[string]any{"race_type": fx.Backyard.Id, "time_limit_min": 2880}
			}, "Backyard max 48h", "Backyard max 48h", ""},
		}

		for _, language := range []string{"fr", "en"} {
			t.Run(language, func(t *testing.T) {
				app := testutil.NewApp(t)
				fx := testutil.Seed(t, app)
				event := save(t, app, "events", map[string]any{
					"name": "Open", "location": "Nice", "start_date": "2026-09-05", "created_by": fx.AliceRunner.Id,
				})
				var uids []string
				for _, race := range races {
					values := race.format(fx)
					values["event"] = event.Id
					format := save(t, app, "formats", values)
					participation := save(t, app, "participations", map[string]any{
						"runner": fx.AliceRunner.Id, "format": format.Id, "status": "registered", "added_by": fx.AliceRunner.Id,
					})
					uids = append(uids, uid(participation))
				}

				_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Alice, language), nil, "", http.StatusOK)
				summaries := map[string]string{}
				for _, e := range parseFeed(t, feed) {
					summaries[e["UID"]] = e["SUMMARY"]
				}
				for i, race := range races {
					want := race.fr
					if language == "en" {
						want = race.en
					}
					// The summaries are read as they are in the file: the comma of
					// a French distance is escaped there.
					want = "Open · " + strings.ReplaceAll(want, ",", `\,`)
					if got := summaries[uids[i]]; got != want {
						t.Errorf("%s: SUMMARY = %q, want %q", race.name, got, want)
					}
				}
			})
		}
	})

	t.Run("an unknown token is not found", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		path := subscribe(t, app, fx.Alice, "fr")
		token := strings.TrimSuffix(strings.TrimPrefix(path, calendarURL+"/"), ".ics")
		stored := feeds(t, app)

		for name, url := range map[string]string{
			"a token that nobody has":      calendarURL + "/" + strings.Repeat("A", len(token)) + ".ics",
			"the token without its suffix": calendarURL + "/" + token,
			"the token and another suffix": calendarURL + "/" + token + ".ical",
			"nothing but the suffix":       calendarURL + "/.ics",
			// What the database holds is not a link: it is the SHA-256 of one.
			"the hash that is stored": calendarURL + "/" + stored[0].GetString("token_hash") + ".ics",
		} {
			t.Run(name, func(t *testing.T) {
				header, body := request(t, app, http.MethodGet, url, nil, "", http.StatusNotFound)
				if !strings.Contains(body, `"code":"not_found"`) {
					t.Errorf("the body is %q, want the code not_found", body)
				}
				if strings.Contains(header.Get("Content-Type"), "calendar") {
					t.Errorf("Content-Type = %q, an error is not a calendar", header.Get("Content-Type"))
				}
			})
		}
	})

	t.Run("an account that is disabled loses its feed", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		path := subscribe(t, app, fx.Alice, "fr")
		request(t, app, http.MethodGet, path, nil, "", http.StatusOK)

		alice, err := app.FindRecordById("users", fx.Alice.Id)
		if err != nil {
			t.Fatal(err)
		}
		alice.Set("disabled", true)
		if err := app.Save(alice); err != nil {
			t.Fatal(err)
		}
		request(t, app, http.MethodGet, path, nil, "", http.StatusNotFound)

		// The link is not lost: the account is enabled again, the feed is back.
		alice.Set("disabled", false)
		if err := app.Save(alice); err != nil {
			t.Fatal(err)
		}
		request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
	})

	t.Run("an account without a runner has an empty calendar", func(t *testing.T) {
		app := testutil.NewApp(t)
		// The fixture has participations, none of them this account's: they must
		// not show up, not even those of Sam, who has no account either.
		testutil.Seed(t, app)
		account := save(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
		path := subscribe(t, app, account, "fr")

		header, feed := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
		if got := header.Get("Content-Type"); got != "text/calendar; charset=utf-8" {
			t.Errorf("Content-Type = %q, want text/calendar; charset=utf-8", got)
		}
		if events := parseFeed(t, feed); len(events) != 0 {
			t.Errorf("%d events in the feed of an account without a runner, want none", len(events))
		}
	})
}

// A token in a path is in the request log of PocketBase unless the route keeps
// it out. The feed does when it succeeds: an error is logged, with the token
// that failed, which gives nobody access.
func TestCalendarFeed_ActivityLog(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	app.Settings().Logs.MaxDays = 5 // the logs are off in a test application

	path := subscribe(t, app, fx.Alice, "fr")
	request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
	const unknown = calendarURL + "/unknown-token.ics"
	request(t, app, http.MethodGet, unknown, nil, "", http.StatusNotFound)

	// The log is written in the background: wait for the failure, which came
	// after the success, to be there.
	handler, ok := app.Logger().Handler().(*logger.BatchHandler)
	if !ok {
		t.Fatalf("the logger of the application is a %T, want a batch handler", app.Logger().Handler())
	}
	var messages []string
	deadline := time.Now().Add(5 * time.Second)
	for {
		if err := handler.WriteAll(context.WithValue(context.Background(), logger.BlockKey, true)); err != nil {
			t.Fatal(err)
		}
		var logs []*core.Log
		if err := app.LogQuery().All(&logs); err != nil {
			t.Fatal(err)
		}
		messages = messages[:0]
		for _, log := range logs {
			messages = append(messages, log.Message)
		}
		if slices.Contains(messages, "GET "+unknown) {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the failed request is not in the log after 5 seconds: %q", messages)
		}
		time.Sleep(20 * time.Millisecond)
	}
	for _, message := range messages {
		if strings.Contains(message, path) {
			t.Errorf("the request log has %q: a feed that is read must leave no trace of its token", message)
		}
	}
}
