package mcp_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// stored is a record as the database has it now; nil when it is gone.
func storedRecord(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		return nil
	}
	return record
}

// writeFast lets a test write faster than PocketBase lets one address write: its
// rules allow 3 batches a second (/api/batch) and 20 creations in 5 seconds, which
// the tests, with every request from one address, go past. A person does not.
func writeFast(app *tests.TestApp) {
	app.Settings().RateLimits.Enabled = false
}

// announced checks that a tool answered the error want, sent no request but
// reads, and wrote nothing: a refusal that the tool announces, as the form
// does, before the site would give it.
func announced(t *testing.T, app *tests.TestApp, token, tool string, args map[string]any, want string) {
	t.Helper()
	writesNothing(t, app, func() {
		failsWith(t, callTool(t, app, token, tool, args), tool, want)
	})
}

// refused checks that a tool answered the error want, and that the database did
// not change: a refusal of the site, whose batch wrote nothing.
func refused(t *testing.T, app *tests.TestApp, token, tool string, args map[string]any, want string) {
	t.Helper()
	before := dbState(t, app)
	failsWith(t, callTool(t, app, token, tool, args), tool, want)
	if after := dbState(t, app); after != before {
		t.Errorf("the database changed:\nbefore\n%s\nafter\n%s", before, after)
	}
}

// failsWith checks that result is the error want.
func failsWith(t *testing.T, result toolResult, tool, want string) {
	t.Helper()
	if !result.IsError {
		t.Errorf("%s answered %.300s, want the error %q", tool, redact(result.Text), want)
		return
	}
	if !strings.Contains(result.Text, want) {
		t.Errorf("%s: the error is %q, want %q", tool, result.Text, want)
	}
}

// isDone checks that a tool did what it was asked at the first call.
func isDone(t *testing.T, result toolResult) toolResult {
	t.Helper()
	succeeded(t, result)
	if done, _ := result.Structured["done"].(bool); !done {
		t.Fatalf("the call was not done: %.400s", redact(result.Text))
	}
	if _, ok := result.Structured["confirmation"]; ok {
		t.Error("a call that is done has a confirmation")
	}
	if summaryOfResult(result) == "" {
		t.Error("no summary")
	}
	textIs(t, result)
	return result
}

// formatsOf are the formats of an answer that has the race.
func formatsOf(t testing.TB, result toolResult) []map[string]any {
	t.Helper()
	var out []map[string]any
	list, _ := result.Structured["formats"].([]any)
	for _, f := range list {
		out = append(out, f.(map[string]any))
	}
	return out
}

