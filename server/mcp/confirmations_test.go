package mcp_test

import (
	"encoding/json"
	"maps"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The confirmations of the tools that would delete or clear something (spec
// § 6.13), through /mcp.

// asked checks that a result is a confirmation, that is nothing done and a
// token to call again with, and returns its token, its message and its details.
func asked(t *testing.T, result toolResult) (token, message string, details []string) {
	t.Helper()
	if result.IsError {
		t.Fatalf("the tool answered the error %q, want a confirmation", result.Text)
	}
	if done, ok := result.Structured["done"].(bool); !ok || done {
		t.Fatalf("done = %v, want false: %.300s", result.Structured["done"], redact(result.Text))
	}
	confirmation, _ := result.Structured["confirmation"].(map[string]any)
	if confirmation == nil {
		t.Fatalf("no confirmation in %.300s", redact(result.Text))
	}
	token, _ = confirmation["token"].(string)
	if !tokenShape.MatchString(token) {
		t.Errorf("the confirmation token %s does not have the shape cfm_ + 26 characters", prefix(token))
	}
	expires, _ := confirmation["expires_at"].(string)
	if _, err := time.Parse(time.RFC3339, expires); err != nil || !strings.HasSuffix(expires, "Z") {
		t.Errorf("expires_at = %q, want a UTC time", expires)
	}
	message, _ = confirmation["message"].(string)
	if !strings.HasPrefix(message, "Rien n'a été fait. ") || !strings.Contains(message, "valable 10 minutes, une seule fois") ||
		!strings.Contains(message, `confirmation: "`+token+`"`) {
		t.Errorf("the message does not say that nothing was done and how to confirm: %q", redact(message))
	}
	for _, line := range confirmation["details"].([]any) {
		details = append(details, line.(string))
	}
	return token, message, details
}

// mentions checks that a confirmation names each of want, in its message or its
// details.
func mentions(t *testing.T, message string, details []string, want ...string) {
	t.Helper()
	all := message + "\n" + strings.Join(details, "\n")
	for _, w := range want {
		if !strings.Contains(all, w) {
			t.Errorf("the confirmation does not name %q:\n%s", w, redact(all))
		}
	}
}

// with is args with the confirmation.
func with(args map[string]any, token string) map[string]any {
	again := maps.Clone(args)
	again["confirmation"] = token
	return again
}

// summaryOfResult is the summary of a tool's answer.
func summaryOfResult(result toolResult) string {
	summary, _ := result.Structured["summary"].(string)
	return summary
}

// dbState is what the races hold, for a test to see that nothing was written:
// each record of the collections that the tools of the races write, with the
// moment it was last changed.
func dbState(t testing.TB, app core.App) string {
	t.Helper()
	var lines []string
	for _, collection := range []string{"events", "formats", "participations", "comments", "offers", "offer_members"} {
		records, err := app.FindAllRecords(collection)
		if err != nil {
			t.Fatal(err)
		}
		for _, r := range records {
			lines = append(lines, collection+" "+r.Id+" "+r.GetString("updated"))
		}
	}
	slices.Sort(lines)
	return strings.Join(lines, "\n")
}

// writesNothing runs call and checks that it sent no request but reads, and
// that the database did not change.
func writesNothing(t *testing.T, app *tests.TestApp, call func()) {
	t.Helper()
	before := dbState(t, app)
	counted := mcp.CountInnerRequests(t)
	call()
	if got := counted.Total() - counted.Of(http.MethodGet); got != 0 {
		t.Errorf("%d inner requests that are not reads, want none", got)
	}
	if after := dbState(t, app); after != before {
		t.Errorf("the database changed:\nbefore\n%s\nafter\n%s", before, after)
	}
}

// A risky call without a confirmation writes nothing: it answers what would be
// lost, and a token. Each tool that asks for a confirmation adds its rows here.
func TestTools_Confirmation_NothingWrittenFirst(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	update(t, app, fx.Event, map[string]any{"notes": "Navette depuis la gare à 6 h."})
	// An old race of three days, whose last day is the one of a format nobody
	// runs yet.
	ultra := create(t, app, "events", map[string]any{"name": "Ultra des Lacs", "location": "Annecy", "start_date": "2026-03-01", "end_date": "2026-03-03", "created_by": fx.AliceRunner.Id})
	fLast := create(t, app, "formats", map[string]any{"event": ultra.Id, "race_type": fx.Trail.Id, "distance_km": 100, "date": "2026-03-03"})
	create(t, app, "formats", map[string]any{"event": ultra.Id, "race_type": fx.Trail.Id, "distance_km": 30})
	// What the participation tools are asked about: the runner of the admin on a
	// race that has one format, alone (the event, and no format), and a race that
	// Alice finished, with her result.
	joinedEvent(t, app, fx.AdminRunner, fx.Event2, "interested", false, fx.AliceRunner)
	_, crossFormat := newRace(t, app, fx, fx.AliceRunner, "Cross des Lacs", "2026-03-08")
	finished := joined(t, app, fx.AliceRunner, crossFormat, "finished", true, fx.AliceRunner)
	update(t, app, finished, map[string]any{"finish_time_s": 5025, "rank": 3, "rank_of": 90})

	for _, row := range []struct {
		name string
		tool string
		args map[string]any
		// want are what the confirmation names.
		want []string
	}{
		{
			"create_event: a race like it exists", "create_event",
			map[string]any{
				"name": "Trail des Crêtes", "location": "Annecy", "start_date": "2026-06-20",
				"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 20}},
			},
			[]string{"« Trail des Crêtes » (2026-06-13 au 2026-06-14, Annecy, 3 participants, id " + fx.Event.Id + ")"},
		},
		{
			"update_event: the notes cleared", "update_event",
			map[string]any{"event_id": fx.Event.Id, "notes": ""},
			[]string{"Les notes seraient effacées", "Navette depuis la gare à 6 h."},
		},
		{
			"update_event: the notes replaced", "update_event",
			map[string]any{"event_id": fx.Event.Id, "notes": "Pas de navette cette année."},
			[]string{"Les notes seraient remplacées", "Navette depuis la gare à 6 h."},
		},
		{
			"update_event: an old race shortened", "update_event",
			map[string]any{"event_id": ultra.Id, "formats": []any{map[string]any{"format_id": fLast.Id, "date": "2026-03-02"}}},
			[]string{"raccourcie", "2026-03-01 au 2026-03-03", "2026-03-01 au 2026-03-02"},
		},
		{
			"update_event: the start moved, with participants", "update_event",
			map[string]any{"event_id": fx.Event.Id, "start_date": "2026-06-12"},
			[]string{"« Trail 15 km »", "du 2026-06-13 au 2026-06-12", "Sam (Intéressé, non confirmé)"},
		},
		{
			"update_format: a field cleared", "update_format",
			map[string]any{"format_id": fx.F42.Id, "elevation_gain_m": 0},
			[]string{"« Trail 42 km »", "le D+ serait effacé", "2400"},
		},
		{
			"update_format: the day moved, with participants", "update_format",
			map[string]any{"format_id": fx.F42.Id, "date": "2026-06-13"},
			[]string{"« Trail 42 km »", "du 2026-06-14 au 2026-06-13", "Alice (Inscrit)", "Bob (Intéressé, non confirmé)"},
		},
		{
			"delete_event", "delete_event",
			map[string]any{"event_id": fx.Event.Id},
			[]string{"« Trail des Crêtes »", "« Trail 42 km »", "« Trail 15 km »", "Alice (Inscrit)", "Bob (Intéressé, non confirmé)", "Sam (Intéressé, non confirmé)"},
		},
		{
			"delete_format", "delete_format",
			map[string]any{"format_id": fx.F42.Id},
			[]string{"« Trail 42 km » (Trail des Crêtes)", "2 participations", "Alice (Inscrit)", "Bob (Intéressé, non confirmé)"},
		},
		{
			"add_participation: it replaces another runner's choice", "add_participation",
			map[string]any{"runner": "Admin", "format_id": fx.FLyon.Id, "status": "interested"},
			[]string{"Admin (Intéressé, non confirmé)", "course seule « 10 km de Lyon »", "ajoutée par Alice", "« Route 10 km »"},
		},
		{
			"update_participation: somebody else's", "update_participation",
			map[string]any{"participation_id": fx.P2.Id, "status": "registered"},
			[]string{"Bob (Intéressé, non confirmé)", "« Trail 42 km »", "d'un autre coureur", "de Intéressé à Inscrit"},
		},
		{
			"update_participation: a status that erases a result", "update_participation",
			map[string]any{"participation_id": finished.Id, "status": "dns"},
			[]string{"Le résultat serait effacé", "1h 23min 45s", "3e sur 90"},
		},
		{
			"remove_participation", "remove_participation",
			map[string]any{"participation_id": fx.P3.Id},
			[]string{"Sam (Intéressé, non confirmé)", "« Trail 15 km » (Trail des Crêtes)", "ajoutée par Alice"},
		},
		{
			"set_result: it replaces a result", "set_result",
			map[string]any{"participation_id": finished.Id, "status": "finished", "finish_time": "1:20:00", "rank": 3, "rank_of": 90},
			[]string{"1h 23min 45s", "1h 20min", "3e sur 90"},
		},
		{
			"set_result: somebody else's", "set_result",
			map[string]any{"participation_id": fx.P2.Id, "status": "finished", "finish_time": "5:00:00"},
			[]string{"Bob (Intéressé, non confirmé)", "d'un autre coureur"},
		},
	} {
		t.Run(row.name, func(t *testing.T) {
			writesNothing(t, app, func() {
				_, message, details := asked(t, callTool(t, app, alice, row.tool, row.args))
				mentions(t, message, details, row.want...)
			})
		})
	}
}

// The confirmed call writes, once; the same token again is refused, and a new
// confirmation is given.
func TestTools_Confirmation_WritesOnce(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	args := map[string]any{
		"name": "Trail des Crêtes", "location": "Annecy", "start_date": "2026-06-20",
		"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 20}},
	}
	events := func() int {
		t.Helper()
		n, err := app.CountRecords("events")
		if err != nil {
			t.Fatal(err)
		}
		return int(n)
	}
	before := events()

	token, _, _ := asked(t, callTool(t, app, alice, "create_event", args))
	done := succeeded(t, callTool(t, app, alice, "create_event", with(args, token)))
	if d, _ := done.Structured["done"].(bool); !d {
		t.Fatalf("the confirmed call is not done: %.300s", redact(done.Text))
	}
	if got := events(); got != before+1 {
		t.Fatalf("%d events after the confirmed call, want %d", got, before+1)
	}

	writesNothing(t, app, func() {
		again := callTool(t, app, alice, "create_event", with(args, token))
		fresh, message, _ := asked(t, again)
		if summary := summaryOfResult(again); !strings.Contains(summary, "Confirmation refusée : elle a déjà servi.") {
			t.Errorf("the summary is %q, want the token refused as used", summary)
		}
		if fresh == token {
			t.Error("the new confirmation has the token that was used")
		}
		// Two races alike now: the first one, and the one just made.
		mentions(t, message, nil, fx.Event.Id, done.Structured["id"].(string))
	})
}

func TestTools_Confirmation_Expired(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	start := at(2026, 5, 1, 10, 0)
	mcp.SetNow(t, start)
	alice := newToken(t, app, fx.Alice)
	args := map[string]any{"format_id": fx.F42.Id}

	token, _, _ := asked(t, callTool(t, app, alice, "delete_format", args))
	mcp.SetNow(t, start.Add(10*time.Minute+time.Second))
	writesNothing(t, app, func() {
		again := callTool(t, app, alice, "delete_format", with(args, token))
		if fresh, _, _ := asked(t, again); fresh == token {
			t.Error("the new confirmation has the token that expired")
		}
		if summary := summaryOfResult(again); !strings.Contains(summary, "Confirmation refusée : elle a expiré.") {
			t.Errorf("the summary is %q, want the token refused as expired", summary)
		}
	})
}

// A token is good for the request it was given for only: the account, the MCP
// token, the tool and the arguments.
func TestTools_Confirmation_OtherArguments(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	aliceAgain := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)
	update(t, app, fx.Event, map[string]any{"notes": "Navette depuis la gare à 6 h."})

	const other = "Confirmation refusée : elle ne correspond pas à cette demande."
	for _, row := range []struct {
		name string
		// first is the call that is given the token, as alice.
		firstTool string
		firstArgs map[string]any
		// then is the call that presents it.
		token    string
		thenTool string
		thenArgs map[string]any
	}{
		{"delete_format of F15 on F42", "delete_format", map[string]any{"format_id": fx.F15.Id}, alice, "delete_format", map[string]any{"format_id": fx.F42.Id}},
		{"delete_format on delete_event", "delete_format", map[string]any{"format_id": fx.F42.Id}, alice, "delete_event", map[string]any{"event_id": fx.Event.Id}},
		{"Alice's, by Bob", "update_event", map[string]any{"event_id": fx.Event.Id, "notes": ""}, bob, "update_event", map[string]any{"event_id": fx.Event.Id, "notes": ""}},
		{"Alice's, through another of her tokens", "delete_format", map[string]any{"format_id": fx.F42.Id}, aliceAgain, "delete_format", map[string]any{"format_id": fx.F42.Id}},
	} {
		t.Run(row.name, func(t *testing.T) {
			token, _, _ := asked(t, callTool(t, app, alice, row.firstTool, row.firstArgs))
			writesNothing(t, app, func() {
				again := callTool(t, app, row.token, row.thenTool, with(row.thenArgs, token))
				asked(t, again)
				if summary := summaryOfResult(again); !strings.Contains(summary, other) {
					t.Errorf("the summary is %q, want %q", summary, other)
				}
			})
		})
	}
}

// « bob » and the id of Bob are the same request: the arguments of a
// confirmation are normalized (the runner, the race that its format gives, the
// time written with a leading zero).
func TestTools_Confirmation_NamesOrIds(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	t.Run("a runner by name, then by id, with the race given another way", func(t *testing.T) {
		replaced := joinedEvent(t, app, fx.BobRunner, fx.Event2, "interested", false, fx.AliceRunner)
		byName := map[string]any{"runner": "bob", "format_id": fx.FLyon.Id, "status": "registered"}
		byID := map[string]any{"runner": fx.BobRunner.Id, "event_id": fx.Event2.Id, "format_id": fx.FLyon.Id, "status": "registered"}

		token, _, _ := asked(t, callTool(t, app, alice, "add_participation", byName))
		done := succeeded(t, callTool(t, app, alice, "add_participation", with(byID, token)))
		if d, _ := done.Structured["done"].(bool); !d {
			t.Fatalf("the call with the id is not done: %.300s", redact(done.Text))
		}
		if storedRecord(t, app, "participations", replaced.Id) != nil {
			t.Error("the participation to the event alone is still there")
		}
		if participationOf(t, app, fx.BobRunner, fx.FLyon) == nil {
			t.Error("Bob is not on the race")
		}
	})

	t.Run("a time written two ways", func(t *testing.T) {
		update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340})
		args := map[string]any{"participation_id": fx.P1.Id, "status": "finished", "finish_time": "4:10:00", "rank": 12, "rank_of": 340}
		again := map[string]any{"participation_id": " " + fx.P1.Id + " ", "status": "finished", "finish_time": "04:10:00", "rank": 12, "rank_of": 340}

		token, _, _ := asked(t, callTool(t, app, alice, "set_result", args))
		done := succeeded(t, callTool(t, app, alice, "set_result", with(again, token)))
		if d, _ := done.Structured["done"].(bool); !d {
			t.Fatalf("the call with the other time is not done: %.300s", redact(done.Text))
		}
		if got := storedRecord(t, app, "participations", fx.P1.Id).GetInt("finish_time_s"); got != 15000 {
			t.Errorf("the time is %d s, want 15000", got)
		}
	})

	t.Run("another runner is another request", func(t *testing.T) {
		event, format := newRace(t, app, fx, fx.AliceRunner, "Foulées de test", "2026-09-05")
		joinedEvent(t, app, fx.BobRunner, event, "supporter", false, fx.AliceRunner)
		joinedEvent(t, app, fx.AdminRunner, event, "supporter", false, fx.AliceRunner)
		forBob := map[string]any{"runner": "Bob", "format_id": format.Id, "status": "interested"}
		forAdmin := map[string]any{"runner": "Admin", "format_id": format.Id, "status": "interested"}

		token, _, _ := asked(t, callTool(t, app, alice, "add_participation", forBob))
		writesNothing(t, app, func() {
			again := callTool(t, app, alice, "add_participation", with(forAdmin, token))
			asked(t, again)
			if summary := summaryOfResult(again); !strings.Contains(summary, "Confirmation refusée : elle ne correspond pas à cette demande.") {
				t.Errorf("the summary is %q", summary)
			}
		})
	})
}

