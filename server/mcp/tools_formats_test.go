package mcp_test

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/mcp"
	"courses/server/testutil"
)

// formatIn is the format of id in an answer that has the race.
func formatIn(t testing.TB, result toolResult, id string) map[string]any {
	t.Helper()
	for _, f := range formatsOf(t, result) {
		if f["id"] == id {
			return f
		}
	}
	t.Fatalf("no format %s in the answer", id)
	return nil
}

// A format moved past the end of its race: the race ends with it, in one call.
func TestTools_UpdateFormat_MovesTheEndInOneCall(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	t.Run("the day of a format that has participants: a confirmation, then the race ends with it", func(t *testing.T) {
		args := map[string]any{"format_id": fx.F42.Id, "date": "2026-06-16"}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_format", args))
			mentions(t, message, details, "« Trail 42 km » passerait du 2026-06-14 au 2026-06-16", "Alice (Inscrit)", "Bob (Intéressé, non confirmé)")
		})
		counted := mcp.CountInnerRequests(t)
		result := confirmAndCall(t, app, alice, "update_format", args)
		if got := counted.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want the batch alone", got)
		}
		if result.Structured["end_date"] != "2026-06-16" {
			t.Errorf("the race ends on %v, want 2026-06-16", result.Structured["end_date"])
		}
		if got := formatIn(t, result, fx.F42.Id)["date"]; got != "2026-06-16" {
			t.Errorf("F42 is on %v", got)
		}
		if !strings.Contains(summaryOfResult(result), "Trail 42 km") {
			t.Errorf("the summary is %q", summaryOfResult(result))
		}
	})

	t.Run("another race type: written at once", func(t *testing.T) {
		event := storedRecord(t, app, "events", fx.Event.Id)
		result := isDone(t, callTool(t, app, alice, "update_format", map[string]any{"format_id": fx.F42.Id, "race_type": "Cross"}))
		f := formatIn(t, result, fx.F42.Id)
		assertJSON(t, f["race_type"], map[string]any{"id": fx.Cross.Id, "label": "Cross"})
		// The other fields stay.
		if f["distance_km"] != float64(42) || f["elevation_gain_m"] != float64(2400) || f["date"] != "2026-06-16" {
			t.Errorf("F42 is now %v", f)
		}
		// The race does not change: it is not written.
		if after := storedRecord(t, app, "events", fx.Event.Id); after.GetString("updated") != event.GetString("updated") {
			t.Error("the race was written back")
		}
	})

	t.Run("a day before the start of the race", func(t *testing.T) {
		announced(t, app, alice, "update_format", map[string]any{"format_id": fx.F42.Id, "date": "2026-06-12"},
			"(« Cross 42 km »), date de l'épreuve : la date de l'épreuve doit être comprise dans les dates de l'événement. (format_date_out_of_range)")
	})

	t.Run("no measure left: refused", func(t *testing.T) {
		announced(t, app, alice, "update_format", map[string]any{"format_id": fx.F42.Id, "distance_km": 0},
			"(« Cross »), distance : indique au moins une distance, une durée ou un temps max. (format_measure_required)")
	})

	t.Run("a format that is not there", func(t *testing.T) {
		announced(t, app, alice, "update_format", map[string]any{"format_id": "aaaaaaaaaaaaaaa", "distance_km": 10},
			"Introuvable : il a peut-être été supprimé.")
	})
}

