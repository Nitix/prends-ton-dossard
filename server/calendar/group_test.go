package calendar_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// subscribeTo creates the link of the user of that scope, and returns the path of
// its feed.
func subscribeTo(t *testing.T, app *tests.TestApp, user *core.Record, scope, lang string) string {
	t.Helper()
	body := fmt.Sprintf(`{"lang":%q,"scope":%q}`, lang, scope)
	_, answer := request(t, app, http.MethodPost, calendarURL, user, body, http.StatusOK)
	return pathOf(t, parseURL(t, answer))
}

// shownScope asks whether the user has a link of that scope, and its address.
func shownScope(t *testing.T, app *tests.TestApp, user *core.Record, scope string) (bool, string) {
	t.Helper()
	_, answer := request(t, app, http.MethodGet, calendarURL+"?scope="+scope, user, "", http.StatusOK)
	var exists bool
	if strings.Contains(answer, `"exists":true`) {
		exists = true
	}
	return exists, parseURL(t, answer)
}

// daysAgo is the day, YYYY-MM-DD, that is n days before today in Paris.
func daysAgo(n int) string {
	paris, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		panic(err)
	}
	return time.Now().In(paris).AddDate(0, 0, -n).Format(time.DateOnly)
}

// unescape reads a TEXT value of a feed (RFC 5545, 3.3.11).
func unescape(v string) string {
	var b strings.Builder
	for i := 0; i < len(v); i++ {
		if v[i] != '\\' || i+1 == len(v) {
			b.WriteByte(v[i])
			continue
		}
		i++
		if v[i] == 'n' || v[i] == 'N' {
			b.WriteByte('\n')
		} else {
			b.WriteByte(v[i])
		}
	}
	return b.String()
}

