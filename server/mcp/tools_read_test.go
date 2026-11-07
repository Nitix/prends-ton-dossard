package mcp_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/mcp"
	"courses/server/testutil"
)

// siteURL is the APP_URL of the test application.
const siteURL = "http://localhost:5173"

// create makes a record directly in the database, as testutil.Seed does.
func create(t testing.TB, app core.App, collection string, values map[string]any) *core.Record {
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

// update changes a record directly in the database.
func update(t testing.TB, app core.App, record *core.Record, values map[string]any) *core.Record {
	t.Helper()
	record, err := app.FindRecordById(record.Collection().Name, record.Id)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range values {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("saving a %s record: %v", record.Collection().Name, err)
	}
	return record
}

// succeeded fails the test when a tool answered an error.
func succeeded(t testing.TB, result toolResult) toolResult {
	t.Helper()
	if result.IsError {
		t.Fatalf("the tool answered the error %q", result.Text)
	}
	return result
}

// textIs checks that the text of a result is the JSON of its structured
// content: the clients that read only the text get the same answer.
func textIs(t *testing.T, result toolResult) {
	t.Helper()
	var text map[string]any
	if err := json.Unmarshal([]byte(result.Text), &text); err != nil {
		t.Fatalf("the text is not the JSON of the answer: %v", err)
	}
	assertJSON(t, text, result.Structured)
}

// runnerRef is the shape of a runner in the answers.
func runnerRef(r *core.Record) map[string]any {
	return map[string]any{"id": r.Id, "name": r.GetString("name")}
}

// at is a moment, as the Paris clock of the tests reads it.
func at(year int, month time.Month, day, hour, minute int) time.Time {
	return time.Date(year, month, day, hour, minute, 0, 0, time.UTC)
}

func TestTools_ListRunners(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	runner := func(r *core.Record, hasAccount, isMe bool) map[string]any {
		return map[string]any{
			"id": r.Id, "name": r.GetString("name"), "has_account": hasAccount, "is_me": isMe,
			"url": siteURL + "/coureurs/" + r.Id,
		}
	}

	t.Run("everybody, by name, and who the caller is", func(t *testing.T) {
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "list_runners", nil))
		assertJSON(t, result.Structured, map[string]any{"runners": []any{
			runner(fx.AdminRunner, true, false),
			runner(fx.AliceRunner, true, true),
			runner(fx.BobRunner, true, false),
			runner(fx.SamRunner, false, false),
		}})
		textIs(t, result)
	})

	t.Run("is_me follows the token", func(t *testing.T) {
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Bob), "list_runners", nil))
		for _, r := range result.Structured["runners"].([]any) {
			r := r.(map[string]any)
			if got, want := r["is_me"], r["id"] == fx.BobRunner.Id; got != want {
				t.Errorf("%v: is_me = %v, want %v", r["name"], got, want)
			}
		}
	})

	t.Run("a query keeps the names that hold it, whatever the case", func(t *testing.T) {
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "list_runners", map[string]any{"query": "AL"}))
		assertJSON(t, result.Structured, map[string]any{"runners": []any{runner(fx.AliceRunner, true, true)}})
	})

	t.Run("and whatever the accents", func(t *testing.T) {
		zoe := create(t, app, "runners", map[string]any{"name": "Zoé"})
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "list_runners", map[string]any{"query": "zoe"}))
		assertJSON(t, result.Structured, map[string]any{"runners": []any{runner(zoe, false, false)}})
	})

	t.Run("a query that nobody holds gives an empty list, not null", func(t *testing.T) {
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "list_runners", map[string]any{"query": "zzz"}))
		assertJSON(t, result.Structured, map[string]any{"runners": []any{}})
	})

	t.Run("the names are sorted without regard to the case or the accents", func(t *testing.T) {
		create(t, app, "runners", map[string]any{"name": "émile"})
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "list_runners", nil))
		var names []string
		for _, r := range result.Structured["runners"].([]any) {
			names = append(names, r.(map[string]any)["name"].(string))
		}
		if want := []string{"Admin", "Alice", "Bob", "émile", "Sam", "Zoé"}; !slices.Equal(names, want) {
			t.Errorf("the runners are %v, want %v", names, want)
		}
	})
}

func TestTools_ListRaceTypes(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := newToken(t, app, fx.Alice)

	read := func(t *testing.T) []map[string]any {
		t.Helper()
		result := succeeded(t, callTool(t, app, token, "list_race_types", nil))
		textIs(t, result)
		var types []map[string]any
		for _, raceType := range result.Structured["race_types"].([]any) {
			types = append(types, raceType.(map[string]any))
		}
		return types
	}
	labels := func(types []map[string]any) []string {
		var out []string
		for _, raceType := range types {
			out = append(out, raceType["label"].(string))
		}
		return out
	}

	t.Run("the six types of the site, by name, with their measures", func(t *testing.T) {
		types := read(t)
		if want := []string{"Backyard", "Cross", "Hyrox", "Route", "Trail", "Ultra-trail"}; !slices.Equal(labels(types), want) {
			t.Fatalf("the types are %v, want %v", labels(types), want)
		}
		byLabel := map[string]map[string]any{}
		for _, raceType := range types {
			byLabel[raceType["label"].(string)] = raceType
		}
		assertJSON(t, byLabel["Trail"], map[string]any{
			"id": fx.Trail.Id, "label": "Trail", "measures": []any{"distance", "elevation", "time_limit"},
		})
		assertJSON(t, byLabel["Backyard"]["measures"], []any{"time_limit"})
		assertJSON(t, byLabel["Hyrox"]["measures"], []any{"distance"})
	})

	t.Run("a type that says nothing has the four measures", func(t *testing.T) {
		create(t, app, "race_types", map[string]any{"label": "Marche nordique"})
		for _, raceType := range read(t) {
			if raceType["label"] == "Marche nordique" {
				assertJSON(t, raceType["measures"], []any{"distance", "elevation", "duration", "time_limit"})
				return
			}
		}
		t.Error("the new type is not in the list")
	})

	t.Run("the measures come in the order of the form", func(t *testing.T) {
		create(t, app, "race_types", map[string]any{"label": "Randonnée", "measures": []string{"time_limit", "distance"}})
		for _, raceType := range read(t) {
			if raceType["label"] == "Randonnée" {
				assertJSON(t, raceType["measures"], []any{"distance", "time_limit"})
				return
			}
		}
		t.Error("the new type is not in the list")
	})

	t.Run("the types are sorted without regard to the case or the accents", func(t *testing.T) {
		create(t, app, "race_types", map[string]any{"label": "écoute"})
		got := labels(read(t))
		if i, j := slices.Index(got, "Cross"), slices.Index(got, "écoute"); i < 0 || j < 0 || i > j {
			t.Errorf("the types are %v: Cross comes before écoute", got)
		}
		if i, j := slices.Index(got, "écoute"), slices.Index(got, "Hyrox"); i > j {
			t.Errorf("the types are %v: écoute comes before Hyrox", got)
		}
	})
}

// ids are the ids of the events of the answer of search_events, in order.
func ids(t testing.TB, result toolResult) []string {
	t.Helper()
	succeeded(t, result)
	out := []string{}
	for _, event := range result.Structured["events"].([]any) {
		out = append(out, event.(map[string]any)["id"].(string))
	}
	return out
}