// What the person agreed to is not what would be done any more: the token is
// refused, and the new confirmation says what is there now.
func TestTools_Confirmation_StateChanged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	args := map[string]any{"format_id": fx.F42.Id}

	token, message, details := asked(t, callTool(t, app, alice, "delete_format", args))
	if strings.Contains(message+strings.Join(details, ""), "Sam") {
		t.Fatal("the first confirmation names Sam, who is not on F42 yet")
	}
	// Meanwhile, Sam is added to F42, and Bob registers.
	create(t, app, "participations", map[string]any{
		"runner": fx.SamRunner.Id, "format": fx.F42.Id, "status": "interested", "confirmed": false, "added_by": fx.AliceRunner.Id,
	})
	update(t, app, fx.P2, map[string]any{"status": "registered"})

	writesNothing(t, app, func() {
		again := callTool(t, app, alice, "delete_format", with(args, token))
		_, message, details := asked(t, again)
		// What changed is said: the lines that are new, and the ones that are
		// not true any more.
		const want = "Confirmation refusée : la situation a changé depuis. " +
			"Nouveau : « Bob (Inscrit, non confirmé) », « Sam (Intéressé, non confirmé) ». " +
			"Plus d'actualité : « Bob (Intéressé, non confirmé) »."
		if summary := summaryOfResult(again); !strings.HasPrefix(summary, want) {
			t.Errorf("the summary is %q, want it to start with %q", summary, want)
		}
		mentions(t, message, details, "Sam (Intéressé, non confirmé)", "3 participations")
	})
	if _, err := app.FindRecordById("formats", fx.F42.Id); err != nil {
		t.Errorf("F42 is gone: %v", err)
	}

	// A change that no line shows (the D+ of F42, whose record the confirmation
	// was read from) is only said to be a change.
	token, _, _ = asked(t, callTool(t, app, alice, "delete_format", args))
	update(t, app, fx.F42, map[string]any{"elevation_gain_m": 2500})
	again := callTool(t, app, alice, "delete_format", with(args, token))
	asked(t, again)
	const changed = "Confirmation refusée : la situation a changé depuis. Rien n'a été fait"
	if summary := summaryOfResult(again); !strings.HasPrefix(summary, changed) {
		t.Errorf("the summary is %q, want it to start with %q", summary, changed)
	}
}

