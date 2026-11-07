package calendar_test

import (
	"net/http"
	"strings"
	"testing"

	"courses/server/testutil"
)

// A race known by its month only is a single whole day, the 1st of the month,
// in the feed of a runner: for a participation in a race as for one in the event
// alone, with « (date à préciser) » after its summary. Its opening and its
// deadline have a day of their own and stay ordinary events.
func TestCalendarFeed_MonthPrecision(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	month := func(name string) map[string]any {
		return map[string]any{
			"name": name, "location": "Annecy", "start_date": "2027-06-01", "date_precision": "month",
			"created_by": fx.AliceRunner.Id,
		}
	}
	withRace := save(t, app, "events", month("Trail du Mois"))
	withRace.Set("registration_opening", "2027-06-10")
	withRace.Set("registration_deadline", "2027-06-20")
	if err := app.Save(withRace); err != nil {
		t.Fatal(err)
	}
	if got := withRace.GetString("end_date"); got != "2027-06-30" {
		t.Fatalf("the event ends on %q, want 2027-06-30", got)
	}
	format := save(t, app, "formats", map[string]any{"event": withRace.Id, "race_type": fx.Trail.Id, "distance_km": 21})
	onRace := save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": format.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})

	alone := save(t, app, "events", month("Cross du Mois"))
	save(t, app, "formats", map[string]any{"event": alone.Id, "race_type": fx.Cross.Id, "distance_km": 8})
	onEvent := save(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "event": alone.Id, "status": "supporter", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})

	for _, lang := range []struct{ code, said string }{{"fr", "date à préciser"}, {"en", "date to be set"}} {
		t.Run(lang.code, func(t *testing.T) {
			_, feed := request(t, app, http.MethodGet, subscribe(t, app, fx.Alice, lang.code), nil, "", http.StatusOK)
			byUID := map[string]vevent{}
			for _, event := range parseFeed(t, feed) {
				byUID[event["UID"]] = event
			}

			for name, row := range map[string]struct {
				uid, summary string
			}{
				"a participation in a race":          {uid(onRace), "Trail du Mois · Trail 21 km (" + lang.said + ")"},
				"a participation in the event alone": {uid(onEvent), "Cross du Mois (" + lang.said + ")"},
			} {
				event, ok := byUID[row.uid]
				if !ok {
					t.Errorf("%s: not in the feed", name)
					continue
				}
				if event["DTSTART"] != "20270601" || event["DTEND"] != "20270602" {
					t.Errorf("%s: from %s to %s, want the whole day of the 1st (20270601 to 20270602)", name, event["DTSTART"], event["DTEND"])
				}
				if event["SUMMARY"] != row.summary {
					t.Errorf("%s: SUMMARY %q, want %q", name, event["SUMMARY"], row.summary)
				}
			}

			opening := byUID[openingUID(withRace, fx.AliceRunner)]
			if opening["DTSTART"] != "20270610" || opening["SUMMARY"] == "" {
				t.Errorf("the opening is %v, want an event of the 10th", opening)
			}
			if got := opening["SUMMARY"]; strings.Contains(got, lang.said) {
				t.Errorf("the opening says %q: it has a day, which is not to be set", got)
			}
			deadline := byUID[deadlineUID(withRace, fx.AliceRunner)]
			if deadline["DTSTART"] != "20270620" || strings.Contains(deadline["SUMMARY"], lang.said) {
				t.Errorf("the deadline is %v, want an ordinary event of the 20th", deadline)
			}
		})
	}
}
