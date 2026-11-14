package migrations_test

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/testutil"
)

// The migration 9t gives a format its own registration opening: a day and a
// time, two optional text fields. Its rollback removes both, and what they hold.
func TestMigration9t(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9t_format_registration_opening.go")
	names := []string{"registration_opening", "registration_opening_time"}

	check := func(when string) {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("formats")
		if err != nil {
			t.Fatal(err)
		}
		for _, name := range names {
			f, ok := c.Fields.GetByName(name).(*core.TextField)
			if !ok {
				t.Fatalf("%s: formats.%s must be a text field, got %T", when, name, c.Fields.GetByName(name))
			}
			if f.Required || f.Hidden || f.Pattern != "" {
				t.Errorf("%s: formats.%s = required %v, hidden %v, pattern %q; want optional, visible, no pattern",
					when, name, f.Required, f.Hidden, f.Pattern)
			}
		}
	}

	check("as created")
	r := mustFind(t, app, "formats", fx.F42.Id)
	r.Set("registration_opening", "2026-05-17")
	r.Set("registration_opening_time", "12:00")
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with values set: %v", err)
	}
	c, _ := app.FindCollectionByNameOrId("formats")
	for _, name := range names {
		if c.Fields.GetByName(name) != nil {
			t.Errorf("formats.%s must be gone after the rollback", name)
		}
	}
	after := mustFind(t, app, "formats", fx.F42.Id)
	after.Set("name", "after the rollback")
	if err := app.Save(after); err != nil {
		t.Errorf("the format does not save after the rollback: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	check("after applying again")
	again := mustFind(t, app, "formats", fx.F42.Id)
	for _, name := range names {
		if got := again.GetString(name); got != "" {
			t.Errorf("after applying again, formats.%s is %q, want none", name, got)
		}
	}
}
