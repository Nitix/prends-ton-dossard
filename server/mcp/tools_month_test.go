package mcp_test

import (
	"slices"
	"strings"
	"testing"

	"courses/server/mcp"
	"courses/server/testutil"
)

// A race that is known by its month only (spec § 5 and § 12 of v7): created and
// changed through date_precision, said by search_events and get_event, and a move
// to a month that erases the days of formats asks first.

const monthFormatRefusal = "Épreuve 1 (« Trail 42 km »), date de l'épreuve : une course dont seul le mois est connu n'a pas de date d'épreuve. (format_date_month)" +
	" Donne la date de la course (date_precision: day) pour dater ses épreuves."

func TestTools_CreateEvent_MonthPrecision(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	base := func(change func(map[string]any)) map[string]any {
		args := map[string]any{
			"name": "Trail de juin", "location": "Annecy", "start_date": "2027-06", "date_precision": "month",
			"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 42}},
		}
		change(args)
		return args
	}

	t.Run("a month is the 1st, to the last day of the month", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "create_event", base(func(map[string]any) {})))
		for field, want := range map[string]any{
			"start_date": "2027-06-01", "end_date": "2027-06-30", "date_precision": "month",
		} {
			if result.Structured[field] != want {
				t.Errorf("the race says %s = %v, want %v", field, result.Structured[field], want)
			}
		}
		// The race of a month has no day of its own: its format is the 1st, and says no date.
		formats := formatsOf(t, result)
		if len(formats) != 1 || formats[0]["day"] != "2027-06-01" {
			t.Errorf("the formats are %v, want one on the 1st", formats)
		}
		record := storedRecord(t, app, "events", result.Structured["id"].(string))
		if record.GetString("date_precision") != "month" || record.GetString("start_date") != "2027-06-01" || record.GetString("end_date") != "2027-06-30" {
			t.Errorf("the stored race is %q from %q to %q", record.GetString("date_precision"), record.GetString("start_date"), record.GetString("end_date"))
		}
	})

	t.Run("the 1st is fine too, and the month of the days of a leap year", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "create_event", base(func(a map[string]any) {
			a["name"] = "Cross de février"
			a["start_date"] = "2028-02-01"
		})))
		if result.Structured["end_date"] != "2028-02-29" {
			t.Errorf("the race ends on %v, want 2028-02-29", result.Structured["end_date"])
		}
	})

	t.Run("a deadline and an opening can fall in the month", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "create_event", base(func(a map[string]any) {
			a["name"] = "Foulées d'été"
			a["registration_deadline"] = "2027-06-20"
			a["registration_opening"] = "2027-06-10"
		})))
		if result.Structured["registration_deadline"] != "2027-06-20" || result.Structured["registration_opening"] != "2027-06-10" {
			t.Errorf("the race says %v and %v", result.Structured["registration_deadline"], result.Structured["registration_opening"])
		}
	})

	t.Run("an opening after the month", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["registration_opening"] = "2027-07-01" }),
			"La course, ouverture des inscriptions : l'ouverture des inscriptions doit être au plus tard le jour du début. (registration_opening_after_start)")
	})

	t.Run("a day that is not the 1st", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["start_date"] = "2027-06-15" }),
			"La course, date de début : pour une course dont seul le mois est connu, la date est le 1er du mois. (month_start_invalid)")
	})

	t.Run("a format with a date is refused before any write", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) {
			a["formats"] = []any{map[string]any{"race_type": "Trail", "distance_km": 42, "date": "2027-06-10"}}
		}), monthFormatRefusal)
	})

	t.Run("a month is not a day for a race that has its day", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { delete(a, "date_precision") }),
			"start_date : « 2027-06 » n'est pas un jour valide (AAAA-MM-JJ).")
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["date_precision"] = "day" }),
			"start_date : « 2027-06 » n'est pas un jour valide (AAAA-MM-JJ).")
	})

	t.Run("a month that is not one", func(t *testing.T) {
		announced(t, app, alice, "create_event", base(func(a map[string]any) { a["start_date"] = "2027-13" }),
			"start_date : « 2027-13 » n'est pas un mois valide (AAAA-MM).")
	})

	t.Run("a day precision is a race with a day", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "create_event", base(func(a map[string]any) {
			a["name"] = "Corrida de Noël"
			a["start_date"] = "2027-06-12"
			a["date_precision"] = "day"
		})))
		if _, ok := result.Structured["date_precision"]; ok {
			t.Errorf("a race with a day says its precision: %v", result.Structured["date_precision"])
		}
	})
}