func TestTools_SearchEvents(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)

	// The 14th at noon in Paris: the last day of Event, which is not over.
	june14 := at(2026, 6, 14, 10, 0)
	// Half past midnight on the 15th in Paris, still the 14th in UTC.
	june15 := at(2026, 6, 14, 22, 30)

	search := func(token string, args map[string]any) toolResult {
		t.Helper()
		return callTool(t, app, token, "search_events", args)
	}

	for _, row := range []struct {
		name string
		now  time.Time
		args map[string]any
		want func() []string
	}{
		{"upcoming is the default, and a race that ends today is not over", june14, nil,
			func() []string { return []string{fx.Event.Id, fx.Event2.Id} }},
		{"upcoming, said", june14, map[string]any{"period": "upcoming"},
			func() []string { return []string{fx.Event.Id, fx.Event2.Id} }},
		{"the day is the one in Paris: after the last day, Event is past", june15, nil,
			func() []string { return []string{fx.Event2.Id} }},
		{"past", june15, map[string]any{"period": "past"},
			func() []string { return []string{fx.Event.Id} }},
		{"nothing is past yet", june14, map[string]any{"period": "past"},
			func() []string { return nil }},
		{"a text finds the name, without the accents or the case", june14, map[string]any{"query": "CRETES"},
			func() []string { return []string{fx.Event.Id} }},
		{"a text finds the place", june14, map[string]any{"query": "lyon"},
			func() []string { return []string{fx.Event2.Id} }},
		{"the words of a text are in the name or the place", june14, map[string]any{"query": "annecy trail"},
			func() []string { return []string{fx.Event.Id} }},
		{"a word that is nowhere", june14, map[string]any{"query": "trail lyon"},
			func() []string { return nil }},
		{"a runner by name", june14, map[string]any{"runner": "Sam"},
			func() []string { return []string{fx.Event.Id} }},
		{"a runner by id", june14, map[string]any{"runner": fx.BobRunner.Id},
			func() []string { return []string{fx.Event.Id} }},
		{"a runner who is on no race", june14, map[string]any{"runner": "Admin"},
			func() []string { return nil }},
		{"a race type by name", june14, map[string]any{"race_type": "Route"},
			func() []string { return []string{fx.Event2.Id} }},
		{"a race type by name, in another case", june14, map[string]any{"race_type": "trail"},
			func() []string { return []string{fx.Event.Id} }},
		{"a race type by id", june14, map[string]any{"race_type": fx.Road.Id},
			func() []string { return []string{fx.Event2.Id} }},
		{"a race type that no race has", june14, map[string]any{"race_type": "Hyrox"},
			func() []string { return nil }},
		{"all the criteria", june14, map[string]any{"query": "crêtes", "runner": "Alice", "race_type": "Trail"},
			func() []string { return []string{fx.Event.Id} }},
		{"all the criteria, one of which is not met", june14, map[string]any{"query": "crêtes", "runner": "Alice", "race_type": "Route"},
			func() []string { return nil }},
		{"a range holds the races that have a day in it, the bounds included", june14, map[string]any{"from": "2026-06-14", "to": "2026-06-14"},
			func() []string { return []string{fx.Event.Id} }},
		{"a range around both", june14, map[string]any{"from": "2026-06-14", "to": "2026-06-22"},
			func() []string { return []string{fx.Event.Id, fx.Event2.Id} }},
		{"a race that starts on the last day of the range", june14, map[string]any{"from": "2026-06-20", "to": "2026-06-22"},
			func() []string { return []string{fx.Event2.Id} }},
		{"a range between the two", june14, map[string]any{"from": "2026-06-15", "to": "2026-06-21"},
			func() []string { return nil }},
		{"a range ignores the period", june15, map[string]any{"period": "past", "from": "2026-06-20", "to": "2026-06-30"},
			func() []string { return []string{fx.Event2.Id} }},
		{"a range with only its end", june14, map[string]any{"to": "2026-06-13"},
			func() []string { return []string{fx.Event.Id} }},
		{"a range with only its start", june14, map[string]any{"from": "2026-06-15"},
			func() []string { return []string{fx.Event2.Id} }},
		{"a range that is also searched", june14, map[string]any{"from": "2026-06-01", "to": "2026-06-30", "query": "lyon"},
			func() []string { return []string{fx.Event2.Id} }},
		{"a limit", june14, map[string]any{"limit": 1},
			func() []string { return []string{fx.Event.Id} }},
	} {
		t.Run(row.name, func(t *testing.T) {
			mcp.SetNow(t, row.now)
			got := ids(t, search(alice, row.args))
			if want := row.want(); !slices.Equal(got, want) {
				t.Errorf("the races are %v, want %v", got, want)
			}
		})
	}

	t.Run("the count, and whether the list was cut", func(t *testing.T) {
		mcp.SetNow(t, june14)

		all := succeeded(t, search(alice, nil))
		if all.Structured["count"] != float64(2) || all.Structured["truncated"] != false {
			t.Errorf("count %v, truncated %v, want 2 and false", all.Structured["count"], all.Structured["truncated"])
		}
		textIs(t, all)

		one := succeeded(t, search(alice, map[string]any{"limit": 1}))
		if one.Structured["count"] != float64(1) || one.Structured["truncated"] != true {
			t.Errorf("count %v, truncated %v, want 1 and true", one.Structured["count"], one.Structured["truncated"])
		}

		exact := succeeded(t, search(alice, map[string]any{"limit": 2}))
		if exact.Structured["count"] != float64(2) || exact.Structured["truncated"] != false {
			t.Errorf("count %v, truncated %v, want 2 and false: nothing is left out", exact.Structured["count"], exact.Structured["truncated"])
		}

		none := succeeded(t, search(alice, map[string]any{"query": "zzz"}))
		assertJSON(t, none.Structured, map[string]any{"events": []any{}, "count": 0, "truncated": false})
	})

	t.Run("a summary of a race, as the site's list shows it", func(t *testing.T) {
		mcp.SetNow(t, june14)
		result := succeeded(t, search(alice, nil))
		events := result.Structured["events"].([]any)

		assertJSON(t, events[0], map[string]any{
			"id": fx.Event.Id, "name": "Trail des Crêtes", "location": "Annecy",
			"start_date": "2026-06-13", "end_date": "2026-06-14",
			"url": siteURL + "/evenements/" + fx.Event.Id,
			// The races go by day, then distance: the 15 km is on the first day, the
			// day that the race has no date of its own.
			"formats": []any{
				map[string]any{"id": fx.F15.Id, "title": "Trail 15 km", "race_type": "Trail", "date": "2026-06-13"},
				map[string]any{"id": fx.F42.Id, "title": "Trail 42 km", "race_type": "Trail", "date": "2026-06-14"},
			},
			"participants": 3,
			"mine": []any{map[string]any{
				"participation_id": fx.P1.Id, "format_id": fx.F42.Id, "status": "registered", "status_label": "Inscrit",
			}},
		})
		// A race that is on a single day, that nobody is on, with no deadline.
		assertJSON(t, events[1], map[string]any{
			"id": fx.Event2.Id, "name": "10 km de Lyon", "location": "Lyon", "start_date": "2026-06-22",
			"url": siteURL + "/evenements/" + fx.Event2.Id,
			"formats": []any{
				map[string]any{"id": fx.FLyon.Id, "title": "Route 10 km", "race_type": "Route", "date": "2026-06-22"},
			},
			"participants": 0,
			"mine":         []any{},
		})
	})

	t.Run("the deadline is said when there is one", func(t *testing.T) {
		mcp.SetNow(t, june14)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		update(t, app, fx.Event2, map[string]any{"registration_deadline": "2026-06-01"})

		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "search_events", nil))
		event := result.Structured["events"].([]any)[1].(map[string]any)
		if event["registration_deadline"] != "2026-06-01" {
			t.Errorf("registration_deadline = %v", event["registration_deadline"])
		}
	})

	t.Run("mine is the participations of the owner of the token", func(t *testing.T) {
		mcp.SetNow(t, june14)

		// Bob's is not Alice's, though they are on the same race.
		result := succeeded(t, search(newToken(t, app, fx.Bob), nil))
		assertJSON(t, result.Structured["events"].([]any)[0].(map[string]any)["mine"], []any{map[string]any{
			"participation_id": fx.P2.Id, "format_id": fx.F42.Id, "status": "interested", "status_label": "Intéressé",
		}})

		// The admin is on no race.
		result = succeeded(t, search(newToken(t, app, fx.Admin), nil))
		for _, event := range result.Structured["events"].([]any) {
			assertJSON(t, event.(map[string]any)["mine"], []any{})
		}
	})

	t.Run("a race that somebody does not start is not theirs, but stays in mine", func(t *testing.T) {
		mcp.SetNow(t, june14)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		update(t, app, fx.P2, map[string]any{"status": "dns"})

		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Bob), "search_events", nil))
		event := result.Structured["events"].([]any)[0].(map[string]any)
		// Bob is not counted among the participants: Alice and Sam are.
		if event["participants"] != float64(2) {
			t.Errorf("participants = %v, want 2: a participation that does not start is not counted", event["participants"])
		}
		assertJSON(t, event["mine"], []any{map[string]any{
			"participation_id": fx.P2.Id, "format_id": fx.F42.Id, "status": "dns", "status_label": "Non partant",
		}})
		// And the filter of a runner does not find Bob on this race.
		got := ids(t, callTool(t, app, newToken(t, app, fx.Bob), "search_events", map[string]any{"runner": "Bob"}))
		if len(got) != 0 {
			t.Errorf("the races of Bob are %v, want none: he does not start", got)
		}
	})

	t.Run("a runner whose only participation does not start is on no race", func(t *testing.T) {
		mcp.SetNow(t, june14)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		token := newToken(t, app, fx.Alice)

		if got := ids(t, callTool(t, app, token, "search_events", map[string]any{"runner": "Sam"})); !slices.Equal(got, []string{fx.Event.Id}) {
			t.Fatalf("before: the races of Sam are %v", got)
		}
		update(t, app, fx.P3, map[string]any{"status": "dns"})

		result := succeeded(t, callTool(t, app, token, "search_events", map[string]any{"runner": "Sam"}))
		assertJSON(t, result.Structured, map[string]any{"events": []any{}, "count": 0, "truncated": false})
	})

	t.Run("a supporter is on the race, and counted, with no format in mine", func(t *testing.T) {
		mcp.SetNow(t, june14)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		supporter := create(t, app, "participations", map[string]any{
			"runner": fx.AdminRunner.Id, "event": fx.Event2.Id, "status": "supporter",
			"confirmed": true, "added_by": fx.AdminRunner.Id,
		})

		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Admin), "search_events", map[string]any{"runner": "Admin"}))
		events := result.Structured["events"].([]any)
		if len(events) != 1 {
			t.Fatalf("the races of the supporter are %v", events)
		}
		event := events[0].(map[string]any)
		if event["id"] != fx.Event2.Id || event["participants"] != float64(1) {
			t.Errorf("event %v with %v participants, want Event2 with 1", event["id"], event["participants"])
		}
		assertJSON(t, event["mine"], []any{map[string]any{
			"participation_id": supporter.Id, "status": "supporter", "status_label": "Supporteur",
		}})
	})

	t.Run("a past race sorts the most recent first, then by name, as the site's list does", func(t *testing.T) {
		mcp.SetNow(t, june15)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		zebra := create(t, app, "events", map[string]any{"name": "Zèbre", "location": "Aix", "start_date": "2026-05-02", "created_by": fx.AliceRunner.Id})
		abeille := create(t, app, "events", map[string]any{"name": "Abeille", "location": "Aix", "start_date": "2026-05-02", "created_by": fx.AliceRunner.Id})
		old := create(t, app, "events", map[string]any{"name": "Ancienne", "location": "Aix", "start_date": "2026-03-01", "created_by": fx.AliceRunner.Id})

		got := ids(t, callTool(t, app, newToken(t, app, fx.Alice), "search_events", map[string]any{"period": "past"}))
		if want := []string{fx.Event.Id, abeille.Id, zebra.Id, old.Id}; !slices.Equal(got, want) {
			t.Errorf("the races are %v, want %v", got, want)
		}
		// A race with no format is still a race.
		result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "search_events", map[string]any{"period": "past", "limit": 4}))
		assertJSON(t, result.Structured["events"].([]any)[1].(map[string]any)["formats"], []any{})
	})

	t.Run("the errors", func(t *testing.T) {
		mcp.SetNow(t, june14)
		for _, row := range []struct {
			name string
			args map[string]any
			want string
		}{
			{"an unknown runner", map[string]any{"runner": "Zoé"},
				"Coureur inconnu : « Zoé ». Les coureurs du groupe : Admin, Alice, Bob, Sam."},
			{"an unknown race type", map[string]any{"race_type": "Marche"},
				"Type de course inconnu : « Marche ». Les types de course : Backyard, Cross, Hyrox, Route, Trail, Ultra-trail."},
			{"a day that is not one", map[string]any{"from": "2026-02-30"},
				"from : « 2026-02-30 » n'est pas un jour valide (AAAA-MM-JJ)."},
			{"a day that is a word", map[string]any{"to": "demain"},
				"to : « demain » n'est pas un jour valide (AAAA-MM-JJ)."},
			{"a range that ends before it starts", map[string]any{"from": "2026-06-20", "to": "2026-06-10"},
				"from : « 2026-06-20 » est après to : « 2026-06-10 »."},
		} {
			t.Run(row.name, func(t *testing.T) {
				result := search(alice, row.args)
				if !result.IsError || result.Text != row.want {
					t.Errorf("isError %v, text %q, want the error %q", result.IsError, result.Text, row.want)
				}
			})
		}

		// The schema is the SDK's to enforce, before the tool.
		for _, row := range []struct {
			name string
			args map[string]any
		}{
			{"a limit of 0", map[string]any{"limit": 0}},
			{"a limit over 50", map[string]any{"limit": 51}},
			{"a period that is not one", map[string]any{"period": "soon"}},
			{"an argument that is not one", map[string]any{"person": "Sam"}},
		} {
			t.Run(row.name, func(t *testing.T) {
				if result := search(alice, row.args); !result.IsError {
					t.Errorf("accepted: %.200s", result.Text)
				}
			})
		}
	})

	t.Run("a limit of 50 is accepted", func(t *testing.T) {
		mcp.SetNow(t, june14)
		succeeded(t, search(alice, map[string]any{"limit": 50}))
	})

	t.Run("a search only reads", func(t *testing.T) {
		mcp.SetNow(t, june14)
		counted := mcp.CountInnerRequests(t)
		succeeded(t, search(alice, map[string]any{"runner": "Bob", "race_type": "Trail"}))
		if counted.Total() == 0 {
			t.Error("no request was made")
		}
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
			if n := counted.Of(method); n != 0 {
				t.Errorf("%d %s requests", n, method)
			}
		}
	})
}