func TestTools_CreateEvent(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	t.Run("two formats and join: written at once, in one batch", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, alice, "create_event", map[string]any{
			"name": "  Trail des Monts ", "location": "Chamonix", "start_date": "2026-09-12",
			"registration_url": "https://inscriptions.example.test/monts",
			"formats": []any{
				map[string]any{"race_type": "trail", "distance_km": 42, "elevation_gain_m": 2500, "date": "2026-09-13"},
				map[string]any{"race_type": fx.Trail.Id, "distance_km": 15},
			},
			"join": map[string]any{"format_index": 0, "status": "registered"},
		}))
		if got := counted.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want the batch alone", got)
		}
		if got := counted.Total() - counted.Of(http.MethodGet) - counted.Of(http.MethodPost); got != 0 {
			t.Errorf("%d other writes, want none", got)
		}

		s := result.Structured
		id, _ := s["id"].(string)
		if s["name"] != "Trail des Monts" || s["start_date"] != "2026-09-12" || s["end_date"] != "2026-09-13" {
			t.Errorf("the race is %v, %v to %v; want « Trail des Monts », 2026-09-12 to 2026-09-13", s["name"], s["start_date"], s["end_date"])
		}
		if s["url"] != siteURL+"/evenements/"+id {
			t.Errorf("url = %v", s["url"])
		}
		assertJSON(t, s["created_by"], runnerRef(fx.AliceRunner))
		if !strings.Contains(summaryOfResult(result), "Trail des Monts") {
			t.Errorf("the summary is %q", summaryOfResult(result))
		}
		if _, ok := s["warnings"]; ok {
			t.Errorf("warnings: %v", s["warnings"])
		}

		formats := formatsOf(t, result)
		if len(formats) != 2 || formats[0]["title"] != "Trail 15 km" || formats[1]["title"] != "Trail 42 km" {
			t.Fatalf("the formats are %v", formats)
		}
		participants, _ := formats[1]["participants"].([]any)
		if len(participants) != 1 {
			t.Fatalf("the 42 km has %d participants, want Alice", len(participants))
		}
		p := participants[0].(map[string]any)
		if p["status"] != "registered" || p["confirmed"] != true {
			t.Errorf("Alice's participation is %v", p)
		}
		assertJSON(t, p["runner"], runnerRef(fx.AliceRunner))

		record := storedRecord(t, app, "events", id)
		if record == nil || record.GetString("created_by") != fx.AliceRunner.Id {
			t.Errorf("the stored race is %v, want it made by Alice", record)
		}
	})

	t.Run("a format dated three weeks later: a warning", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "create_event", map[string]any{
			"name": "Grande Traversée des Alpes", "location": "Genève", "start_date": "2026-10-03",
			"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 400, "date": "2026-10-24"}},
		}))
		assertJSON(t, result.Structured["warnings"], []any{"Plus de deux semaines : vérifie les dates des épreuves."})
	})

	base := func(change func(map[string]any)) map[string]any {
		args := map[string]any{
			"name": "Corrida de Noël", "location": "Lyon", "start_date": "2026-12-20",
			"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 42}},
		}
		change(args)
		return args
	}

	t.Run("an unknown race type: the list of the types", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			a["formats"] = []any{map[string]any{"race_type": "Trial", "distance_km": 10}}
		}), "Épreuve 1, type de course inconnu : « Trial ». Les types de course : Backyard, Cross, Hyrox, Route, Trail, Ultra-trail.")
	})

	t.Run("a format without a measure", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			a["formats"] = []any{map[string]any{"race_type": "Trail", "elevation_gain_m": 300}}
		}), "Épreuve 1 (« Trail »), distance : indique au moins une distance, une durée ou un temps max. (format_measure_required)")
	})

	t.Run("a deadline after the start", func(t *testing.T) {
		refused(t, app, alice, "create_event", base(func(a map[string]any) { a["registration_deadline"] = "2026-12-21" }),
			"La course, date limite d'inscription : la date limite d'inscription doit être au plus tard le jour du début. (registration_deadline_after_start)")
	})

	// The form does not send it (the date of a format has the start as its
	// minimum): announced, in the site's words, before any confirmation.
	t.Run("a format dated before the start", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			a["formats"] = []any{map[string]any{"race_type": "Trail", "distance_km": 42, "date": "2026-12-19"}}
		}), "Épreuve 1 (« Trail 42 km »), date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range)")
	})

	t.Run("a format dated before the start of a race that has a duplicate: refused, not confirmed", func(t *testing.T) {
		announced(t, app, alice, "create_event", map[string]any{
			"name": "Trail des Crêtes", "location": "Annecy", "start_date": "2026-06-20",
			"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 20, "date": "2026-06-19"}},
		}, "(format_date_out_of_range)")
	})

	t.Run("no format", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["formats"] = []any{} }),
			"Une course a au moins une épreuve")
	})

	t.Run("21 formats", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			var formats []any
			for i := range 21 {
				formats = append(formats, map[string]any{"race_type": "Route", "distance_km": i + 1})
			}
			a["formats"] = formats
		}), "20 épreuves au plus")
	})

	t.Run("join on a format that is not there", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			a["join"] = map[string]any{"format_index": 1, "status": "interested"}
		}), "join.format_index : il n'y a pas d'épreuve 1")
	})

	t.Run("a day that is no day", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["start_date"] = "20/12/2026" }),
			"start_date : « 20/12/2026 » n'est pas un jour valide (AAAA-MM-JJ).")
	})

	t.Run("a status that is not one: the schema", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := callTool(t, app, alice, "create_event", base(func(a map[string]any) {
				a["join"] = map[string]any{"format_index": 0, "status": "supporter"}
			}))
			if !result.IsError {
				t.Errorf("a supporter on a format is answered %.200s", result.Text)
			}
		})
	})
}