// The participation that was asked about changed in the meantime: the token is
// refused, and the new confirmation says how it is now.
func TestTools_Confirmation_StateChangedForAParticipation(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	args := map[string]any{"participation_id": fx.P3.Id}

	token, _, _ := asked(t, callTool(t, app, alice, "remove_participation", args))
	update(t, app, fx.P3, map[string]any{"status": "registered"})

	writesNothing(t, app, func() {
		again := callTool(t, app, alice, "remove_participation", with(args, token))
		_, message, details := asked(t, again)
		const want = "Confirmation refusée : la situation a changé depuis. Nouveau : « Sam (Inscrit, non confirmé)"
		if summary := summaryOfResult(again); !strings.HasPrefix(summary, want) {
			t.Errorf("the summary is %q, want it to start with %q", summary, want)
		}
		mentions(t, message, details, "Sam (Inscrit, non confirmé)")
	})
	if storedRecord(t, app, "participations", fx.P3.Id) == nil {
		t.Error("the participation is gone")
	}
}

// A confirmation that a call presents is taken, whatever happens (spec § 6.13):
// a call that the tool refuses before it asks anything uses it up too.
func TestTools_Confirmation_UsedUpByAnEarlyRefusal(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)
	// Bob confirmed his participation: a member may not remove it.
	update(t, app, fx.P2, map[string]any{"confirmed": true})

	for _, row := range []struct {
		name string
		tool string
		args map[string]any
		// early is the call, refused before the confirmation, that presents
		// the token.
		token     string
		earlyTool string
		early     map[string]any
	}{
		{"an id that is not one", "delete_format", map[string]any{"format_id": fx.F42.Id}, alice, "delete_format", map[string]any{"format_id": "nope"}},
		{"a race that is not there", "delete_event", map[string]any{"event_id": fx.Event.Id}, alice, "delete_event", map[string]any{"event_id": "aaaaaaaaaaaaaaa"}},
		{"the refusal of the author", "delete_format", map[string]any{"format_id": fx.F42.Id}, bob, "delete_format", map[string]any{"format_id": fx.F15.Id}},
		{"a format without a measure", "update_format", map[string]any{"format_id": fx.F42.Id, "elevation_gain_m": 0}, alice, "update_format", map[string]any{"format_id": fx.F42.Id, "distance_km": 0}},
		{"the refusal of a participation that its runner confirmed", "remove_participation", map[string]any{"participation_id": fx.P3.Id}, alice, "remove_participation", map[string]any{"participation_id": fx.P2.Id}},
	} {
		t.Run(row.name, func(t *testing.T) {
			token, _, _ := asked(t, callTool(t, app, alice, row.tool, row.args))
			writesNothing(t, app, func() {
				if early := callTool(t, app, row.token, row.earlyTool, with(row.early, token)); !early.IsError {
					t.Fatalf("the early call answered %.200s, want a refusal", redact(early.Text))
				}
				again := callTool(t, app, alice, row.tool, with(row.args, token))
				asked(t, again)
				if summary := summaryOfResult(again); !strings.Contains(summary, "Confirmation refusée : elle a déjà servi.") {
					t.Errorf("the summary is %q, want the token used up", summary)
				}
			})
		})
	}
}

