// Package testutil is the shared test harness of the server: a fresh
// application, a fixed set of records, and table-driven API tests.
package testutil

import (
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/config"
	_ "courses/server/migrations"
	"courses/server/setup"
)

// Password is the password of every fixture account.
const Password = "password-123"

// Fixture holds the records created by Seed.
type Fixture struct {
	// Accounts. Admin has the admin role, Alice and Bob are members.
	Admin, Alice, Bob *core.Record
	// Runners. Each account has one; Sam has no account.
	AdminRunner, AliceRunner, BobRunner, SamRunner *core.Record
	// Race types among the ones created by the migrations.
	Road, Trail, Cross, Backyard *core.Record
	// Event is created by Alice and has F42 and F15; Event2 is created by Bob
	// and has FLyon.
	Event, Event2 *core.Record

	F42, F15, FLyon *core.Record
	// P1: Alice registered to F42 (confirmed). P2: Bob interested in F42,
	// added by Alice. P3: Sam interested in F15, added by Alice.
	P1, P2, P3 *core.Record
}

// NewApp returns a test application on a temporary data directory, with all
// the migrations applied and the application wired by setup.Register, with
// APP_URL set to http://localhost:5173. It is cleaned up when the test ends.
func NewApp(t testing.TB) *tests.TestApp {
	t.Helper()
	return NewAppWith(t, nil)
}

// NewAppWith is NewApp with more environment variables for the configuration
// (DEMO_LOGIN_EMAIL, for instance). APP_URL is the one of NewApp unless env
// gives another.
func NewAppWith(t testing.TB, env map[string]string) *tests.TestApp {
	t.Helper()

	// An empty directory to clone: PocketBase's own test data would bring
	// collections that are not ours.
	app, err := tests.NewTestApp(t.TempDir())
	if err != nil {
		t.Fatalf("creating the test app: %v", err)
	}
	t.Cleanup(app.Cleanup)

	cfg, err := config.Load(func(key string) string {
		if value, ok := env[key]; ok {
			return value
		}
		if key == "APP_URL" {
			return "http://localhost:5173"
		}
		return ""
	})
	if err != nil {
		t.Fatalf("loading the config: %v", err)
	}
	if err := setup.Register(app, cfg); err != nil {
		t.Fatalf("registering the app: %v", err)
	}

	return app
}

// Token returns an auth token for user, as the login route would.
func Token(t testing.TB, user *core.Record) string {
	t.Helper()
	token, err := user.NewAuthToken()
	if err != nil {
		t.Fatalf("creating a token for %s: %v", user.Email(), err)
	}
	return token
}

// Seed creates the fixture records in app. It writes straight to the
// database, so no request hook runs and every value is the explicit one.
func Seed(t testing.TB, app core.App) Fixture {
	t.Helper()

	create := func(collection string, values map[string]any) *core.Record {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatalf("seed: %v", err)
		}
		record := core.NewRecord(c)
		for k, v := range values {
			record.Set(k, v)
		}
		if err := app.Save(record); err != nil {
			t.Fatalf("seed: saving a %s record: %v", collection, err)
		}
		return record
	}
	account := func(email, role string) *core.Record {
		t.Helper()
		return create("users", map[string]any{
			"email":    email,
			"password": Password,
			"role":     role,
			"verified": true,
		})
	}
	runner := func(name string, user *core.Record) *core.Record {
		t.Helper()
		values := map[string]any{"name": name}
		if user != nil {
			values["user"] = user.Id
		}
		return create("runners", values)
	}
	raceType := func(label string) *core.Record {
		t.Helper()
		record, err := app.FindFirstRecordByData("race_types", "label", label)
		if err != nil {
			t.Fatalf("seed: race type %q: %v", label, err)
		}
		return record
	}

	var fx Fixture

	fx.Admin = account("admin@example.test", "admin")
	fx.Alice = account("alice@example.test", "member")
	fx.Bob = account("bob@example.test", "member")

	fx.AdminRunner = runner("Admin", fx.Admin)
	fx.AliceRunner = runner("Alice", fx.Alice)
	fx.BobRunner = runner("Bob", fx.Bob)
	fx.SamRunner = runner("Sam", nil)

	fx.Road = raceType("Route")
	fx.Trail = raceType("Trail")
	fx.Cross = raceType("Cross")
	fx.Backyard = raceType("Backyard")

	fx.Event = create("events", map[string]any{
		"name":       "Trail des Crêtes",
		"location":   "Annecy",
		"start_date": "2026-06-13",
		"end_date":   "2026-06-14",
		"created_by": fx.AliceRunner.Id,
	})
	fx.F42 = create("formats", map[string]any{
		"event":            fx.Event.Id,
		"race_type":        fx.Trail.Id,
		"distance_km":      42,
		"elevation_gain_m": 2400,
		"date":             "2026-06-14",
	})
	fx.F15 = create("formats", map[string]any{
		"event":            fx.Event.Id,
		"race_type":        fx.Trail.Id,
		"distance_km":      15,
		"elevation_gain_m": 700,
	})

	fx.Event2 = create("events", map[string]any{
		"name":       "10 km de Lyon",
		"location":   "Lyon",
		"start_date": "2026-06-22",
		"created_by": fx.BobRunner.Id,
	})
	fx.FLyon = create("formats", map[string]any{
		"event":       fx.Event2.Id,
		"race_type":   fx.Road.Id,
		"distance_km": 10,
	})

	fx.P1 = create("participations", map[string]any{
		"runner":    fx.AliceRunner.Id,
		"format":    fx.F42.Id,
		"status":    "registered",
		"confirmed": true,
		"added_by":  fx.AliceRunner.Id,
	})
	fx.P2 = create("participations", map[string]any{
		"runner":    fx.BobRunner.Id,
		"format":    fx.F42.Id,
		"status":    "interested",
		"confirmed": false,
		"added_by":  fx.AliceRunner.Id,
	})
	fx.P3 = create("participations", map[string]any{
		"runner":    fx.SamRunner.Id,
		"format":    fx.F15.Id,
		"status":    "interested",
		"confirmed": false,
		"added_by":  fx.AliceRunner.Id,
	})

	return fx
}