// A race that becomes a month loses the days of its formats, and the people on
// them: the tool asks first. Going back to a day loses nothing.
func TestTools_UpdateEvent_ToMonthAsksFirst(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)
	args := map[string]any{"event_id": fx.Event.Id, "date_precision": "month"}

	writesNothing(t, app, func() {
		_, message, details := asked(t, callTool(t, app, alice, "update_event", args))
		// F42 has its day, the 14th, and Alice and Bob on it; F15 has no day: nothing is lost there.
		mentions(t, message, details, "Trail 42 km", "2026-06-14", "Alice", "Bob")
		if all := message + strings.Join(details, " "); strings.Contains(all, "Trail 15 km") {
			t.Errorf("the confirmation names a format that has no day: %s", redact(all))
		}
	})
	// The month the race is in.
	result := confirmAndCall(t, app, alice, "update_event", args)
	for field, want := range map[string]any{"start_date": "2026-06-01", "end_date": "2026-06-30", "date_precision": "month"} {
		if result.Structured[field] != want {
			t.Errorf("the race says %s = %v, want %v", field, result.Structured[field], want)
		}
	}
	if got := storedRecord(t, app, "formats", fx.F42.Id).GetString("date"); got != "" {
		t.Errorf("the 42 km still has the day %q", got)
	}
	// What people entered is still there: they are on the race.
	if storedRecord(t, app, "participations", fx.P1.Id) == nil || storedRecord(t, app, "participations", fx.P2.Id) == nil {
		t.Error("a participation is gone")
	}

	// Another change of a month does not ask: nothing is lost.
	isDone(t, callTool(t, app, alice, "update_event", map[string]any{"event_id": fx.Event.Id, "name": "Trail de juin"}))

	// Back to a day: nothing is lost, nothing asks, and the formats can be dated.
	result = isDone(t, callTool(t, app, alice, "update_event", map[string]any{
		"event_id": fx.Event.Id, "date_precision": "day", "start_date": "2026-06-12",
		"formats": []any{map[string]any{"format_id": fx.F42.Id, "date": "2026-06-13"}},
	}))
	if _, ok := result.Structured["date_precision"]; ok {
		t.Errorf("the race still says its precision: %v", result.Structured["date_precision"])
	}
	if result.Structured["start_date"] != "2026-06-12" || result.Structured["end_date"] != "2026-06-13" {
		t.Errorf("the race is from %v to %v, want 2026-06-12 to 2026-06-13", result.Structured["start_date"], result.Structured["end_date"])
	}
	if got := storedRecord(t, app, "formats", fx.F42.Id).GetString("date"); got != "2026-06-13" {
		t.Errorf("the 42 km is on %q, want 2026-06-13", got)
	}
}

func TestTools_UpdateEvent_ToMonth(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	t.Run("no day to lose: no confirmation", func(t *testing.T) {
		// The 10 km of Lyon has no day of its own.
		result := isDone(t, callTool(t, app, alice, "update_event", map[string]any{
			"event_id": fx.Event2.Id, "date_precision": "month", "start_date": "2026-07",
		}))
		if result.Structured["start_date"] != "2026-07-01" || result.Structured["end_date"] != "2026-07-31" || result.Structured["date_precision"] != "month" {
			t.Errorf("the race is %v from %v to %v", result.Structured["date_precision"], result.Structured["start_date"], result.Structured["end_date"])
		}
	})

	t.Run("a day given to a format of a month is refused before any write", func(t *testing.T) {
		announced(t, app, alice, "update_event", map[string]any{
			"event_id": fx.Event2.Id,
			"formats":  []any{map[string]any{"format_id": fx.FLyon.Id, "date": "2026-07-10"}},
		}, "Épreuve 1 (« Route 10 km »), date de l'épreuve : une course dont seul le mois est connu n'a pas de date d'épreuve. (format_date_month)"+
			" Donne la date de la course (date_precision: day) pour dater ses épreuves.")
		announced(t, app, alice, "update_format", map[string]any{"format_id": fx.FLyon.Id, "date": "2026-07-10"},
			"Épreuve 1 (« Route 10 km »), date de l'épreuve : une course dont seul le mois est connu n'a pas de date d'épreuve. (format_date_month)"+
				" Donne la date de la course (date_precision: day) pour dater ses épreuves.")
		announced(t, app, alice, "add_format", map[string]any{
			"event_id": fx.Event2.Id, "race_type": "Trail", "distance_km": 20, "date": "2026-07-10",
		}, "Épreuve 2 (« Trail 20 km »), date de l'épreuve : une course dont seul le mois est connu n'a pas de date d'épreuve. (format_date_month)"+
			" Donne la date de la course (date_precision: day) pour dater ses épreuves.")
	})

	t.Run("a format without a date can be added to a month", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "add_format", map[string]any{
			"event_id": fx.Event2.Id, "race_type": "Trail", "distance_km": 20,
		}))
		if result.Structured["end_date"] != "2026-07-31" {
			t.Errorf("the race ends on %v, want 2026-07-31", result.Structured["end_date"])
		}
	})

	t.Run("a month moved to another month asks nothing when nobody is on it", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "update_event", map[string]any{"event_id": fx.Event2.Id, "start_date": "2026-08"}))
		if result.Structured["start_date"] != "2026-08-01" || result.Structured["end_date"] != "2026-08-31" {
			t.Errorf("the race is from %v to %v", result.Structured["start_date"], result.Structured["end_date"])
		}
	})

	t.Run("a month is not a precision that exists", func(t *testing.T) {
		result := callTool(t, app, alice, "update_event", map[string]any{"event_id": fx.Event2.Id, "date_precision": "year"})
		if !result.IsError {
			t.Errorf("date_precision year was accepted: %.200s", redact(result.Text))
		}
	})
}

