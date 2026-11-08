package migrations_test

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/testutil"
)

// The migration 9r gives a format an optional start time: an HH:MM text, Paris
// time, empty when it is not known. Its rollback removes the field and what it
// holds; the formats stay valid.
func TestMigrations_FormatStartTimeDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9r_format_start_time.go")

	format := func() *core.Record {
		t.Helper()
		return mustFind(t, app, "formats", fx.F42.Id)
	}
	field := func() core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("formats")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName("start_time")
	}
	check := func(when string) {
		t.Helper()
		f, ok := field().(*core.TextField)
		if !ok {
			t.Fatalf("%s: formats.start_time must be a text field, got %T", when, field())
		}
		if f.Required || f.Hidden || f.Pattern != `^([01]\d|2[0-3]):[0-5]\d$` {
			t.Errorf("%s: formats.start_time = required %v, hidden %v, pattern %q; want optional, visible, the HH:MM pattern",
				when, f.Required, f.Hidden, f.Pattern)
		}
	}
	setTime := func(value string) error {
		r := format()
		r.Set("start_time", value)
		return app.Save(r)
	}

	check("as created")
	if got := format().GetString("start_time"); got != "" {
		t.Errorf("a format made without a start time has %q, want none", got)
	}
	if err := setTime("07:30"); err != nil {
		t.Fatalf("07:30 is refused: %v", err)
	}
	for _, bad := range []string{"24:00", "7:30", "07:60", "0730", "07:30:00", "tôt"} {
		if err := setTime(bad); err == nil {
			t.Errorf("the start time %q was accepted", bad)
		}
	}
	if err := setTime(""); err != nil {
		t.Errorf("no start time is refused: %v", err)
	}
	if err := setTime("07:30"); err != nil {
		t.Fatal(err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a time set: %v", err)
	}
	if field() != nil {
		t.Error("formats.start_time must be gone after the rollback")
	}
	after := format()
	after.Set("name", "after the rollback")
	if err := app.Save(after); err != nil {
		t.Errorf("the format does not save after the rollback: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	check("after applying again")
	if got := format().GetString("start_time"); got != "" {
		t.Errorf("after applying again, the format has the time %q, want none", got)
	}
	if err := setTime("19:05"); err != nil {
		t.Errorf("a time is refused after applying again: %v", err)
	}
}