// The list is read by pages of 200: a race that is on the second is found.
func TestTools_SearchEvents_ReadsEveryPage(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))

	first := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	var last *core.Record
	for i := 1; i <= 205; i++ {
		name := fmt.Sprintf("Course %03d", i)
		if i == 205 {
			name = "Course finale"
		}
		last = create(t, app, "events", map[string]any{
			"name": name, "location": "Quelque part",
			"start_date": first.AddDate(0, 0, i).Format(time.DateOnly), "created_by": fx.AliceRunner.Id,
		})
	}
	token := newToken(t, app, fx.Alice)

	// The two races of the fixture come first, then these, by day: the last of
	// the first page is "Course 198", the first of the second "Course 199".
	if got := ids(t, callTool(t, app, token, "search_events", map[string]any{"query": "finale"})); !slices.Equal(got, []string{last.Id}) {
		t.Errorf("the last race is %v, want %v: the second page is not read", got, []string{last.Id})
	}
	for _, query := range []string{"Course 198", "Course 199", "Course 200", "Course 201"} {
		if got := ids(t, callTool(t, app, token, "search_events", map[string]any{"query": query})); len(got) != 1 {
			t.Errorf("%q: the races are %v, want one", query, got)
		}
	}

	// Every race once, in order: 207 of them, 50 of which are given.
	result := succeeded(t, callTool(t, app, token, "search_events", map[string]any{"limit": 50}))
	if result.Structured["truncated"] != true || result.Structured["count"] != float64(50) {
		t.Errorf("count %v, truncated %v", result.Structured["count"], result.Structured["truncated"])
	}
}

