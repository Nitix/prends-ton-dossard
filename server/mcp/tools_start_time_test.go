package mcp_test

import (
	"testing"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The start time of a format (v7, § 10.7): given by create_event, update_event and
// the format tools, said by get_event and search_events, never on a race known by
// its month.

const monthTimeRefusal = "Épreuve 1 (« Trail 42 km »), heure de départ : une épreuve d'une course au mois n'a pas d'heure de départ. (format_time_month)" +
	" Donne la date de la course (date_precision: day) pour donner l'heure de départ de ses épreuves."

func idOfFormat(t *testing.T, formats []map[string]any, title string) string {
	t.Helper()
	for _, f := range formats {
		if f["title"] == title {
			return f["id"].(string)
		}
	}
	t.Fatalf("no format %q in %v", title, formats)
	return ""
}

func startTimeOf(t *testing.T, formats []map[string]any, title string) any {
	t.Helper()
	for _, f := range formats {
		if f["title"] == title {
			return f["start_time"]
		}
	}
	t.Fatalf("no format %q in %v", title, formats)
	return nil
}

func TestTools_StartTime_CreateReadAndChange(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	created := isDone(t, callTool(t, app, alice, "create_event", map[string]any{
		"name": "Trail du Lac", "location": "Annecy", "start_date": "2026-09-05",
		"formats": []any{
			map[string]any{"race_type": "Trail", "distance_km": 42, "start_time": "07:30"},
			map[string]any{"race_type": "Trail", "distance_km": 15},
		},
	}))
	id := created.Structured["id"].(string)
	formats := formatsOf(t, created)
	if got := startTimeOf(t, formats, "Trail 42 km"); got != "07:30" {
		t.Errorf("create_event says the start time %v, want 07:30", got)
	}
	if got := startTimeOf(t, formats, "Trail 15 km"); got != nil {
		t.Errorf("a format with no time says %v, want none", got)
	}
	long, short := idOfFormat(t, formats, "Trail 42 km"), idOfFormat(t, formats, "Trail 15 km")
	stored := storedRecord(t, app, "formats", long)
	if stored.GetString("start_time") != "07:30" {
		t.Errorf("the stored start time is %q", stored.GetString("start_time"))
	}

	// get_event and search_events say it.
	got := succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": id}))
	if v := startTimeOf(t, formatsOf(t, got), "Trail 42 km"); v != "07:30" {
		t.Errorf("get_event says %v, want 07:30", v)
	}
	found := succeeded(t, callTool(t, app, alice, "search_events", map[string]any{"query": "Trail du Lac"}))
	events, _ := found.Structured["events"].([]any)
	if len(events) != 1 {
		t.Fatalf("search_events found %d races, want 1", len(events))
	}
	if v := startTimeOf(t, formatsOf(t, toolResult{Structured: events[0].(map[string]any)}), "Trail 42 km"); v != "07:30" {
		t.Errorf("search_events says %v, want 07:30", v)
	}

	// Another time, through update_format and update_event.
	isDone(t, callTool(t, app, alice, "update_format", map[string]any{"format_id": short, "start_time": "09:00"}))
	if got := storedRecord(t, app, "formats", short).GetString("start_time"); got != "09:00" {
		t.Errorf("update_format left the time %q, want 09:00", got)
	}
	isDone(t, callTool(t, app, alice, "update_event", map[string]any{
		"event_id": id, "formats": []any{map[string]any{"format_id": short, "start_time": "09:30"}},
	}))
	if got := storedRecord(t, app, "formats", short).GetString("start_time"); got != "09:30" {
		t.Errorf("update_event left the time %q, want 09:30", got)
	}

	// A time that is not one is refused before any write.
	announced(t, app, alice, "update_format", map[string]any{"format_id": short, "start_time": "9h30"},
		"start_time : « 9h30 » n'est pas une heure valide (HH:MM, de 00:00 à 23:59).")
	announced(t, app, alice, "create_event", map[string]any{
		"name": "Trail refusé", "location": "Annecy", "start_date": "2026-09-05",
		"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 42, "start_time": "24:00"}},
	}, "start_time : « 24:00 » n'est pas une heure valide (HH:MM, de 00:00 à 23:59).")

	// Clearing a time asks first, like clearing any field.
	args := map[string]any{"format_id": long, "start_time": ""}
	writesNothing(t, app, func() {
		_, message, details := asked(t, callTool(t, app, alice, "update_format", args))
		mentions(t, message, details, "l'heure de départ serait effacée", "07:30")
	})
	confirmAndCall(t, app, alice, "update_format", args)
	if got := storedRecord(t, app, "formats", long).GetString("start_time"); got != "" {
		t.Errorf("the time is still %q after its clearing", got)
	}
}

func TestTools_StartTime_NotForARaceOfAMonth(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	announced(t, app, alice, "create_event", map[string]any{
		"name": "Trail de juin", "location": "Annecy", "start_date": "2027-06", "date_precision": "month",
		"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 42, "start_time": "07:30"}},
	}, monthTimeRefusal)

	// A race that becomes a month loses its times with its days, and says so first.
	f42 := storedRecord(t, app, "formats", fx.F42.Id)
	f42.Set("start_time", "07:30")
	if err := app.Save(f42); err != nil {
		t.Fatal(err)
	}
	args := map[string]any{"event_id": fx.Event.Id, "date_precision": "month"}
	writesNothing(t, app, func() {
		_, message, details := asked(t, callTool(t, app, alice, "update_event", args))
		mentions(t, message, details, "l'heure de départ serait effacée", "07:30")
	})
	confirmAndCall(t, app, alice, "update_event", args)
	if got := storedRecord(t, app, "formats", fx.F42.Id).GetString("start_time"); got != "" {
		t.Errorf("the 42 km still has the time %q on a race of a month", got)
	}

	// And a time cannot be given to a format of it.
	announced(t, app, alice, "update_format", map[string]any{"format_id": fx.F42.Id, "start_time": "08:00"},
		"Épreuve 2 (« Trail 42 km »), heure de départ : une épreuve d'une course au mois n'a pas d'heure de départ. (format_time_month)"+
			" Donne la date de la course (date_precision: day) pour donner l'heure de départ de ses épreuves.")
}
