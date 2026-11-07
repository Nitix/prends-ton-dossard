package calendar_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// openingSetUp is what TestCalendarFeed_Openings reads: events with an opening,
// and the place of Alice in each.
type openingSetUp struct {
	// timed has Alice registered, an opening in winter at 10:00 (09:00Z) and a
	// registration link; summer has Alice interested, in summer (10:00 is 08:00Z).
	timed, summer *core.Record
	// day has an opening without a time; two has two races, one opening.
	day, two *core.Record
	// supporter and dns are events with an opening that Alice has no reminder for.
	supporter, dns *core.Record
}

// setUpOpenings gives Alice the choice of reminders, and the events.
func setUpOpenings(t *testing.T, app *tests.TestApp, fx testutil.Fixture, choice ...string) openingSetUp {
	t.Helper()
	var o openingSetUp
	alice, err := app.FindRecordById("users", fx.Alice.Id)
	if err != nil {
		t.Fatal(err)
	}
	alice.Set("reminders", choice)
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}

	event := func(name, opening, hhmm string, extra map[string]any) *core.Record {
		values := map[string]any{
			"name": name, "location": "Annecy", "start_date": "2027-03-01", "created_by": fx.AliceRunner.Id,
			"registration_opening": opening, "registration_opening_time": hhmm,
		}
		for k, v := range extra {
			values[k] = v
		}
		return save(t, app, "events", values)
	}
	take := func(event *core.Record, status string) {
		t.Helper()
		format := save(t, app, "formats", map[string]any{"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 10})
		save(t, app, "participations", map[string]any{
			"runner": fx.AliceRunner.Id, "format": format.Id, "status": status, "confirmed": true, "added_by": fx.AliceRunner.Id,
		})
	}

	o.timed = event("Trail d'Hiver", "2027-01-12", "10:00", map[string]any{"registration_url": "https://ex.test/inscription"})
	take(o.timed, "registered")
	o.summer = event("Trail d'Été", "2026-07-01", "10:00", map[string]any{"start_date": "2026-09-01"})
	take(o.summer, "interested")
	o.day = event("Trail du Jour", "2027-02-03", "", nil)
	take(o.day, "interested")
	o.two = event("Trail Double", "2027-01-20", "08:30", nil)
	take(o.two, "interested")
	take(o.two, "registered")
	o.supporter = event("Trail Supporter", "2027-01-21", "10:00", nil)
	save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "event": o.supporter.Id, "status": "supporter", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	o.dns = event("Trail Non Partant", "2027-01-22", "10:00", nil)
	take(o.dns, "dns")
	return o
}

func openingUID(event, runner *core.Record) string {
	return "opening-" + event.Id + "-" + runner.Id + "@prends-ton-dossard"
}

// alarmsOf returns the triggers of the alarms of the event with that UID, in
// the order of the file, with what each one says.
func alarmsOf(t *testing.T, feed, uid string) (triggers, said []string) {
	t.Helper()
	in, alarm := false, false
	for _, line := range unfold(feed) {
		switch {
		case line == "UID:"+uid:
			in = true
		case line == "END:VEVENT":
			in = false
		case in && line == "BEGIN:VALARM":
			alarm = true
		case in && line == "END:VALARM":
			alarm = false
		case in && alarm && strings.HasPrefix(line, "TRIGGER:"):
			triggers = append(triggers, strings.TrimPrefix(line, "TRIGGER:"))
		case in && alarm && strings.HasPrefix(line, "DESCRIPTION:"):
			said = append(said, strings.TrimPrefix(line, "DESCRIPTION:"))
		case in && alarm && line == "ACTION:DISPLAY":
		case in && alarm:
			t.Errorf("an alarm has the line %q", line)
		}
	}
	return triggers, said
}

func TestCalendarFeed_Openings(t *testing.T) {
	readFeed := func(t *testing.T, lang string, choice ...string) (string, openingSetUp, testutil.Fixture) {
		t.Helper()
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		o := setUpOpenings(t, app, fx, choice...)
		_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Alice, lang), nil, "", http.StatusOK)
		return feed, o, fx
	}
	eventsOf := func(t *testing.T, feed string) map[string]vevent {
		t.Helper()
		byUID := map[string]vevent{}
		for _, event := range parseFeed(t, feed) {
			byUID[event["UID"]] = event
		}
		return byUID
	}

	t.Run("an opening with a time is an instant in UTC with its link and its address", func(t *testing.T) {
		feed, o, fx := readFeed(t, "fr", "day", "hour")
		got, ok := eventsOf(t, feed)[openingUID(o.timed, fx.AliceRunner)]
		if !ok {
			t.Fatalf("no opening for the winter event:\n%q", feed)
		}
		eventURL := appURL + "/evenements/" + o.timed.Id
		for name, want := range map[string]string{
			"SUMMARY": "Ouverture des inscriptions · Trail d'Hiver", "DTSTART": "20270112T090000Z", "DTEND": "20270112T093000Z",
			"DESCRIPTION": `https://ex.test/inscription\n` + eventURL, "URL": eventURL,
		} {
			if got[name] != want {
				t.Errorf("%s = %q, want %q", name, got[name], want)
			}
		}
		if strings.Contains(feed, "DTSTART;VALUE=DATE:20270112") {
			t.Errorf("the opening with a time is also a day:\n%q", feed)
		}
	})

	t.Run("summer time is 8:00 UTC, and a registration link is optional", func(t *testing.T) {
		feed, o, fx := readFeed(t, "fr", "day")
		got := eventsOf(t, feed)[openingUID(o.summer, fx.AliceRunner)]
		eventURL := appURL + "/evenements/" + o.summer.Id
		if got["DTSTART"] != "20260701T080000Z" || got["DESCRIPTION"] != eventURL {
			t.Errorf("DTSTART = %q, DESCRIPTION = %q, want 20260701T080000Z and %q", got["DTSTART"], got["DESCRIPTION"], eventURL)
		}
	})

	t.Run("an opening without a time is a whole day", func(t *testing.T) {
		feed, o, fx := readFeed(t, "fr", "day", "hour")
		got := eventsOf(t, feed)[openingUID(o.day, fx.AliceRunner)]
		if got["SUMMARY"] != "Ouverture des inscriptions · Trail du Jour" || got["DTSTART"] != "20270203" || got["DTEND"] != "20270204" {
			t.Errorf("the opening without a time = %v", got)
		}
	})

	t.Run("the alarms follow the choice, with a time and without", func(t *testing.T) {
		for _, tt := range []struct {
			choice          []string
			timed, wholeDay []string
		}{
			{[]string{"day", "hour"}, []string{"-P1D", "-PT1H"}, []string{"-PT15H", "PT8H"}},
			{[]string{"day"}, []string{"-P1D"}, []string{"-PT15H"}},
			{[]string{"hour"}, []string{"-PT1H"}, []string{"PT8H"}},
			{nil, nil, nil},
		} {
			t.Run(strings.Join(tt.choice, "+"), func(t *testing.T) {
				feed, o, fx := readFeed(t, "fr", tt.choice...)
				for name, row := range map[string]struct {
					event *core.Record
					want  []string
				}{"timed": {o.timed, tt.timed}, "whole day": {o.day, tt.wholeDay}} {
					triggers, said := alarmsOf(t, feed, openingUID(row.event, fx.AliceRunner))
					if !slices.Equal(triggers, row.want) {
						t.Errorf("%s: triggers = %q, want %q", name, triggers, row.want)
					}
					for _, line := range said {
						if want := "Ouverture des inscriptions · " + row.event.GetString("name"); line != want {
							t.Errorf("%s: an alarm says %q, want %q", name, line, want)
						}
					}
					if len(said) != len(triggers) {
						t.Errorf("%s: %d triggers and %d descriptions", name, len(triggers), len(said))
					}
				}
			})
		}
	})

	t.Run("interested and registered have it, a supporter and a runner who does not start do not", func(t *testing.T) {
		feed, o, fx := readFeed(t, "fr", "day")
		got := eventsOf(t, feed)
		for name, event := range map[string]*core.Record{"registered": o.timed, "interested": o.summer} {
			if _, ok := got[openingUID(event, fx.AliceRunner)]; !ok {
				t.Errorf("no opening for the %s event", name)
			}
		}
		for name, event := range map[string]*core.Record{"supporter": o.supporter, "dns": o.dns} {
			if _, ok := got[openingUID(event, fx.AliceRunner)]; ok {
				t.Errorf("an opening for the %s event", name)
			}
		}
	})

	t.Run("two races of one event give one opening", func(t *testing.T) {
		feed, o, fx := readFeed(t, "fr", "day")
		if n := strings.Count(feed, "UID:"+openingUID(o.two, fx.AliceRunner)+"\r\n"); n != 1 {
			t.Errorf("%d openings for the event of two races, want 1", n)
		}
	})

	t.Run("a runner who is at none of the events has none", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		setUpOpenings(t, app, fx, "day")
		_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Bob, "fr"), nil, "", http.StatusOK)
		if strings.Contains(feed, "Ouverture des inscriptions") {
			t.Errorf("the feed of Bob has an opening:\n%q", feed)
		}
	})

	t.Run("the UID stays when the opening moves, and the instant follows", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		o := setUpOpenings(t, app, fx, "day")
		path := subscribe(t, app, fx.Alice, "fr")
		_, before := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)

		moved, err := app.FindRecordById("events", o.timed.Id)
		if err != nil {
			t.Fatal(err)
		}
		moved.Set("registration_opening", "2027-01-14")
		moved.Set("registration_opening_time", "11:00")
		if err := app.Save(moved); err != nil {
			t.Fatal(err)
		}
		_, after := request(t, app, http.MethodGet, path, nil, "", http.StatusOK)

		uid := openingUID(o.timed, fx.AliceRunner)
		was, now := eventsOf(t, before)[uid], eventsOf(t, after)[uid]
		if was["DTSTART"] != "20270112T090000Z" || now["DTSTART"] != "20270114T100000Z" {
			t.Errorf("DTSTART was %q and is %q, want 20270112T090000Z then 20270114T100000Z", was["DTSTART"], now["DTSTART"])
		}
	})

	t.Run("a link in English says Registration opens", func(t *testing.T) {
		feed, o, fx := readFeed(t, "en", "day")
		uid := openingUID(o.timed, fx.AliceRunner)
		if got := eventsOf(t, feed)[uid]; got["SUMMARY"] != "Registration opens · Trail d'Hiver" {
			t.Errorf("SUMMARY = %q", got["SUMMARY"])
		}
		triggers, said := alarmsOf(t, feed, uid)
		if !slices.Equal(triggers, []string{"-P1D"}) || len(said) != 1 || said[0] != "Registration opens · Trail d'Hiver" {
			t.Errorf("alarms = %q saying %q", triggers, said)
		}
	})

	t.Run("an opening that is over stays", func(t *testing.T) {
		// The clock of the feed is the real one: July 2026 is behind us.
		feed, o, fx := readFeed(t, "fr", "day")
		if !strings.Contains(feed, "UID:"+openingUID(o.summer, fx.AliceRunner)) {
			t.Error("the opening of the past is not in the feed")
		}
	})

	t.Run("an event with no opening has none", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		setUpAgenda(t, app, fx)
		_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Alice, "fr"), nil, "", http.StatusOK)
		if strings.Contains(feed, "UID:opening-") || strings.Contains(feed, "VALARM") {
			t.Errorf("the feed has an opening or an alarm:\n%q", feed)
		}
	})
}