// Every read stops at its bound (5000 records in the real one), and says that
// trying again is no use: not the « Réessaie dans un instant » of a fault that
// passes.
func TestTools_Reads_StopAtTheBound(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 20, 10, 0))
	// Four runners and more race types than three, and four results this year.
	for _, p := range []*core.Record{fx.P1, fx.P2, fx.P3} {
		update(t, app, p, map[string]any{"status": "finished"})
	}
	joined(t, app, fx.AdminRunner, fx.F15, "dnf", true, fx.AdminRunner)
	mcp.SetMaxRecords(t, 3)
	alice := newToken(t, app, fx.Alice)

	const want = "Il y a trop d'enregistrements pour les lire d'un coup (plus de 3) : réessayer n'y changera rien. " +
		"Précise la demande si l'outil le permet (une autre année pour get_stats), sinon c'est une limite du serveur MCP."
	for _, tool := range []string{"list_runners", "list_race_types", "home", "get_runner", "get_stats"} {
		t.Run(tool, func(t *testing.T) {
			result := callTool(t, app, alice, tool, nil)
			if !result.IsError || result.Text != want {
				t.Errorf("%s answered isError %v, %q, want %q", tool, result.IsError, result.Text, want)
			}
			if strings.Contains(result.Text, "Réessaie") {
				t.Errorf("%s tells to try again: %q", tool, result.Text)
			}
		})
	}
}

// A search reads at most so many races of a period: past that, it asks for a
// narrower one, instead of reading a table that grows with the years.
func TestTools_SearchEvents_ReadsAtMost(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))
	mcp.SetMaxEventsRead(t, 150)

	first := time.Date(2027, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 1; i <= 205; i++ {
		create(t, app, "events", map[string]any{
			"name": fmt.Sprintf("Course %03d", i), "location": "Quelque part",
			"start_date": first.AddDate(0, 0, i).Format(time.DateOnly), "created_by": fx.AliceRunner.Id,
		})
	}
	token := newToken(t, app, fx.Alice)

	result := callTool(t, app, token, "search_events", nil)
	want := "Il y a trop de courses dans cette période pour les lire d'un coup (plus de 150) : resserre la recherche avec from et to."
	if !result.IsError || result.Text != want {
		t.Errorf("isError %v, text %q, want %q", result.IsError, result.Text, want)
	}

	// A narrower period reads what it holds.
	got := ids(t, callTool(t, app, token, "search_events", map[string]any{"from": "2027-01-01", "to": "2027-01-10"}))
	if len(got) != 9 {
		t.Errorf("%d races in the first days of 2027, want 9", len(got))
	}
}

// The text of a search is 200 characters at most: a few words of a name or a
// place. Each word is looked for in each race that the search reads, and a body
// of a megabyte held half a million of them.
func TestTools_SearchEvents_ATextOf200CharactersAtMost(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 1, 10, 0))
	token := newToken(t, app, fx.Alice)

	// 200 characters (393 bytes), and blanks around, are a search.
	words := "  " + strings.Repeat("é", 193) + " Crêtes  "
	if got := ids(t, succeeded(t, callTool(t, app, token, "search_events", map[string]any{"query": words}))); len(got) != 0 {
		t.Errorf("a search of 200 characters found %v, want none", got)
	}
	got := ids(t, succeeded(t, callTool(t, app, token, "search_events", map[string]any{"query": strings.Repeat(" ", 300) + "crêtes"})))
	if len(got) != 1 || got[0] != fx.Event.Id {
		t.Errorf("a search with blanks around found %v, want the Trail des Crêtes", got)
	}

	for _, query := range []string{strings.Repeat("a ", 100) + "b", strings.Repeat("a ", 500_000)} {
		result := callTool(t, app, token, "search_events", map[string]any{"query": query})
		want := fmt.Sprintf("query : 200 caractères au plus (celle-ci en a %d) ; cherche avec quelques mots du nom ou du lieu.", len(strings.TrimSpace(query)))
		if !result.IsError || result.Text != want {
			t.Errorf("a search of %d characters: isError %v, %.200q; want %q", len(query), result.IsError, result.Text, want)
		}
	}
}

// The way the site tells that a comment was changed: more than a second after
// it was written (isEdited of features/comments/api.ts), the cases of its tests.
func TestIsEdited(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := newToken(t, app, fx.Alice)

	for _, row := range []struct {
		name            string
		created, edited string
		want            bool
	}{
		{"a millisecond apart is the creation", "2026-11-01 04:30:22.123Z", "2026-11-01 04:30:22.124Z", false},
		{"the same instant", "2026-11-01 04:30:22.123Z", "2026-11-01 04:30:22.123Z", false},
		{"a millisecond apart, across the second", "2026-11-01 04:30:22.999Z", "2026-11-01 04:30:23.000Z", false},
		{"exactly a second is not more", "2026-11-01 04:30:22.000Z", "2026-11-01 04:30:23.000Z", false},
		{"a millisecond more than a second is", "2026-11-01 04:30:22.000Z", "2026-11-01 04:30:23.001Z", true},
		{"two seconds", "2026-11-01 04:30:22.000Z", "2026-11-01 04:30:24.000Z", true},
		{"two minutes", "2026-11-01 04:30:22.123Z", "2026-11-01 04:32:22.123Z", true},
	} {
		comment := create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.AliceRunner.Id, "body": row.name})
		putDates(t, app, comment.Id, row.created, row.edited)

		got := commentsOf(t, callTool(t, app, token, "get_event", map[string]any{"event_id": fx.Event.Id}))
		var found bool
		for _, c := range got {
			if c["id"] == comment.Id {
				found = true
				if c["edited"] != row.want {
					t.Errorf("%s: edited = %v, want %v", row.name, c["edited"], row.want)
				}
			}
		}
		if !found {
			t.Errorf("%s: the comment is not in the answer", row.name)
		}
	}
}

// putDates sets the two dates of a comment in the database: the model sets them
// itself on every save.
func putDates(t testing.TB, app core.App, id, created, updated string) {
	t.Helper()
	_, err := app.DB().NewQuery("UPDATE comments SET created = {:created}, updated = {:updated} WHERE id = {:id}").
		Bind(dbx.Params{"created": created, "updated": updated, "id": id}).Execute()
	if err != nil {
		t.Fatal(err)
	}
}

// commentsOf are the comments of the answer of get_event.
func commentsOf(t testing.TB, result toolResult) []map[string]any {
	t.Helper()
	succeeded(t, result)
	var out []map[string]any
	for _, c := range result.Structured["comments"].([]any) {
		out = append(out, c.(map[string]any))
	}
	return out
}