// Who goes, in the feed of the group: every event with somebody who does not
// "dns" in it and whose last day is at most a year back, once, with the names.
func TestCalendarFeed_Group(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	runner := func(name string) *core.Record {
		return save(t, app, "runners", map[string]any{"name": name})
	}
	event := func(name, first, last string) *core.Record {
		return save(t, app, "events", map[string]any{
			"name": name, "location": "Annecy, Savoie", "start_date": first, "end_date": last,
			"created_by": fx.AliceRunner.Id,
		})
	}
	format := func(event, raceType *core.Record, km float64, day string) *core.Record {
		values := map[string]any{"event": event.Id, "race_type": raceType.Id, "distance_km": km}
		if day != "" {
			values["date"] = day
		}
		return save(t, app, "formats", values)
	}
	join := func(who *core.Record, event, format *core.Record, status string, confirmed bool) *core.Record {
		values := map[string]any{"runner": who.Id, "status": status, "confirmed": confirmed, "added_by": fx.AliceRunner.Id}
		if format != nil {
			values["format"] = format.Id
		} else {
			values["event"] = event.Id
		}
		return save(t, app, "participations", values)
	}

	lea, max, nadia := runner("Léa"), runner("Max, \\ Bo;b"), runner("Nadia")

	// The big one: two races, somebody interested without a race, a supporter,
	// and somebody who does not start.
	first, second := daysAgo(30), daysAgo(29)
	big := event("Grand Raid, des; Crêtes", first, second)
	f42, f15 := format(big, fx.Trail, 42, first), format(big, fx.Trail, 15, second)
	join(fx.AliceRunner, big, f42, "registered", true)
	join(fx.BobRunner, big, f42, "interested", false)
	join(fx.SamRunner, big, f15, "registered", true)
	join(lea, big, nil, "interested", false)
	join(max, big, nil, "supporter", true)
	join(nadia, big, f42, "dns", true)

	supportersOnly := event("Cross des Supporters", daysAgo(10), daysAgo(10))
	format(supportersOnly, fx.Cross, 8, "")
	join(max, supportersOnly, nil, "supporter", true)

	undecidedOnly := event("Course à choisir", daysAgo(5), daysAgo(5))
	format(undecidedOnly, fx.Road, 10, "")
	join(lea, undecidedOnly, nil, "interested", false)

	nobodyGoes := event("Course où personne ne va", daysAgo(3), daysAgo(3))
	nonStarters := format(nobodyGoes, fx.Road, 10, "")
	join(nadia, nobodyGoes, nonStarters, "dns", true)

	empty := event("Course sans personne", daysAgo(2), daysAgo(2))
	format(empty, fx.Road, 10, "")

	// A year back is the last day of the event: 365 days ago is in, 366 out.
	lastYear := event("Course d'il y a 365 jours", daysAgo(366), daysAgo(365))
	lastYearFormat := format(lastYear, fx.Road, 10, "")
	join(lea, lastYear, lastYearFormat, "finished", true)
	tooOld := event("Course d'il y a 366 jours", daysAgo(367), daysAgo(366))
	tooOldFormat := format(tooOld, fx.Road, 10, "")
	join(lea, tooOld, tooOldFormat, "finished", true)
	// An event of several days counts from its last day, not its first.
	longAgo := event("Course de plusieurs jours", daysAgo(400), daysAgo(364))
	longAgoFormat := format(longAgo, fx.Road, 10, "")
	join(lea, longAgo, longAgoFormat, "finished", true)

	// A race known by its month: the 1st alone.
	month := save(t, app, "events", map[string]any{
		"name": "Trail du Mois", "location": "Annecy", "start_date": "2099-06-01", "date_precision": "month",
		"created_by": fx.AliceRunner.Id,
	})
	join(lea, month, nil, "interested", false)

	feedOf := func(t *testing.T, lang string) (string, map[string]vevent) {
		t.Helper()
		path := subscribeTo(t, app, fx.Alice, "group", lang)
		header, feed := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
		if got := header.Get("Content-Type"); got != "text/calendar; charset=utf-8" {
			t.Errorf("Content-Type = %q, want text/calendar; charset=utf-8", got)
		}
		byUID := map[string]vevent{}
		for _, e := range parseFeed(t, feed) {
			byUID[e["UID"]] = e
		}
		return feed, byUID
	}
	uidOf := func(e *core.Record) string { return "group-" + e.Id + "@prends-ton-dossard" }

	feed, byUID := feedOf(t, "fr")

	t.Run("the events with somebody, once each", func(t *testing.T) {
		for _, in := range []*core.Record{big, supportersOnly, undecidedOnly, lastYear, longAgo, month} {
			if _, ok := byUID[uidOf(in)]; !ok {
				t.Errorf("%s is not in the feed", in.GetString("name"))
			}
		}
		for _, out := range []*core.Record{nobodyGoes, empty, tooOld} {
			if _, ok := byUID[uidOf(out)]; ok {
				t.Errorf("%s is in the feed", out.GetString("name"))
			}
		}
		if got := strings.Count(feed, "UID:group-"+big.Id); got != 1 {
			t.Errorf("the big event has %d entries, want one for the whole event", got)
		}
	})

	t.Run("the description says who goes, by race, then the rest, then the address", func(t *testing.T) {
		want := strings.Join([]string{
			"Trail 42 km : Alice (Inscrit), Bob (Intéressé · non confirmé)",
			"Trail 15 km : Sam (Inscrit)",
			"Intéressés, format à choisir : Léa",
			"Supporteurs : Max, \\ Bo;b",
			appURL + "/evenements/" + big.Id,
		}, "\n")
		got := unescape(byUID[uidOf(big)]["DESCRIPTION"])
		if got != want {
			t.Errorf("the description is\n%s\nwant\n%s", got, want)
		}
		if only := unescape(byUID[uidOf(supportersOnly)]["DESCRIPTION"]); only != "Supporteurs : Max, \\ Bo;b\n"+appURL+"/evenements/"+supportersOnly.Id {
			t.Errorf("the description of the supporters' event is %q", only)
		}
		if only := unescape(byUID[uidOf(undecidedOnly)]["DESCRIPTION"]); only != "Intéressés, format à choisir : Léa\n"+appURL+"/evenements/"+undecidedOnly.Id {
			t.Errorf("the description of the undecided event is %q", only)
		}
	})

	t.Run("the names are text: escaped, and a non-starter is nowhere", func(t *testing.T) {
		if !strings.Contains(feed, `Supporteurs : Max\, \\ Bo\;b`) {
			t.Errorf("the comma, the backslash and the semicolon of a name are not escaped:\n%s", feed)
		}
		if strings.Contains(feed, "Nadia") {
			t.Error("the name of somebody who does not start is in the feed")
		}
		for _, line := range lines(t, feed) {
			if len(line) > 75 {
				t.Errorf("a line of %d octets, want at most 75: %q", len(line), line)
			}
		}
	})

	t.Run("the days, the place and the address of the event", func(t *testing.T) {
		e := byUID[uidOf(big)]
		start, _ := time.Parse(time.DateOnly, first)
		if e["SUMMARY"] != `Grand Raid\, des\; Crêtes` {
			t.Errorf("SUMMARY = %q", e["SUMMARY"])
		}
		if e["DTSTART"] != start.Format("20060102") || e["DTEND"] != start.AddDate(0, 0, 2).Format("20060102") {
			t.Errorf("DTSTART %q, DTEND %q, want the two days of the event", e["DTSTART"], e["DTEND"])
		}
		if e["LOCATION"] != `Annecy\, Savoie` || e["URL"] != appURL+"/evenements/"+big.Id {
			t.Errorf("LOCATION %q, URL %q", e["LOCATION"], e["URL"])
		}
	})

	t.Run("a race known by its month is the 1st, to be set", func(t *testing.T) {
		e := byUID[uidOf(month)]
		if e["SUMMARY"] != "Trail du Mois (date à préciser)" || e["DTSTART"] != "20990601" || e["DTEND"] != "20990602" {
			t.Errorf("SUMMARY %q, DTSTART %q, DTEND %q, want the 1st alone, to be set", e["SUMMARY"], e["DTSTART"], e["DTEND"])
		}
	})

	t.Run("the calendar is named, and has no alarm, opening or deadline", func(t *testing.T) {
		if !strings.Contains(feed, "\r\nX-WR-CALNAME:Prends ton dossard · groupe\r\n") {
			t.Errorf("the calendar is not named for the group:\n%s", feed)
		}
		if !strings.Contains(feed, "\r\nREFRESH-INTERVAL;VALUE=DURATION:PT1H\r\n") {
			t.Error("no refresh interval")
		}
		for _, banned := range []string{"VALARM", "TRIGGER", "opening-", "deadline-", "participation-"} {
			if strings.Contains(feed, banned) {
				t.Errorf("the group feed holds %q", banned)
			}
		}
	})

	t.Run("an account that chose reminders still has no alarm in it", func(t *testing.T) {
		alice, err := app.FindRecordById("users", fx.Alice.Id)
		if err != nil {
			t.Fatal(err)
		}
		alice.Set("reminders", []string{"day", "hour"})
		if err := app.Save(alice); err != nil {
			t.Fatal(err)
		}
		withOpening, err := app.FindRecordById("events", big.Id)
		if err != nil {
			t.Fatal(err)
		}
		withOpening.Set("registration_opening", daysAgo(40))
		withOpening.Set("registration_opening_time", "09:00")
		if err := app.Save(withOpening); err != nil {
			t.Fatal(err)
		}
		path := subscribeTo(t, app, fx.Alice, "group", "fr")
		_, text := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
		if strings.Contains(text, "VALARM") || strings.Contains(text, "Ouverture") {
			t.Errorf("an alarm or an opening in the group feed:\n%s", text)
		}
	})

	t.Run("in English", func(t *testing.T) {
		feed, byUID := feedOf(t, "en")
		if !strings.Contains(feed, "\r\nX-WR-CALNAME:Prends ton dossard · group\r\n") {
			t.Errorf("the English calendar is not named for the group")
		}
		got := unescape(byUID[uidOf(big)]["DESCRIPTION"])
		for _, want := range []string{"Trail 42 km: Alice (Registered), Bob (Interested · not confirmed)", "Interested, format to be chosen: Léa", "Supporters: Max, \\ Bo;b"} {
			if !strings.Contains(got, want) {
				t.Errorf("the English description lacks %q:\n%s", want, got)
			}
		}
	})
}