func TestTools_SearchEvents_MonthPrecision(t *testing.T) {
	mcp.SetNow(t, at(2026, 6, 1, 10, 0))
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)
	june := create(t, app, "events", map[string]any{
		"name": "A trail de juin", "location": "Annecy", "start_date": "2026-06-01", "date_precision": "month",
		"created_by": fx.AliceRunner.Id,
	})
	create(t, app, "formats", map[string]any{"event": june.Id, "race_type": fx.Trail.Id, "distance_km": 10})
	lastDay := create(t, app, "events", map[string]any{
		"name": "Z course du 30", "location": "Lyon", "start_date": "2026-06-30", "created_by": fx.AliceRunner.Id,
	})
	create(t, app, "formats", map[string]any{"event": lastDay.Id, "race_type": fx.Trail.Id, "distance_km": 10})

	events := succeeded(t, callTool(t, app, alice, "search_events", nil)).Structured["events"].([]any)
	ids := []string{}
	for _, e := range events {
		ids = append(ids, e.(map[string]any)["id"].(string))
	}
	// At the end of its month: after every race of June, even the one of the 30th, which
	// ends the same day.
	if want := []string{fx.Event.Id, fx.Event2.Id, lastDay.Id, june.Id}; !slices.Equal(ids, want) {
		t.Errorf("the races are %v, want %v", ids, want)
	}
	for _, e := range events {
		event := e.(map[string]any)
		switch event["id"] {
		case june.Id:
			if event["date_precision"] != "month" || event["start_date"] != "2026-06-01" || event["end_date"] != "2026-06-30" {
				t.Errorf("the race of a month says %v from %v to %v", event["date_precision"], event["start_date"], event["end_date"])
			}
		default:
			if _, ok := event["date_precision"]; ok {
				t.Errorf("a race with a day says its precision: %v", event["date_precision"])
			}
		}
	}

	// The same key, backwards, for the races that are over.
	mcp.SetNow(t, at(2026, 7, 5, 10, 0))
	past := succeeded(t, callTool(t, app, alice, "search_events", map[string]any{"period": "past"})).Structured["events"].([]any)
	got := []string{}
	for _, e := range past {
		got = append(got, e.(map[string]any)["id"].(string))
	}
	if want := []string{june.Id, lastDay.Id, fx.Event2.Id, fx.Event.Id}; !slices.Equal(got, want) {
		t.Errorf("the races that are over are %v, want %v", got, want)
	}
}

func TestTools_GetEvent_MonthPrecision(t *testing.T) {
	mcp.SetNow(t, at(2026, 6, 14, 10, 0))
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	alice := newToken(t, app, fx.Alice)
	june := create(t, app, "events", map[string]any{
		"name": "Trail de juin", "location": "Annecy", "start_date": "2027-06-01", "date_precision": "month",
		"created_by": fx.AliceRunner.Id,
	})
	create(t, app, "formats", map[string]any{"event": june.Id, "race_type": fx.Trail.Id, "distance_km": 10})

	got := succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": june.Id})).Structured
	for field, want := range map[string]any{"date_precision": "month", "start_date": "2027-06-01", "end_date": "2027-06-30"} {
		if got[field] != want {
			t.Errorf("the race says %s = %v, want %v", field, got[field], want)
		}
	}
	formats := got["formats"].([]any)
	if first := formats[0].(map[string]any); first["day"] != "2027-06-01" {
		t.Errorf("the format is on %v, want the 1st", first["day"])
	}

	if dated := succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": fx.Event.Id})).Structured; dated["date_precision"] != nil {
		t.Errorf("a race with a day says its precision: %v", dated["date_precision"])
	}
}