func TestTools_GetEvent(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)

	get := func(args map[string]any) toolResult {
		t.Helper()
		return callTool(t, app, alice, "get_event", args)
	}
	participation := func(id string, runner *core.Record, status, label string, confirmed bool, addedBy *core.Record) map[string]any {
		return map[string]any{
			"id": id, "runner": runnerRef(runner), "status": status, "status_label": label,
			"confirmed": confirmed, "added_by": runnerRef(addedBy),
		}
	}

	// The race gets what the site shows besides its races: a deadline, a link,
	// notes; its 42 km a price, a time limit, a route and a track.
	update(t, app, fx.Event, map[string]any{
		"registration_url": "https://inscriptions.example.test/cretes", "registration_deadline": "2026-05-31",
		"notes": "Navette depuis la gare.",
	})
	file, err := filesystem.NewFileFromBytes(testutil.GPX(t, 20), "trace.gpx")
	if err != nil {
		t.Fatal(err)
	}
	update(t, app, fx.F42, map[string]any{
		"time_limit_min": 600, "price_eur": 65, "route_url": "https://www.strava.com/routes/1", "gpx": file,
	})
	stored, err := app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatal(err)
	}
	track := stored.GetString("gpx")
	if track == "" {
		t.Fatal("the track was not saved")
	}

	// What is read comes sorted: the people by name, without regard to the case or
	// the accents, whatever the order they were saved in. Eric is saved before
	// Émile, who comes first, and Anaïs before Admin.
	person := func(name string) *core.Record { return create(t, app, "runners", map[string]any{"name": name}) }
	onF42 := func(runner *core.Record) *core.Record {
		return create(t, app, "participations", map[string]any{
			"runner": runner.Id, "format": fx.F42.Id, "status": "interested", "confirmed": false, "added_by": fx.AliceRunner.Id,
		})
	}
	eric, emile := person("Eric"), person("Émile")
	pEric, pEmile := onF42(eric), onF42(emile)

	// Two on the race alone, and a supporter.
	anais, zoe := person("Anaïs"), person("Zoé")
	undecidedAnais := create(t, app, "participations", map[string]any{
		"runner": anais.Id, "event": fx.Event.Id, "status": "interested", "confirmed": false, "added_by": fx.AliceRunner.Id,
	})
	undecided := create(t, app, "participations", map[string]any{
		"runner": fx.AdminRunner.Id, "event": fx.Event.Id, "status": "interested",
		"confirmed": true, "added_by": fx.AdminRunner.Id,
	})
	supporter := create(t, app, "participations", map[string]any{
		"runner": zoe.Id, "event": fx.Event.Id, "status": "supporter",
		"confirmed": false, "added_by": fx.AliceRunner.Id,
	})

	// Three comments, one of which was changed, two rides, one with two
	// passengers, a lodging. The comments are saved in an order that is neither the
	// one of their dates nor its opposite: they come by their date.
	changed := create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.BobRunner.Id, "body": "Moi aussi, je suis partant."})
	putDates(t, app, changed.Id, "2026-06-01 10:00:00.000Z", "2026-06-01 10:00:02.000Z")
	late := create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.AdminRunner.Id, "body": "Rendez-vous à la gare."})
	putDates(t, app, late.Id, "2026-06-01 11:00:00.000Z", "2026-06-01 11:00:00.000Z")
	hello := create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.AliceRunner.Id, "body": "Je prends le train."})
	putDates(t, app, hello.Id, "2026-06-01 09:00:00.000Z", "2026-06-01 09:00:00.001Z")

	ride := create(t, app, "offers", map[string]any{
		"event": fx.Event.Id, "kind": "ride", "owner": fx.AliceRunner.Id, "place": "Lyon, Part-Dieu",
		"seats": 3, "date": "2026-06-13", "time": "06:30",
	})
	aline := person("Aline")
	seat := create(t, app, "offer_members", map[string]any{"offer": ride.Id, "runner": fx.BobRunner.Id, "added_by": fx.AliceRunner.Id})
	alineSeat := create(t, app, "offer_members", map[string]any{"offer": ride.Id, "runner": aline.Id, "added_by": fx.AliceRunner.Id})
	// A ride that was offered before, though it is saved after.
	earlier := create(t, app, "offers", map[string]any{
		"event": fx.Event.Id, "kind": "ride", "owner": fx.AdminRunner.Id, "place": "Paris, Gare de Lyon", "seats": 2,
	})
	if _, err := app.DB().NewQuery("UPDATE offers SET created = '2026-06-01 08:00:00.000Z' WHERE id = {:id}").
		Bind(dbx.Params{"id": earlier.Id}).Execute(); err != nil {
		t.Fatal(err)
	}
	lodging := create(t, app, "offers", map[string]any{
		"event": fx.Event.Id, "kind": "lodging", "owner": fx.BobRunner.Id, "place": "Gîte des Aravis",
		"date": "2026-06-12", "end_date": "2026-06-14", "url": "https://gite.example.test", "notes": "Draps fournis.",
	})

	want := map[string]any{
		"id": fx.Event.Id, "name": "Trail des Crêtes", "location": "Annecy",
		"start_date": "2026-06-13", "end_date": "2026-06-14",
		"registration_url": "https://inscriptions.example.test/cretes", "registration_deadline": "2026-05-31",
		"notes":      "Navette depuis la gare.",
		"created_by": runnerRef(fx.AliceRunner),
		"url":        siteURL + "/evenements/" + fx.Event.Id,
		"formats": []any{
			map[string]any{
				"id": fx.F15.Id, "title": "Trail 15 km",
				"race_type":   map[string]any{"id": fx.Trail.Id, "label": "Trail"},
				"distance_km": 15, "elevation_gain_m": 700,
				// The race has no date of its own: its day is the first of the event.
				"day": "2026-06-13",
				"participants": []any{
					participation(fx.P3.Id, fx.SamRunner, "interested", "Intéressé", false, fx.AliceRunner),
				},
			},
			map[string]any{
				"id": fx.F42.Id, "title": "Trail 42 km",
				"race_type":   map[string]any{"id": fx.Trail.Id, "label": "Trail"},
				"distance_km": 42, "elevation_gain_m": 2400, "time_limit_min": 600, "price_eur": 65,
				"date": "2026-06-14", "day": "2026-06-14",
				"route_url": "https://www.strava.com/routes/1",
				"track_url": siteURL + "/api/files/formats/" + fx.F42.Id + "/" + track,
				"participants": []any{
					participation(fx.P1.Id, fx.AliceRunner, "registered", "Inscrit", true, fx.AliceRunner),
					participation(fx.P2.Id, fx.BobRunner, "interested", "Intéressé", false, fx.AliceRunner),
					participation(pEmile.Id, emile, "interested", "Intéressé", false, fx.AliceRunner),
					participation(pEric.Id, eric, "interested", "Intéressé", false, fx.AliceRunner),
				},
			},
		},
		"undecided": []any{
			participation(undecided.Id, fx.AdminRunner, "interested", "Intéressé", true, fx.AdminRunner),
			participation(undecidedAnais.Id, anais, "interested", "Intéressé", false, fx.AliceRunner),
		},
		"supporters": []any{
			participation(supporter.Id, zoe, "supporter", "Supporteur", false, fx.AliceRunner),
		},
		"rides": []any{
			map[string]any{
				"id": earlier.Id, "kind": "ride", "owner": runnerRef(fx.AdminRunner), "place": "Paris, Gare de Lyon",
				"seats": 2, "taken": 0, "members": []any{},
			},
			map[string]any{
				"id": ride.Id, "kind": "ride", "owner": runnerRef(fx.AliceRunner), "place": "Lyon, Part-Dieu",
				"seats": 3, "taken": 2, "date": "2026-06-13", "time": "06:30",
				"members": []any{
					map[string]any{"place_id": alineSeat.Id, "runner": runnerRef(aline), "added_by": runnerRef(fx.AliceRunner)},
					map[string]any{"place_id": seat.Id, "runner": runnerRef(fx.BobRunner), "added_by": runnerRef(fx.AliceRunner)},
				},
			},
		},
		"lodgings": []any{map[string]any{
			"id": lodging.Id, "kind": "lodging", "owner": runnerRef(fx.BobRunner), "place": "Gîte des Aravis",
			"taken": 0, "date": "2026-06-12", "end_date": "2026-06-14", "url": "https://gite.example.test",
			"notes": "Draps fournis.", "members": []any{},
		}},
		"comments": []any{
			map[string]any{"id": hello.Id, "author": runnerRef(fx.AliceRunner), "body": "Je prends le train.", "created": "2026-06-01 09:00:00.000Z", "edited": false},
			map[string]any{"id": changed.Id, "author": runnerRef(fx.BobRunner), "body": "Moi aussi, je suis partant.", "created": "2026-06-01 10:00:00.000Z", "edited": true},
			map[string]any{"id": late.Id, "author": runnerRef(fx.AdminRunner), "body": "Rendez-vous à la gare.", "created": "2026-06-01 11:00:00.000Z", "edited": false},
		},
		"comments_total": 3,
	}

	t.Run("the whole page of a race", func(t *testing.T) {
		result := succeeded(t, get(map[string]any{"event_id": fx.Event.Id}))
		assertJSON(t, result.Structured, want)
		textIs(t, result)
	})

	t.Run("the titles, the day, the link and the creator", func(t *testing.T) {
		result := succeeded(t, get(map[string]any{"event_id": fx.Event.Id}))
		formats := result.Structured["formats"].([]any)
		if got := formats[0].(map[string]any)["title"]; got != "Trail 15 km" {
			t.Errorf("title = %v", got)
		}
		if got := formats[1].(map[string]any)["title"]; got != "Trail 42 km" {
			t.Errorf("title = %v", got)
		}
		if got := formats[0].(map[string]any)["day"]; got != "2026-06-13" {
			t.Errorf("the day of the race with no date is %v, want the start of the event", got)
		}
		if got := result.Structured["url"]; got != siteURL+"/evenements/"+fx.Event.Id {
			t.Errorf("url = %v", got)
		}
		assertJSON(t, result.Structured["created_by"], runnerRef(fx.AliceRunner))
	})

	t.Run("a race that has nothing besides its name and its races", func(t *testing.T) {
		result := succeeded(t, get(map[string]any{"event_id": fx.Event2.Id}))
		assertJSON(t, result.Structured, map[string]any{
			"id": fx.Event2.Id, "name": "10 km de Lyon", "location": "Lyon", "start_date": "2026-06-22",
			"created_by": runnerRef(fx.BobRunner), "url": siteURL + "/evenements/" + fx.Event2.Id,
			"formats": []any{map[string]any{
				"id": fx.FLyon.Id, "title": "Route 10 km",
				"race_type":   map[string]any{"id": fx.Road.Id, "label": "Route"},
				"distance_km": 10, "day": "2026-06-22", "participants": []any{},
			}},
			"undecided": []any{}, "supporters": []any{}, "rides": []any{}, "lodgings": []any{}, "comments": []any{},
			"comments_total": 0,
		})
	})

	t.Run("a race with no format and nobody is an empty page, not an error", func(t *testing.T) {
		bare := create(t, app, "events", map[string]any{"name": "Nue", "location": "Ici", "start_date": "2026-07-01", "created_by": fx.AliceRunner.Id})
		result := succeeded(t, get(map[string]any{"event_id": bare.Id}))
		assertJSON(t, result.Structured["formats"], []any{})
	})

	t.Run("an unknown race", func(t *testing.T) {
		result := get(map[string]any{"event_id": "aaaaaaaaaaaaaaa"})
		if !result.IsError || result.Text != "Introuvable : il a peut-être été supprimé." {
			t.Errorf("isError %v, text %q", result.IsError, result.Text)
		}
	})

	// What is not an id is not said to be a race that was deleted: the model passed
	// something else (a name), and is told to look the race up.
	t.Run("an id that cannot be one is not looked up, and says so", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		for _, row := range []struct{ id, want string }{
			{"nope", "« nope » n'est pas un identifiant de course : cherche la course avec search_events pour obtenir le sien."},
			{"Trail des Crêtes", "« Trail des Crêtes » n'est pas un identifiant de course : cherche la course avec search_events pour obtenir le sien."},
			{"../../api/settings", "« ../../api/settings » n'est pas un identifiant de course : cherche la course avec search_events pour obtenir le sien."},
			{"aaaaaaaaaaaaaaa'||1=1", "« aaaaaaaaaaaaaaa'||1=1 » n'est pas un identifiant de course : cherche la course avec search_events pour obtenir le sien."},
			// An id has no capitals.
			{strings.ToUpper(fx.Event.Id), "« " + strings.ToUpper(fx.Event.Id) + " » n'est pas un identifiant de course : cherche la course avec search_events pour obtenir le sien."},
			{"", "Il manque l'identifiant de la course (event_id) : cherche la course avec search_events pour l'obtenir."},
			{"   ", "Il manque l'identifiant de la course (event_id) : cherche la course avec search_events pour l'obtenir."},
		} {
			result := get(map[string]any{"event_id": row.id})
			if !result.IsError || result.Text != row.want {
				t.Errorf("%q: isError %v, text %q, want %q", row.id, result.IsError, result.Text, row.want)
			}
		}
		if counted.Total() != 0 {
			t.Errorf("%d inner requests for ids that cannot be ones", counted.Total())
		}
	})

	t.Run("the blanks around an id are not part of it", func(t *testing.T) {
		for _, id := range []string{" " + fx.Event.Id, fx.Event.Id + "\n", "\t" + fx.Event.Id + " "} {
			result := succeeded(t, get(map[string]any{"event_id": id}))
			if result.Structured["id"] != fx.Event.Id {
				t.Errorf("%q: the race is %v", id, result.Structured["id"])
			}
		}
	})

	t.Run("no event_id is refused by the schema", func(t *testing.T) {
		if result := get(nil); !result.IsError {
			t.Errorf("accepted: %.200s", result.Text)
		}
	})

	t.Run("a page only reads", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		succeeded(t, get(map[string]any{"event_id": fx.Event.Id}))
		if counted.Total() == 0 {
			t.Error("no request was made")
		}
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
			if n := counted.Of(method); n != 0 {
				t.Errorf("%d %s requests", n, method)
			}
		}
	})
}