// A link of each scope: they do not touch each other, the feed is the one of the
// link, and a scope that is not one is refused.
func TestCalendarRoutes_Scope(t *testing.T) {
	t.Run("no group link, then one, and the personal link is untouched by it", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		if exists, url := shownScope(t, app, fx.Alice, "group"); exists || url != "" {
			t.Errorf("a group link before any: exists %v, url %q", exists, url)
		}
		mine := subscribeTo(t, app, fx.Alice, "mine", "fr")
		if exists, url := shownScope(t, app, fx.Alice, "group"); exists || url != "" {
			t.Errorf("a personal link makes a group one: exists %v, url %q", exists, url)
		}

		group := subscribeTo(t, app, fx.Alice, "group", "en")
		if group == mine {
			t.Fatal("the group link has the address of the personal one")
		}
		if got := len(feeds(t, app)); got != 2 {
			t.Errorf("%d links stored, want one of each scope", got)
		}
		for scope, want := range map[string]string{"group": group, "mine": mine} {
			if exists, url := shownScope(t, app, fx.Alice, scope); !exists || url != appURL+want {
				t.Errorf("the %s link shows exists %v, url %q", scope, exists, url)
			}
		}
		// Without a scope, the personal link: the site and the MCP that exist.
		if exists, url := shown(t, app, fx.Alice); !exists || url != appURL+mine {
			t.Errorf("without a scope: exists %v, url %q, want the personal link", exists, url)
		}

		// Each feed is its own: the language, the name, and what it holds.
		_, mineFeed := request(t, app, http.MethodGet, mine, nil, "", http.StatusOK)
		_, groupFeed := request(t, app, http.MethodGet, group, nil, "", http.StatusOK)
		if !strings.Contains(mineFeed, "X-WR-CALNAME:Prends ton dossard\r\n") || strings.Contains(mineFeed, "UID:group-") {
			t.Errorf("the personal feed is not the personal one:\n%s", mineFeed)
		}
		if !strings.Contains(groupFeed, "X-WR-CALNAME:Prends ton dossard · group\r\n") || strings.Contains(groupFeed, "UID:participation-") {
			t.Errorf("the group feed is not the group one:\n%s", groupFeed)
		}

		// Renewing the group link leaves the personal one, and the other way.
		renewed := subscribeTo(t, app, fx.Alice, "group", "fr")
		request(t, app, http.MethodGet, group, nil, "", http.StatusNotFound)
		request(t, app, http.MethodGet, renewed, nil, "", http.StatusOK)
		request(t, app, http.MethodGet, mine, nil, "", http.StatusOK)
		if got := len(feeds(t, app)); got != 2 {
			t.Errorf("%d links stored after a renewal, want 2", got)
		}
		newMine := subscribeTo(t, app, fx.Alice, "mine", "fr")
		request(t, app, http.MethodGet, mine, nil, "", http.StatusNotFound)
		request(t, app, http.MethodGet, newMine, nil, "", http.StatusOK)
		request(t, app, http.MethodGet, renewed, nil, "", http.StatusOK)
		if exists, url := shownScope(t, app, fx.Alice, "group"); !exists || url != appURL+renewed {
			t.Errorf("the group link after the personal one was renewed: exists %v, url %q", exists, url)
		}

		// A scope of the body can be said as mine.
		_, said := request(t, app, http.MethodPost, calendarURL, fx.Alice, `{"lang":"fr","scope":"mine"}`, http.StatusOK)
		newMine = pathOf(t, parseURL(t, said))
		if got := len(feeds(t, app)); got != 2 {
			t.Errorf("%d links after a renewal with scope mine, want 2", got)
		}

		// Another account has its own.
		if exists, _ := shownScope(t, app, fx.Bob, "group"); exists {
			t.Error("Bob has the group link of Alice")
		}

		// Deleting the group link deletes only it.
		request(t, app, http.MethodDelete, calendarURL+"?scope=group", fx.Alice, "", http.StatusNoContent)
		request(t, app, http.MethodGet, renewed, nil, "", http.StatusNotFound)
		request(t, app, http.MethodGet, newMine, nil, "", http.StatusOK)
		if exists, _ := shownScope(t, app, fx.Alice, "group"); exists {
			t.Error("the group link is still there")
		}
		if exists, _ := shownScope(t, app, fx.Alice, "mine"); !exists {
			t.Error("deleting the group link deleted the personal one")
		}
		// Without a scope, a delete is the personal one's.
		request(t, app, http.MethodDelete, calendarURL, fx.Alice, "", http.StatusNoContent)
		if exists, _ := shownScope(t, app, fx.Alice, "mine"); exists {
			t.Error("the personal link is still there")
		}
	})

	t.Run("a scope that is not one is refused, and nothing is written", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		subscribeTo(t, app, fx.Alice, "group", "fr")
		for name, call := range map[string]func() string{
			"GET": func() string {
				_, body := request(t, app, http.MethodGet, calendarURL+"?scope=team", fx.Alice, "", http.StatusBadRequest)
				return body
			},
			"POST": func() string {
				_, body := request(t, app, http.MethodPost, calendarURL, fx.Alice, `{"lang":"fr","scope":"team"}`, http.StatusBadRequest)
				return body
			},
			"DELETE": func() string {
				_, body := request(t, app, http.MethodDelete, calendarURL+"?scope=team", fx.Alice, "", http.StatusBadRequest)
				return body
			},
		} {
			if body := call(); !strings.Contains(body, fieldError("scope", "validation_invalid_value")) {
				t.Errorf("%s with scope=team answers %s, want a refusal on scope", name, body)
			}
		}
		if got := len(feeds(t, app)); got != 1 {
			t.Errorf("%d links stored, want the group link, untouched", got)
		}
	})

	t.Run("the group feed of an account that is disabled is a 404, and comes back", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		path := subscribeTo(t, app, fx.Alice, "group", "fr")
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
		alice.Set("disabled", false)
		if err := app.Save(alice); err != nil {
			t.Fatal(err)
		}
		request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
	})

	t.Run("the group feed does not need a runner", func(t *testing.T) {
		app := testutil.NewApp(t)
		save(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
		zoe, err := app.FindAuthRecordByEmail("users", "zoe@example.test")
		if err != nil {
			t.Fatal(err)
		}
		request(t, app, http.MethodGet, subscribeTo(t, app, zoe, "group", "fr"), nil, "", http.StatusOK)
	})
}

// The group link gives the names of the members: on the demo, whose account
// everybody shares, it does not exist (404 on its three routes, and on its feed),
// and the personal link works as ever.
func TestCalendarRoutes_GroupAbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)

	request(t, app, http.MethodGet, calendarURL+"?scope=group", fx.Alice, "", http.StatusNotFound)
	request(t, app, http.MethodPost, calendarURL, fx.Alice, `{"lang":"fr","scope":"group"}`, http.StatusNotFound)
	request(t, app, http.MethodDelete, calendarURL+"?scope=group", fx.Alice, "", http.StatusNotFound)
	if got := len(feeds(t, app)); got != 0 {
		t.Errorf("%d links stored, want none", got)
	}

	// A group link that was there (the database of an instance that became the
	// demo) is not served either.
	token := "a-group-token-made-before"
	save(t, app, "calendar_feeds", map[string]any{
		"user": fx.Alice.Id, "token": token, "token_hash": hashOf(token), "lang": "fr", "scope": "group",
	})
	request(t, app, http.MethodGet, calendarURL+"/"+token+".ics", nil, "", http.StatusNotFound)

	path := subscribe(t, app, fx.Alice, "fr")
	request(t, app, http.MethodGet, path, nil, "", http.StatusOK)
}