// Any member adds a format to any race, as on the site.
func TestTools_AddFormat(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	bob := newToken(t, app, fx.Bob)
	f42, f15 := storedRecord(t, app, "formats", fx.F42.Id), storedRecord(t, app, "formats", fx.F15.Id)

	result := isDone(t, callTool(t, app, bob, "add_format", map[string]any{
		"event_id": fx.Event.Id, "race_type": "Trail", "name": " Le grand tour ", "distance_km": 60, "date": "2026-06-15",
	}))
	if result.Structured["end_date"] != "2026-06-15" {
		t.Errorf("the race ends on %v, want 2026-06-15", result.Structured["end_date"])
	}
	formats := formatsOf(t, result)
	if len(formats) != 3 || formats[2]["title"] != "Le grand tour" || formats[2]["date"] != "2026-06-15" {
		t.Errorf("the formats are %v", formats)
	}
	if !strings.Contains(summaryOfResult(result), "Le grand tour") {
		t.Errorf("the summary is %q", summaryOfResult(result))
	}
	for _, before := range []*core.Record{f42, f15} {
		if after := storedRecord(t, app, "formats", before.Id); after.GetString("updated") != before.GetString("updated") {
			t.Errorf("the format %s was written", before.Id)
		}
	}
	if got := storedRecord(t, app, "events", fx.Event.Id).GetString("created_by"); got != fx.AliceRunner.Id {
		t.Errorf("the race is made by %q now", got)
	}

	t.Run("without a measure", func(t *testing.T) {
		announced(t, app, bob, "add_format", map[string]any{"event_id": fx.Event.Id, "race_type": "Trail"},
			"distance : indique au moins une distance, une durée ou un temps max. (format_measure_required)")
	})

	// A race whose last day was set by hand (v4), its formats undated: the form
	// gives it the end of its formats, which shortens it. add_format asks first.
	t.Run("a race whose end comes from no format: a confirmation", func(t *testing.T) {
		v4 := create(t, app, "events", map[string]any{"name": "Raid du Vercors", "location": "Villard", "start_date": "2026-07-10", "end_date": "2026-07-12", "created_by": fx.AliceRunner.Id})
		create(t, app, "formats", map[string]any{"event": v4.Id, "race_type": fx.Trail.Id, "distance_km": 50})
		args := map[string]any{"event_id": v4.Id, "race_type": "Trail", "distance_km": 20}
		writesNothing(t, app, func() {
			_, message, _ := asked(t, callTool(t, app, bob, "add_format", args))
			mentions(t, message, nil, "La course serait raccourcie : avant, du 2026-07-10 au 2026-07-12 ; après, le 2026-07-10.",
				"Pour garder ces jours, donne sa date à l'épreuve du dernier jour.")
		})
		result := confirmAndCall(t, app, bob, "add_format", args)
		if _, ok := result.Structured["end_date"]; ok {
			t.Errorf("the race ends on %v, want one day", result.Structured["end_date"])
		}
	})
}

func TestTools_DeleteFormat(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)
	f10 := create(t, app, "formats", map[string]any{"event": fx.Event.Id, "race_type": fx.Trail.Id, "distance_km": 10})

	t.Run("Bob, on a format of Alice's race: refused before any confirmation", func(t *testing.T) {
		announced(t, app, bob, "delete_format", map[string]any{"format_id": fx.F15.Id},
			"Seule la personne qui a créé la course, Alice, ou un admin peut supprimer une de ses épreuves.")
	})

	t.Run("Alice: a confirmation that names who is on it", func(t *testing.T) {
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "delete_format", map[string]any{"format_id": fx.F42.Id}))
			mentions(t, message, details, "Alice (Inscrit)", "Bob (Intéressé, non confirmé)",
				// The race then ends on its first day.
				"raccourcie")
		})
	})

	t.Run("with it: the format and its participations are gone, the end follows", func(t *testing.T) {
		result := confirmAndCall(t, app, alice, "delete_format", map[string]any{"format_id": fx.F42.Id})
		for _, r := range []*core.Record{fx.F42, fx.P1, fx.P2} {
			if storedRecord(t, app, r.Collection().Name, r.Id) != nil {
				t.Errorf("the %s %s is still there", r.Collection().Name, r.Id)
			}
		}
		if _, ok := result.Structured["end_date"]; ok {
			t.Errorf("the race ends on %v, want a race of one day", result.Structured["end_date"])
		}
		if got := storedRecord(t, app, "events", fx.Event.Id).GetString("end_date"); got != "" {
			t.Errorf("the race is stored with the end %q", got)
		}
		if len(formatsOf(t, result)) != 2 {
			t.Errorf("the formats are %v", formatsOf(t, result))
		}
	})

	t.Run("the last format of a race", func(t *testing.T) {
		announced(t, app, bob, "delete_format", map[string]any{"format_id": fx.FLyon.Id}, "Une course garde au moins une épreuve.")
	})

	t.Run("the admin, on a format of Alice's race", func(t *testing.T) {
		confirmAndCall(t, app, admin, "delete_format", map[string]any{"format_id": fx.F15.Id})
		if storedRecord(t, app, "formats", fx.F15.Id) != nil || storedRecord(t, app, "participations", fx.P3.Id) != nil {
			t.Error("F15 or its participation is still there")
		}
		if storedRecord(t, app, "formats", f10.Id) == nil {
			t.Error("the other format is gone")
		}
	})

	t.Run("a format that is not there", func(t *testing.T) {
		announced(t, app, alice, "delete_format", map[string]any{"format_id": fx.F42.Id}, "Introuvable : il a peut-être été supprimé.")
	})
}