// A page does not give more than the last 50 comments, and says how many there are.
func TestTools_GetEvent_BoundsTheComments(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := newToken(t, app, fx.Alice)

	// 55 comments, one a minute, saved from the newest to the oldest: what is kept
	// is the latest by date, not the first saved.
	for i := 55; i >= 1; i-- {
		comment := create(t, app, "comments", map[string]any{
			"event": fx.Event.Id, "author": fx.AliceRunner.Id, "body": fmt.Sprintf("Commentaire %02d", i),
		})
		stamp := fmt.Sprintf("2026-06-01 10:%02d:00.000Z", i)
		putDates(t, app, comment.Id, stamp, stamp)
	}

	result := succeeded(t, callTool(t, app, token, "get_event", map[string]any{"event_id": fx.Event.Id}))
	got := commentsOf(t, callTool(t, app, token, "get_event", map[string]any{"event_id": fx.Event.Id}))
	if len(got) != 50 {
		t.Fatalf("%d comments, want the latest 50", len(got))
	}
	// Oldest first, from the 6th to the 55th.
	if first, last := got[0]["body"], got[49]["body"]; first != "Commentaire 06" || last != "Commentaire 55" {
		t.Errorf("the comments go from %v to %v, want from Commentaire 06 to Commentaire 55", first, last)
	}
	if got := result.Structured["comments_total"]; got != float64(55) {
		t.Errorf("comments_total = %v, want 55: the number of comments of the race", got)
	}

	// Under the bound, nothing is left out.
	other := succeeded(t, callTool(t, app, token, "get_event", map[string]any{"event_id": fx.Event2.Id}))
	if len(other.Structured["comments"].([]any)) != 0 || other.Structured["comments_total"] != float64(0) {
		t.Errorf("a race with no comment: %v, total %v", other.Structured["comments"], other.Structured["comments_total"])
	}
}