func TestTools_UpdateEvent(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	bob := newToken(t, app, fx.Bob)
	update(t, app, fx.Event, map[string]any{"registration_url": "https://inscriptions.example.test/cretes"})
	f42, f15 := storedRecord(t, app, "formats", fx.F42.Id), storedRecord(t, app, "formats", fx.F15.Id)

	// Any member may edit a race, as on the site: Bob edits Alice's.
	result := isDone(t, callTool(t, app, bob, "update_event", map[string]any{
		"event_id": fx.Event.Id, "name": "Trail des Crêtes 2026", "location": " Annecy-le-Vieux ",
	}))
	s := result.Structured
	if s["name"] != "Trail des Crêtes 2026" || s["location"] != "Annecy-le-Vieux" {
		t.Errorf("the race is %v in %v", s["name"], s["location"])
	}
	// The fields that were not given do not change.
	if s["start_date"] != "2026-06-13" || s["end_date"] != "2026-06-14" || s["registration_url"] != "https://inscriptions.example.test/cretes" {
		t.Errorf("the race is %v to %v, %v", s["start_date"], s["end_date"], s["registration_url"])
	}
	// Its author stays Alice.
	assertJSON(t, s["created_by"], runnerRef(fx.AliceRunner))
	if got := storedRecord(t, app, "events", fx.Event.Id).GetString("created_by"); got != fx.AliceRunner.Id {
		t.Errorf("the race is made by %q now", got)
	}
	// Renaming writes no format.
	for _, before := range []*core.Record{f42, f15} {
		if after := storedRecord(t, app, "formats", before.Id); after.GetString("updated") != before.GetString("updated") {
			t.Errorf("the format %s was written", before.Id)
		}
	}

	t.Run("a format that is not of the race", func(t *testing.T) {
		announced(t, app, bob, "update_event", map[string]any{
			"event_id": fx.Event.Id, "formats": []any{map[string]any{"format_id": fx.FLyon.Id, "distance_km": 11}},
		}, "n'est pas une épreuve de « Trail des Crêtes 2026 »")
	})

	t.Run("a race that is not there", func(t *testing.T) {
		announced(t, app, bob, "update_event", map[string]any{"event_id": "aaaaaaaaaaaaaaa", "name": "X"},
			"Introuvable : il a peut-être été supprimé.")
	})

	t.Run("a name cleared: the site refuses it", func(t *testing.T) {
		refused(t, app, bob, "update_event", map[string]any{"event_id": fx.Event.Id, "name": " "},
			"La course, nom : ce champ est obligatoire. (validation_required)")
	})

	// A race always has a first day: the form's field is required, and the
	// start is what the days of the formats are read from.
	t.Run("the start cleared", func(t *testing.T) {
		announced(t, app, bob, "update_event", map[string]any{"event_id": fx.Event.Id, "start_date": " "},
			"start_date ne s'efface pas : une course a toujours un premier jour (AAAA-MM-JJ).")
	})

	// Nothing to write: nothing is written, not even the race as it was read.
	t.Run("nothing changes", func(t *testing.T) {
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, bob, "update_event", map[string]any{"event_id": fx.Event.Id, "name": "Trail des Crêtes 2026"}))
			if want := "Rien à changer : « Trail des Crêtes 2026 » est déjà ainsi."; summaryOfResult(result) != want {
				t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
			}
		})
	})

	// A field of the race is written alone: the others, read before, are not
	// written back over a change that somebody else made meanwhile.
	t.Run("only what changes is written", func(t *testing.T) {
		var sent map[string]any
		app.OnRecordUpdateRequest("events").BindFunc(func(e *core.RecordRequestEvent) error {
			info, err := e.RequestInfo()
			if err != nil {
				return err
			}
			sent = info.Body
			return e.Next()
		})
		isDone(t, callTool(t, app, bob, "update_event", map[string]any{"event_id": fx.Event.Id, "notes": "Navette depuis la gare."}))
		if want := map[string]any{"notes": "Navette depuis la gare."}; fmt.Sprint(sent) != fmt.Sprint(want) {
			t.Errorf("the update of the race sent %v, want %v", sent, want)
		}
	})
}

