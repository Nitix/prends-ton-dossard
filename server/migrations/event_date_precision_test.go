package migrations_test

import (
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/testutil"
)

// The migration 9p adds the precision of the date to the events: "day" or
// "month", empty for a day. Its rollback removes the field and what it holds; the
// events stay, as they are stored (a month is the days from the 1st to the last).
func TestMigrations_EventDatePrecisionDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9p_event_date_precision.go")

	event := func() *core.Record {
		t.Helper()
		return mustFind(t, app, "events", fx.Event2.Id)
	}
	field := func() core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("events")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName("date_precision")
	}
	check := func(when string) {
		t.Helper()
		f, ok := field().(*core.SelectField)
		if !ok {
			t.Fatalf("%s: events.date_precision must be a select field, got %T", when, field())
		}
		if f.Required || f.Hidden || f.MaxSelect != 1 || !slices.Equal(f.Values, []string{"day", "month"}) {
			t.Errorf("%s: events.date_precision = required %v, hidden %v, max %d, values %v; want optional, visible, 1, [day month]",
				when, f.Required, f.Hidden, f.MaxSelect, f.Values)
		}
	}

	check("as created")
	if got := event().GetString("date_precision"); got != "" {
		t.Errorf("an event made without a precision has %q, want none (a day)", got)
	}

	// The event 2 has a format with no day: it can be known by its month.
	record := event()
	record.Set("date_precision", "month")
	record.Set("start_date", "2026-06-01")
	if err := app.Save(record); err != nil {
		t.Fatalf("a month is refused: %v", err)
	}
	if got := event().GetString("end_date"); got != "2026-06-30" {
		t.Errorf("the month ends on %q, want 2026-06-30", got)
	}
	record = event()
	record.Set("date_precision", "year")
	if err := app.Save(record); err == nil {
		t.Error("a precision that is not day or month was accepted")
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a month set: %v", err)
	}
	if field() != nil {
		t.Error("events.date_precision must be gone after the rollback")
	}
	// The event is still there, with the days it was stored as.
	after := event()
	if after.GetString("start_date") != "2026-06-01" || after.GetString("end_date") != "2026-06-30" {
		t.Errorf("after the rollback, the event is from %q to %q, want 2026-06-01 to 2026-06-30",
			after.GetString("start_date"), after.GetString("end_date"))
	}
	after.Set("notes", "after the rollback")
	if err := app.Save(after); err != nil {
		t.Errorf("the event does not save after the rollback: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	check("after applying again")
	if got := event().GetString("date_precision"); got != "" {
		t.Errorf("after applying again, the event has the precision %q, want none", got)
	}
	again := event()
	again.Set("date_precision", "month")
	if err := app.Save(again); err != nil {
		t.Errorf("a month is refused after applying again: %v", err)
	}
}
