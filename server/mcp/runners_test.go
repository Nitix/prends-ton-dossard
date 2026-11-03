package mcp_test

import (
	"net/http"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/mcp"
	"courses/server/testutil"
)

func TestTools_GetRunner(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 20, 10, 0))
	alice := newToken(t, app, fx.Alice)

	// Alice has a photo.
	photo, err := filesystem.NewFileFromBytes(testutil.PNG(t, 40, 40), "alice.png")
	if err != nil {
		t.Fatal(err)
	}
	update(t, app, fx.AliceRunner, map[string]any{"avatar": photo})
	stored, err := app.FindRecordById("runners", fx.AliceRunner.Id)
	if err != nil {
		t.Fatal(err)
	}
	avatar := stored.GetString("avatar")
	if avatar == "" {
		t.Fatal("the photo was not saved")
	}

	// She finished the 42 km in 4:12:30, 12th out of 340, with a note...
	update(t, app, fx.P1, map[string]any{
		"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H",
	})
	// ... gave up on a race the year before...
	aravis := create(t, app, "events", map[string]any{"name": "Trail des Aravis", "location": "Thônes", "start_date": "2025-09-14", "created_by": fx.AliceRunner.Id})
	f30 := create(t, app, "formats", map[string]any{"event": aravis.Id, "race_type": fx.Trail.Id, "distance_km": 30, "elevation_gain_m": 1500})
	dnf := create(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": f30.Id, "status": "dnf", "confirmed": true, "added_by": fx.AliceRunner.Id,
		"result_note": "abandon au km 30",
	})
	// ... is interested in the 10 km of Lyon, and does not start the half marathon of Chambéry.
	lyon := create(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": fx.FLyon.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	semi := create(t, app, "events", map[string]any{"name": "Semi de Chambéry", "location": "Chambéry", "start_date": "2026-06-28", "created_by": fx.AliceRunner.Id})
	fSemi := create(t, app, "formats", map[string]any{"event": semi.Id, "race_type": fx.Road.Id, "distance_km": 21.1})
	create(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": fSemi.Id, "status": "dns", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})

	get := func(token string, args map[string]any) toolResult {
		t.Helper()
		return callTool(t, app, token, "get_runner", args)
	}

	t.Run("the page of Alice: her years and her history, the result written as the site does", func(t *testing.T) {
		result := succeeded(t, get(alice, nil))

		assertJSON(t, result.Structured, map[string]any{
			"runner": map[string]any{
				"id": fx.AliceRunner.Id, "name": "Alice", "has_account": true, "is_me": true,
				"url":       siteURL + "/coureurs/" + fx.AliceRunner.Id,
				"photo_url": siteURL + "/api/files/runners/" + fx.AliceRunner.Id + "/" + avatar,
			},
			// Not the half marathon that she does not start.
			"upcoming": []any{map[string]any{
				"participation_id": lyon.Id, "event": eventRefOf(fx.Event2), "format_title": "Route 10 km",
				"day": "2026-06-22", "status": "interested", "status_label": "Intéressé", "confirmed": true,
			}},
			// The latest year first. An abandon only counts as one.
			"years": []any{
				map[string]any{"year": 2026, "finished": 1, "dnf": 0, "distance_km": 42, "elevation_gain_m": 2400, "time_s": 15150},
				map[string]any{"year": 2025, "finished": 0, "dnf": 1, "distance_km": 0, "elevation_gain_m": 0, "time_s": 0},
			},
			// Finished and abandoned, the latest first.
			"history": []any{
				map[string]any{
					"participation_id": fx.P1.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 42 km", "day": "2026-06-14",
					"status": "finished", "status_label": "Terminé",
					"result": "Terminé · 4h 12min 30s · 12e sur 340 · 3e V1H",
				},
				map[string]any{
					"participation_id": dnf.Id, "event": eventRefOf(aravis), "format_title": "Trail 30 km", "day": "2025-09-14",
					"status": "dnf", "status_label": "Abandon",
					"result": "Abandon · abandon au km 30",
				},
			},
			"history_total": 2,
		})
		textIs(t, result)
	})

	t.Run("a result without a time, a rank or a note is the status alone", func(t *testing.T) {
		// Bob finished the 15 km, and has written nothing about it.
		finished := create(t, app, "participations", map[string]any{
			"runner": fx.BobRunner.Id, "format": fx.F15.Id, "status": "finished", "confirmed": true, "added_by": fx.BobRunner.Id,
		})

		result := succeeded(t, get(alice, map[string]any{"runner": "bob"}))

		history := result.Structured["history"].([]any)
		if len(history) != 1 {
			t.Fatalf("%d in the history of Bob, want 1: %v", len(history), history)
		}
		assertJSON(t, history[0], map[string]any{
			"participation_id": finished.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 15 km", "day": "2026-06-13",
			"status": "finished", "status_label": "Terminé", "result": "Terminé",
		})
		// His interested participation (P2) is behind him, the race being over: not to come.
		assertJSON(t, result.Structured["upcoming"], []any{})
	})

	t.Run("another runner, by name or by id, who has no account and no photo", func(t *testing.T) {
		for _, runner := range []string{"Sam", "  sam ", fx.SamRunner.Id} {
			result := succeeded(t, get(alice, map[string]any{"runner": runner}))
			assertJSON(t, result.Structured["runner"], map[string]any{
				"id": fx.SamRunner.Id, "name": "Sam", "has_account": false, "is_me": false,
				"url": siteURL + "/coureurs/" + fx.SamRunner.Id,
			})
			// The lists are empty, not null.
			assertJSON(t, result.Structured["years"], []any{})
			assertJSON(t, result.Structured["history"], []any{})
			assertJSON(t, result.Structured["history_total"], 0)
		}
	})

	t.Run("the races to come of another runner, as the site shows them", func(t *testing.T) {
		mcp.SetNow(t, at(2026, 6, 1, 10, 0))
		result := succeeded(t, get(alice, map[string]any{"runner": "Sam"}))
		assertJSON(t, result.Structured["upcoming"], []any{map[string]any{
			"participation_id": fx.P3.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 15 km",
			"day": "2026-06-13", "status": "interested", "status_label": "Intéressé", "confirmed": false,
		}})
	})

	t.Run("no runner given is the runner of the owner of the token", func(t *testing.T) {
		bob := succeeded(t, get(newToken(t, app, fx.Bob), nil))
		runner := bob.Structured["runner"].(map[string]any)
		if runner["id"] != fx.BobRunner.Id || runner["is_me"] != true {
			t.Errorf("the runner is %v, want Bob's, is_me", runner)
		}
		// Whose page it is depends on the token, not on anything else.
		me := succeeded(t, get(alice, map[string]any{"runner": "  "}))
		if got := me.Structured["runner"].(map[string]any)["id"]; got != fx.AliceRunner.Id {
			t.Errorf("blanks are no runner: the page is %v, want Alice's", got)
		}
	})

	t.Run("an unknown runner lists the names", func(t *testing.T) {
		result := get(alice, map[string]any{"runner": "Zoé"})
		want := "Coureur inconnu : « Zoé ». Les coureurs du groupe : Admin, Alice, Bob, Sam."
		if !result.IsError || result.Text != want {
			t.Errorf("isError %v, text %q, want %q", result.IsError, result.Text, want)
		}
	})

	t.Run("a page only reads", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		succeeded(t, get(alice, nil))
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

// The history of a runner is the latest 50 races that they started, and says how
// many there are: a runner with years of races is not answered with all of them.
func TestTools_GetRunner_BoundsTheHistory(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	mcp.SetNow(t, at(2026, 6, 20, 10, 0))

	// 55 races of one event of 55 days, Alice finished each: one a day, from the
	// 1st of January, the time of each being its number.
	event := create(t, app, "events", map[string]any{
		"name": "Le Grand Défi", "location": "Annecy", "start_date": "2026-01-01", "end_date": "2026-02-24", "created_by": fx.AliceRunner.Id,
	})
	first := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	for i := 0; i < 55; i++ {
		format := create(t, app, "formats", map[string]any{
			"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 10, "date": first.AddDate(0, 0, i).Format(time.DateOnly),
		})
		create(t, app, "participations", map[string]any{
			"runner": fx.AliceRunner.Id, "format": format.Id, "status": "finished", "confirmed": true, "added_by": fx.AliceRunner.Id,
			"finish_time_s": 3600 + i,
		})
	}

	result := succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "get_runner", nil))

	history := result.Structured["history"].([]any)
	if len(history) != 50 {
		t.Fatalf("%d races in the history, want the latest 50", len(history))
	}
	if got := result.Structured["history_total"]; got != float64(55) {
		t.Errorf("history_total = %v, want 55", got)
	}
	// The latest first: the 24th of February, and the 6th of January last of the 50.
	if day := history[0].(map[string]any)["day"]; day != "2026-02-24" {
		t.Errorf("the first race of the history is on %v, want the latest, 2026-02-24", day)
	}
	if day := history[49].(map[string]any)["day"]; day != "2026-01-06" {
		t.Errorf("the last race of the history is on %v, want 2026-01-06", day)
	}
	// What is left out of the list is not left out of the year.
	years := result.Structured["years"].([]any)
	if len(years) != 1 || years[0].(map[string]any)["finished"] != float64(55) {
		t.Errorf("the years are %v, want 55 finished in 2026", years)
	}
	textIs(t, result)
}