// A race moved with its dated format, in one call, as the form does: the format
// waits for the race, then gets its day. F15, which has no date, goes with the
// first day.
func TestTools_UpdateEvent_MovesTheRaceWithItsFormats(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	args := map[string]any{
		"event_id": fx.Event.Id, "start_date": "2026-06-20",
		"formats": []any{map[string]any{"format_id": fx.F42.Id, "date": "2026-06-21"}},
	}

	// The start alone: F42 would be dated before it. The site refuses that, and
	// the form does not send it: announced, with no confirmation of an outcome
	// that cannot be.
	t.Run("the start alone, a dated format left behind", func(t *testing.T) {
		announced(t, app, alice, "update_event", map[string]any{"event_id": fx.Event.Id, "start_date": "2026-06-20"},
			"Épreuve 2 (« Trail 42 km »), date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range) "+
				"Pour déplacer la course avec ses épreuves datées, donne à chacune son nouveau jour dans formats (update_event).")
	})

	// F42 and F15 have participants, whose day changes.
	writesNothing(t, app, func() {
		_, message, details := asked(t, callTool(t, app, alice, "update_event", args))
		mentions(t, message, details,
			"« Trail 42 km » passerait du 2026-06-14 au 2026-06-21", "Alice (Inscrit)", "Bob (Intéressé, non confirmé)",
			"« Trail 15 km » passerait du 2026-06-13 au 2026-06-20", "Sam (Intéressé, non confirmé)")
	})

	counted := mcp.CountInnerRequests(t)
	result := confirmAndCall(t, app, alice, "update_event", args)
	if got := counted.Of(http.MethodPost); got != 1 {
		t.Errorf("%d POST, want the batch alone", got)
	}
	s := result.Structured
	if s["start_date"] != "2026-06-20" || s["end_date"] != "2026-06-21" {
		t.Errorf("the race is %v to %v, want 2026-06-20 to 2026-06-21", s["start_date"], s["end_date"])
	}
	days := map[string]string{}
	for _, f := range formatsOf(t, result) {
		days[f["id"].(string)] = fmt.Sprint(f["day"])
	}
	if days[fx.F42.Id] != "2026-06-21" || days[fx.F15.Id] != "2026-06-20" {
		t.Errorf("the days of the formats are %v", days)
	}
	if got := storedRecord(t, app, "formats", fx.F42.Id).GetString("date"); got != "2026-06-21" {
		t.Errorf("F42 is stored on %q", got)
	}
	if got := storedRecord(t, app, "formats", fx.F15.Id).GetString("date"); got != "" {
		t.Errorf("F15 is stored on %q, want no date", got)
	}
}

func TestTools_DeleteEvent(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)
	comment := create(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.BobRunner.Id, "body": "J'y serai."})
	offer := create(t, app, "offers", map[string]any{"event": fx.Event.Id, "kind": "ride", "owner": fx.BobRunner.Id, "place": "Lyon", "seats": 3})

	t.Run("Bob, on Alice's race: refused before any confirmation", func(t *testing.T) {
		announced(t, app, bob, "delete_event", map[string]any{"event_id": fx.Event.Id},
			"Seule la personne qui a créé la course, Alice, ou un admin peut la supprimer.")
	})

	// The message is what the assistant shows the person: it names who is
	// registered, and not only how many.
	t.Run("Alice: a confirmation that says what goes with it", func(t *testing.T) {
		writesNothing(t, app, func() {
			_, message, _ := asked(t, callTool(t, app, alice, "delete_event", map[string]any{"event_id": fx.Event.Id}))
			mentions(t, message, nil,
				"« Trail des Crêtes » (2026-06-13 au 2026-06-14, Annecy)", "2 épreuves", "3 participations", "1 commentaire", "1 offre",
				"« Trail 42 km » : Alice (Inscrit), Bob (Intéressé, non confirmé)", "« Trail 15 km » : Sam (Intéressé, non confirmé)")
		})
	})

	t.Run("with it: the race and all it holds are gone", func(t *testing.T) {
		result := confirmAndCall(t, app, alice, "delete_event", map[string]any{"event_id": fx.Event.Id})
		assertJSON(t, result.Structured["removed"], map[string]any{"id": fx.Event.Id, "name": "Trail des Crêtes", "start_date": "2026-06-13"})
		if !strings.Contains(summaryOfResult(result), "Trail des Crêtes") {
			t.Errorf("the summary is %q", summaryOfResult(result))
		}
		for _, r := range []*core.Record{fx.Event, fx.F42, fx.F15, fx.P1, fx.P2, fx.P3, comment, offer} {
			if storedRecord(t, app, r.Collection().Name, r.Id) != nil {
				t.Errorf("the %s %s is still there", r.Collection().Name, r.Id)
			}
		}
	})

	t.Run("the admin, on Bob's race", func(t *testing.T) {
		confirmAndCall(t, app, admin, "delete_event", map[string]any{"event_id": fx.Event2.Id})
		if storedRecord(t, app, "events", fx.Event2.Id) != nil {
			t.Error("the race of Bob is still there")
		}
	})

	t.Run("a race that is not there", func(t *testing.T) {
		announced(t, app, alice, "delete_event", map[string]any{"event_id": fx.Event.Id}, "Introuvable : il a peut-être été supprimé.")
	})
}