// A result is on the participation only when there is one, as the site shows it.
func TestTools_GetEvent_Results(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	update(t, app, fx.P1, map[string]any{
		"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H",
	})
	update(t, app, fx.P2, map[string]any{"status": "dnf", "result_note": "abandon au km 30"})

	result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "get_event", map[string]any{"event_id": fx.Event.Id}))
	f42 := result.Structured["formats"].([]any)[1].(map[string]any)
	people := f42["participants"].([]any)

	assertJSON(t, people[0].(map[string]any)["result"], map[string]any{
		"finish_time": "4:12:30", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "note": "3e V1H",
	})
	if got := people[0].(map[string]any)["status_label"]; got != "Terminé" {
		t.Errorf("status_label = %v", got)
	}
	// A note alone is a result.
	assertJSON(t, people[1].(map[string]any)["result"], map[string]any{"note": "abandon au km 30"})
	if got := people[1].(map[string]any)["status_label"]; got != "Abandon" {
		t.Errorf("status_label = %v", got)
	}
	// A participation without one has none: the key is not there.
	p3 := result.Structured["formats"].([]any)[0].(map[string]any)["participants"].([]any)[0].(map[string]any)
	if _, ok := p3["result"]; ok {
		t.Errorf("a participation with no result has %v", p3["result"])
	}

	// The participation of Sam, on the 15 km, as the answer says it.
	token := newToken(t, app, fx.Alice)
	sam := func(t *testing.T) map[string]any {
		t.Helper()
		result := succeeded(t, callTool(t, app, token, "get_event", map[string]any{"event_id": fx.Event.Id}))
		return result.Structured["formats"].([]any)[0].(map[string]any)["participants"].([]any)[0].(map[string]any)
	}

	for _, row := range []struct {
		seconds int
		want    string
	}{
		{3605, "1:00:05"},
		{2700, "0:45:00"},
		{59, "0:00:59"},
		{36000 + 62, "10:01:02"},
	} {
		t.Run(fmt.Sprintf("a time of %d seconds", row.seconds), func(t *testing.T) {
			update(t, app, fx.P3, map[string]any{"status": "finished", "finish_time_s": row.seconds})
			assertJSON(t, sam(t)["result"], map[string]any{"finish_time": row.want, "finish_time_s": row.seconds})
		})
	}

	t.Run("the number of people ranked is not a result by itself", func(t *testing.T) {
		update(t, app, fx.P3, map[string]any{"status": "finished", "finish_time_s": 0, "rank": 0, "rank_of": 340, "result_note": "  "})
		if got, ok := sam(t)["result"]; ok {
			t.Errorf("the result is %v, want none", got)
		}
	})

	t.Run("a rank alone is one", func(t *testing.T) {
		update(t, app, fx.P3, map[string]any{"rank": 7, "rank_of": 0})
		assertJSON(t, sam(t)["result"], map[string]any{"rank": 7})
	})
}

// What an assistant reads never holds a secret: no email, no account id, no
// hash, no passkey (spec § 8.2).
func TestTools_ReadsHoldNoSecret(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))

	// What the tools can read the most of: a comment, a ride with a passenger.
	create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.AliceRunner.Id, "body": "Bonjour."})
	ride := create(t, app, "offers", map[string]any{"event": fx.Event.Id, "kind": "ride", "owner": fx.AliceRunner.Id, "place": "Lyon", "seats": 2})
	create(t, app, "offer_members", map[string]any{"offer": ride.Id, "runner": fx.BobRunner.Id, "added_by": fx.AliceRunner.Id})

	// A passkey, and a link of the calendar, on the account of the caller.
	create(t, app, "passkeys", map[string]any{
		"user": fx.Alice.Id, "name": "Mon téléphone", "credential_id": "Y3JlZGVudGlhbA", "credential": `{"id":"Y3JlZGVudGlhbA"}`,
	})

	token := newToken(t, app, fx.Admin)
	for _, call := range []struct {
		tool string
		args map[string]any
	}{
		{"whoami", nil},
		{"list_runners", nil},
		{"list_runners", map[string]any{"query": "a"}},
		{"list_race_types", nil},
		{"search_events", nil},
		{"search_events", map[string]any{"runner": "Alice"}},
		{"get_event", map[string]any{"event_id": fx.Event.Id}},
		{"home", nil},
		{"get_runner", nil},
		{"get_runner", map[string]any{"runner": "Bob"}},
		{"get_stats", nil},
		{"get_stats", map[string]any{"year": 2026}},
	} {
		t.Run(call.tool, func(t *testing.T) {
			args := call.args
			if args == nil {
				args = map[string]any{}
			}
			_, body := rpc(t, app, bearer(token), http.StatusOK, "tools/call", map[string]any{"name": call.tool, "arguments": args})
			if !strings.Contains(body, `"structuredContent"`) {
				t.Fatalf("the answer is not a result: %.200s", redact(body))
			}

			for _, secret := range []string{
				"@", "email", "token_hash", "credential", "password", "passkey", "Mon téléphone",
				fx.Alice.Id, fx.Bob.Id, fx.Admin.Id, // the ids of the accounts
			} {
				if strings.Contains(body, secret) {
					t.Errorf("the answer holds %q", secret)
				}
			}

			// No key "user" either, at any depth: a runner has an account or not
			// (has_account), and nothing else of it is said.
			var decoded any
			if err := json.Unmarshal([]byte(body), &decoded); err != nil {
				t.Fatal(err)
			}
			var walk func(v any)
			walk = func(v any) {
				switch v := v.(type) {
				case map[string]any:
					for key, value := range v {
						if key == "user" {
							t.Errorf("the answer has a key %q", key)
						}
						walk(value)
					}
				case []any:
					for _, item := range v {
						walk(item)
					}
				case string:
					// The text of the answer is JSON too.
					var inner any
					if strings.HasPrefix(v, "{") && json.Unmarshal([]byte(v), &inner) == nil {
						walk(inner)
					}
				}
			}
			walk(decoded)
		})
	}
}

// The inputs of the reads: the schema that a client sees.
func TestTools_ReadSchemas(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	_, body := rpc(t, app, bearer(newToken(t, app, fx.Alice)), http.StatusOK, "tools/list", nil)
	var list struct {
		Tools []struct {
			Name        string         `json:"name"`
			InputSchema map[string]any `json:"inputSchema"`
		} `json:"tools"`
	}
	resultOf(t, body, &list)
	schemas := map[string]map[string]any{}
	for _, tool := range list.Tools {
		schemas[tool.Name] = tool.InputSchema
	}
	property := func(tool, name string) map[string]any {
		t.Helper()
		properties, _ := schemas[tool]["properties"].(map[string]any)
		p, ok := properties[name].(map[string]any)
		if !ok {
			t.Fatalf("%s has no input %s (%v)", tool, name, properties)
		}
		return p
	}

	assertJSON(t, property("search_events", "period")["enum"], []any{"upcoming", "past"})
	limit := property("search_events", "limit")
	if limit["minimum"] != float64(1) || limit["maximum"] != float64(50) || limit["type"] != "integer" {
		t.Errorf("the limit is %v, want an integer from 1 to 50", limit)
	}
	for _, name := range []string{"query", "from", "to", "runner", "race_type", "limit", "period"} {
		if description, _ := property("search_events", name)["description"].(string); description == "" {
			t.Errorf("search_events: %s has no description", name)
		}
	}
	// Nothing is required of a search; a race is asked for by its id.
	if required, ok := schemas["search_events"]["required"]; ok && len(required.([]any)) > 0 {
		t.Errorf("search_events requires %v", required)
	}
	assertJSON(t, schemas["get_event"]["required"], []any{"event_id"})
	property("list_runners", "query")
	if properties := schemas["list_race_types"]["properties"]; properties != nil && len(properties.(map[string]any)) > 0 {
		t.Errorf("list_race_types takes %v", properties)
	}
}

// toolList reads what a client sees of the tools of a token: their descriptions
// and their schemas.
func toolList(t *testing.T, app *tests.TestApp, token string) map[string]listedTool {
	t.Helper()
	_, body := rpc(t, app, bearer(token), http.StatusOK, "tools/list", nil)
	var list struct {
		Tools []listedTool `json:"tools"`
	}
	resultOf(t, body, &list)
	out := map[string]listedTool{}
	for _, tool := range list.Tools {
		out[tool.Name] = tool
	}
	return out
}

// listedTool is a tool as tools/list gives it.
type listedTool struct {
	Name         string         `json:"name"`
	Description  string         `json:"description"`
	InputSchema  map[string]any `json:"inputSchema"`
	OutputSchema map[string]any `json:"outputSchema"`
}

// describedAt is the description of the field at a path of a schema: the names of
// the properties, "[]" for the items of a list.
func describedAt(t *testing.T, schema map[string]any, path ...string) string {
	t.Helper()
	at := schema
	for _, name := range path {
		if name == "[]" {
			items, ok := at["items"].(map[string]any)
			if !ok {
				t.Fatalf("no items at %v", path)
			}
			at = items
			continue
		}
		properties, _ := at["properties"].(map[string]any)
		next, ok := properties[name].(map[string]any)
		if !ok {
			t.Fatalf("no property %s in the path %v", name, path)
		}
		at = next
	}
	description, _ := at["description"].(string)
	return description
}