// The risk went away between the two calls: nothing is written, and the
// assistant is told to call again without the token.
func TestTools_Confirmation_NoLongerNeeded(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	update(t, app, fx.Event, map[string]any{"notes": "Navette depuis la gare à 6 h."})
	args := map[string]any{"event_id": fx.Event.Id, "notes": ""}

	token, _, _ := asked(t, callTool(t, app, alice, "update_event", args))
	update(t, app, fx.Event, map[string]any{"notes": ""})

	writesNothing(t, app, func() {
		again := succeeded(t, callTool(t, app, alice, "update_event", with(args, token)))
		if done, _ := again.Structured["done"].(bool); done {
			t.Error("the call was done")
		}
		if _, ok := again.Structured["confirmation"]; ok {
			t.Error("a new confirmation was given for a request that needs none")
		}
		const want = "Cette demande n'a plus besoin de confirmation : rappelle-la sans confirmation."
		if summary := summaryOfResult(again); !strings.Contains(summary, want) {
			t.Errorf("the summary is %q, want %q", summary, want)
		}
	})
}

// The request log says, for each tool, whether a confirmation was asked or
// given; never the token of the confirmation.
func TestTools_Confirmation_Logged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	app.Settings().Logs.MaxDays = 5 // the logs are off in a test application
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	args := map[string]any{"format_id": fx.F42.Id}
	token, _, _ := asked(t, callTool(t, app, alice, "delete_format", args))
	isDone(t, callTool(t, app, alice, "delete_format", with(args, token)))
	succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": fx.Event.Id}))

	var got []string
	deadline := time.Now().Add(5 * time.Second)
	for len(got) < 3 && time.Now().Before(deadline) {
		got = nil
		for _, entry := range testutil.RequestLogs(t, app, 0) {
			data, err := json.Marshal(entry.Data)
			if err != nil {
				t.Fatal(err)
			}
			if text := entry.Message + " " + string(data); strings.Contains(text, token) || strings.Contains(text, "cfm_") {
				t.Errorf("the log holds a confirmation token, in the entry %q", entry.Message)
			}
			if entry.Message != "POST /mcp" {
				continue
			}
			meta, _ := entry.Data["meta"].(map[string]any)
			tools, _ := json.Marshal(meta["mcpTools"])
			got = append(got, string(tools))
		}
		time.Sleep(20 * time.Millisecond)
	}
	slices.Sort(got)
	// The log keeps the meta as an object, whose keys come back sorted.
	want := []string{
		`[{"confirmation":"asked","tool":"delete_format"}]`,
		`[{"confirmation":"confirmed","tool":"delete_format"}]`,
		`[{"tool":"get_event"}]`,
	}
	if !slices.Equal(got, want) {
		t.Errorf("the log names the tools %q, want %q", got, want)
	}
}