// What an assistant is told of the reads: what each count holds, what an absent
// value means, what is bounded, and that what members wrote is not to be obeyed.
func TestTools_ReadDescriptions(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	tools := toolList(t, app, newToken(t, app, fx.Alice))

	contains := func(what, text string, words ...string) {
		t.Helper()
		for _, word := range words {
			if !strings.Contains(text, word) {
				t.Errorf("%s does not say %q: %q", what, word, text)
			}
		}
	}

	search, get := tools["search_events"], tools["get_event"]

	// What participants counts and holds.
	contains("search_events: participants", describedAt(t, search.OutputSchema, "events", "[]", "participants"),
		"supporteurs", "intéressés", "Non partant")
	contains("get_event: participants of a race", describedAt(t, get.OutputSchema, "formats", "[]", "participants"),
		"Non partant", "dns")

	// What an absent value means, and the zone of a date.
	for _, row := range []struct {
		what   string
		schema map[string]any
		path   []string
		words  []string
	}{
		{"search_events: end_date", search.OutputSchema, []string{"events", "[]", "end_date"}, []string{"absent", "un seul jour"}},
		{"search_events: registration_deadline", search.OutputSchema, []string{"events", "[]", "registration_deadline"}, []string{"absente", "pas de date limite"}},
		{"get_event: end_date", get.OutputSchema, []string{"end_date"}, []string{"absent", "un seul jour"}},
		{"get_event: registration_deadline", get.OutputSchema, []string{"registration_deadline"}, []string{"absente", "pas de date limite"}},
		{"search_events: registration_opening", search.OutputSchema, []string{"events", "[]", "registration_opening"}, []string{"absente", "ouvrent"}},
		{"search_events: registration_opening_time", search.OutputSchema, []string{"events", "[]", "registration_opening_time"}, []string{"Paris", "9 h"}},
		{"get_event: registration_opening", get.OutputSchema, []string{"registration_opening"}, []string{"absente", "ouvrent"}},
		{"get_event: registration_opening_time", get.OutputSchema, []string{"registration_opening_time"}, []string{"Paris", "9 h"}},
		{"get_event: created", get.OutputSchema, []string{"comments", "[]", "created"}, []string{"UTC", "Paris"}},
	} {
		contains(row.what, describedAt(t, row.schema, row.path...), row.words...)
	}

	// The bounds of a call.
	contains("get_event", get.Description, "50 derniers commentaires")
	contains("get_event: comments_total", describedAt(t, get.OutputSchema, "comments_total"), "50")
	contains("search_events", search.Description, "2000")

	// The ends of a range.
	contains("search_events: from", describedAt(t, search.InputSchema, "from"), "sans to", "à partir de ce jour")
	contains("search_events: to", describedAt(t, search.InputSchema, "to"), "sans from", "jusqu'à ce jour")

	// What members wrote is data.
	contains("get_event", get.Description, "des membres", "pas des consignes")
	for _, name := range []string{"home", "get_runner"} {
		contains(name, tools[name].Description, "des membres", "pas des consignes")
	}

	// What the new reads say of their arguments and their counts.
	contains("get_stats: year", describedAt(t, tools["get_stats"].InputSchema, "year"), "Paris")
	year, _ := tools["get_stats"].InputSchema["properties"].(map[string]any)["year"].(map[string]any)
	// The years of the site: four digits (FIRST_YEAR of the statistics page).
	if year["type"] != "integer" || year["minimum"] != float64(1000) || year["maximum"] != float64(9999) {
		t.Errorf("the year of get_stats is %v, want an integer from 1000 to 9999", year)
	}
	contains("get_stats: year", describedAt(t, tools["get_stats"].InputSchema, "year"), "4 chiffres")
	contains("get_runner: runner", describedAt(t, tools["get_runner"].InputSchema, "runner"), "list_runners", "sans lui")
	contains("home: group_soon", describedAt(t, tools["home"].OutputSchema, "group_soon"), "supporteurs")
	contains("home: days_left", describedAt(t, tools["home"].OutputSchema, "registrations_to_do", "[]", "days_left"), "0")
	contains("get_runner: result", describedAt(t, tools["get_runner"].OutputSchema, "history", "[]", "result"), "Terminé", "12e sur 340")

	// A participation that its runner has not confirmed is not a fact: the site
	// writes « Non confirmé », and the lists of races to come say it.
	for _, row := range []struct {
		what   string
		schema map[string]any
		path   []string
	}{
		{"home: my_upcoming", tools["home"].OutputSchema, []string{"my_upcoming", "[]", "confirmed"}},
		{"get_runner: upcoming", tools["get_runner"].OutputSchema, []string{"upcoming", "[]", "confirmed"}},
	} {
		contains(row.what+": confirmed", describedAt(t, row.schema, row.path...), "Non confirmé", "pas encore confirmée", "pas comme un fait")
	}
	for _, name := range []string{"home", "get_runner"} {
		contains(name, tools[name].Description, "Non confirmé", "confirmed")
	}

	// The history of a runner is bounded, and says by how much.
	contains("get_runner", tools["get_runner"].Description, "50 dernières", "history_total")
	contains("get_runner: history", describedAt(t, tools["get_runner"].OutputSchema, "history"), "50 dernières")
	contains("get_runner: history_total", describedAt(t, tools["get_runner"].OutputSchema, "history_total"), "50", "years")

	// So is every read, at 5000 records: said where it applies.
	for _, name := range []string{"home", "get_runner", "get_stats"} {
		contains(name, tools[name].Description, "5000 enregistrements")
	}
}

// The opening of the registration is said by search_events and get_event, with
// its time, and only when there is one.
func TestTools_SearchEvents_Opening(t *testing.T) {
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)
	byID := func() map[string]map[string]any {
		t.Helper()
		out := map[string]map[string]any{}
		for _, e := range succeeded(t, callTool(t, app, alice, "search_events", nil)).Structured["events"].([]any) {
			event := e.(map[string]any)
			out[event["id"].(string)] = event
		}
		return out
	}

	// Without an opening, a race says neither.
	for id, e := range byID() {
		for _, field := range []string{"registration_opening", "registration_opening_time"} {
			if _, ok := e[field]; ok {
				t.Errorf("the race %s without an opening says %s", id, field)
			}
		}
	}

	update(t, app, fx.Event2, map[string]any{"registration_opening": "2026-05-04", "registration_opening_time": "10:00"})
	update(t, app, fx.Event, map[string]any{"registration_opening": "2026-05-05"})
	events := byID()
	if e := events[fx.Event2.Id]; e["registration_opening"] != "2026-05-04" || e["registration_opening_time"] != "10:00" {
		t.Errorf("the race with a time says %v at %v", e["registration_opening"], e["registration_opening_time"])
	}
	e := events[fx.Event.Id]
	if e["registration_opening"] != "2026-05-05" {
		t.Errorf("the race with a day says %v", e["registration_opening"])
	}
	if _, ok := e["registration_opening_time"]; ok {
		t.Errorf("the race without a time says %v", e["registration_opening_time"])
	}
}

func TestTools_GetEvent_Opening(t *testing.T) {
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)
	get := func(id string) map[string]any {
		t.Helper()
		return succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": id})).Structured
	}

	if s := get(fx.Event.Id); s["registration_opening"] != nil || s["registration_opening_time"] != nil {
		t.Errorf("a race without an opening says %v at %v", s["registration_opening"], s["registration_opening_time"])
	}
	update(t, app, fx.Event, map[string]any{"registration_opening": "2026-05-04", "registration_opening_time": "10:00"})
	if s := get(fx.Event.Id); s["registration_opening"] != "2026-05-04" || s["registration_opening_time"] != "10:00" {
		t.Errorf("the race says %v at %v", s["registration_opening"], s["registration_opening_time"])
	}
	update(t, app, fx.Event, map[string]any{"registration_opening_time": ""})
	if s := get(fx.Event.Id); s["registration_opening"] != "2026-05-04" || s["registration_opening_time"] != nil {
		t.Errorf("the race says %v at %v", s["registration_opening"], s["registration_opening_time"])
	}
}
