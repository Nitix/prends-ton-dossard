package migrations_test

import (
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/testutil"
)

// mustSave saves a new record of the given collection and fails the test on error.
func mustSave(t testing.TB, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()
	record, err := trySave(app, collection, values)
	if err != nil {
		t.Fatalf("saving a %s record: %v", collection, err)
	}
	return record
}

// trySave saves a new record of the given collection and returns the save error.
func trySave(app core.App, collection string, values map[string]any) (*core.Record, error) {
	col, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(col)
	for k, v := range values {
		record.Set(k, v)
	}
	return record, app.Save(record)
}

func TestMigrations_CollectionsExist(t *testing.T) {
	app := testutil.NewApp(t)

	for _, name := range []string{
		"users", "runners", "race_types", "events", "formats",
		"participations", "invitations", "passkeys",
	} {
		if _, err := app.FindCollectionByNameOrId(name); err != nil {
			t.Errorf("collection %q is missing: %v", name, err)
		}
	}
}

func TestMigrations_SeedRaceTypes(t *testing.T) {
	app := testutil.NewApp(t)

	records, err := app.FindRecordsByFilter("race_types", "", "@rowid", 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	var labels []string
	for _, r := range records {
		labels = append(labels, r.GetString("label"))
	}

	want := []string{"Route", "Trail", "Ultra-trail", "Cross", "Backyard", "Hyrox"}
	if !slices.Equal(labels, want) {
		t.Errorf("race type labels = %v, want %v", labels, want)
	}
}

func TestMigrations_RunnerNameUniqueCaseInsensitive(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app) // contains the runner "Alice"

	if _, err := trySave(app, "runners", map[string]any{"name": "alice"}); err == nil {
		t.Error(`saving the runner "alice" next to "Alice" must fail`)
	}
	mustSave(t, app, "runners", map[string]any{"name": "Alicia"})
}

func TestMigrations_RunnerUserUniqueWhenSet(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// A user can only be linked to one runner...
	if _, err := trySave(app, "runners", map[string]any{"name": "Alice bis", "user": fx.Alice.Id}); err == nil {
		t.Error("linking a second runner to the same user must fail")
	}
	// ...but any number of runners may have no user at all (Sam already has none).
	mustSave(t, app, "runners", map[string]any{"name": "Zoe"})
}

func TestMigrations_RaceTypeLabelUniqueCaseInsensitive(t *testing.T) {
	app := testutil.NewApp(t)

	if _, err := trySave(app, "race_types", map[string]any{"label": "trail"}); err == nil {
		t.Error(`saving the race type "trail" next to "Trail" must fail`)
	}
}

func TestMigrations_ParticipationUnique(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	_, err := trySave(app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id,
		"format": fx.F42.Id,
		"status": "interested",
	})
	if err == nil {
		t.Error("a second participation of Alice in F42 must fail")
	}
}

func TestMigrations_PasskeyCredentialIDUnique(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	passkey := func(user *core.Record) map[string]any {
		return map[string]any{
			"user":          user.Id,
			"name":          "Phone",
			"credential_id": "abc",
			"credential":    map[string]any{"id": "abc"},
		}
	}
	mustSave(t, app, "passkeys", passkey(fx.Alice))
	if _, err := trySave(app, "passkeys", passkey(fx.Bob)); err == nil {
		t.Error("a second passkey with the same credential_id must fail")
	}
}

func TestMigrations_Users(t *testing.T) {
	app := testutil.NewApp(t)
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}

	for _, gone := range []string{"name", "avatar"} {
		if users.Fields.GetByName(gone) != nil {
			t.Errorf("users.%s must be removed", gone)
		}
	}

	role, ok := users.Fields.GetByName("role").(*core.SelectField)
	if !ok {
		t.Fatal("users.role must be a select field")
	}
	if !slices.Equal(role.Values, []string{"member", "admin"}) || role.MaxSelect != 1 {
		t.Errorf("users.role = values %v, maxSelect %d", role.Values, role.MaxSelect)
	}
	if _, ok := users.Fields.GetByName("disabled").(*core.BoolField); !ok {
		t.Error("users.disabled must be a bool field")
	}

	password := users.Fields.GetByName("password").(*core.PasswordField)
	if password.Min != 10 {
		t.Errorf("users.password min = %d, want 10", password.Min)
	}

	if users.AuthRule == nil || *users.AuthRule != "disabled = false" {
		t.Errorf("users.authRule = %v, want %q", users.AuthRule, "disabled = false")
	}
	if !users.PasswordAuth.Enabled || !slices.Equal(users.PasswordAuth.IdentityFields, []string{"email"}) {
		t.Errorf("password auth = %+v, want enabled on email only", users.PasswordAuth)
	}
	if users.OTP.Enabled || users.OAuth2.Enabled || users.MFA.Enabled {
		t.Error("OTP, OAuth2 and MFA must be disabled")
	}
	if users.AuthAlert.Enabled {
		t.Error("auth alerts send emails and must be disabled")
	}
	// The other rules are covered by TestRules.
	if users.CreateRule != nil || users.DeleteRule != nil {
		t.Error("nobody creates or deletes an account through the API: those rules must be null")
	}
}

func TestMigrations_UsersPasswordMinLength(t *testing.T) {
	app := testutil.NewApp(t)

	user := func(email, password string) map[string]any {
		return map[string]any{"email": email, "password": password, "role": "member"}
	}
	if _, err := trySave(app, "users", user("short@example.test", "123456789")); err == nil {
		t.Error("a 9-character password must be refused")
	}
	mustSave(t, app, "users", user("ok@example.test", "1234567890"))
}

func TestMigrations_UserEmailUnique(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app) // contains alice@example.test

	_, err := trySave(app, "users", map[string]any{
		"email": "alice@example.test", "password": "1234567890", "role": "member",
	})
	if err == nil {
		t.Error("a second account with the same email must fail")
	}
}

// The rules of "participations" are added with the code that keeps its
// invariants, in a later migration.
func TestMigrations_ParticipationRulesAreSuperuserOnly(t *testing.T) {
	app := testutil.NewApp(t)

	c, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	if c.ListRule != nil || c.ViewRule != nil || c.CreateRule != nil ||
		c.UpdateRule != nil || c.DeleteRule != nil {
		t.Error("participations: every rule must be null for now")
	}
}

func TestMigrations_HiddenFields(t *testing.T) {
	app := testutil.NewApp(t)

	for collection, field := range map[string]string{
		"invitations": "token_hash",
		"passkeys":    "credential",
	} {
		c, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatal(err)
		}
		f := c.Fields.GetByName(field)
		if f == nil || !f.GetHidden() {
			t.Errorf("%s.%s must exist and be hidden", collection, field)
		}
	}
}

func TestMigrations_CascadeDelete(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// An invitation and a passkey belong to a runner and to a user respectively.
	lea := mustSave(t, app, "runners", map[string]any{"name": "Léa"})
	invitation := mustSave(t, app, "invitations", map[string]any{
		"runner":     lea.Id,
		"kind":       "invite",
		"role":       "member",
		"token_hash": "00",
		"expires_at": "2030-01-01 00:00:00.000Z",
	})
	passkey := mustSave(t, app, "passkeys", map[string]any{
		"user":          fx.Bob.Id,
		"name":          "Phone",
		"credential_id": "abc",
		"credential":    map[string]any{"id": "abc"},
	})

	// Deleting an event deletes its formats, and their participations.
	if err := app.Delete(fx.Event); err != nil {
		t.Fatal(err)
	}
	for _, r := range []*core.Record{fx.F42, fx.F15, fx.P1, fx.P2, fx.P3} {
		if _, err := app.FindRecordById(r.Collection(), r.Id); err == nil {
			t.Errorf("%s %s must be deleted with the event", r.Collection().Name, r.Id)
		}
	}
	// Other events are untouched.
	if _, err := app.FindRecordById("formats", fx.FLyon.Id); err != nil {
		t.Errorf("the format of another event must survive: %v", err)
	}

	if err := app.Delete(lea); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("invitations", invitation.Id); err == nil {
		t.Error("the invitation must be deleted with its runner")
	}

	if err := app.Delete(fx.Bob); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindRecordById("passkeys", passkey.Id); err == nil {
		t.Error("the passkey must be deleted with its user")
	}
	// The runner outlives its user, which becomes an account-less runner.
	bobRunner, err := app.FindRecordById("runners", fx.BobRunner.Id)
	if err != nil {
		t.Fatalf("the runner must survive the deletion of its user: %v", err)
	}
	if bobRunner.GetString("user") != "" {
		t.Errorf("runner.user = %q, want it cleared", bobRunner.GetString("user"))
	}
}

func TestMigrations_RaceTypeInUseCannotBeDeleted(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	if err := app.Delete(fx.Trail); err == nil {
		t.Error("a race type used by a format must not be deletable")
	}
	if err := app.Delete(fx.Backyard); err != nil {
		t.Errorf("an unused race type must be deletable: %v", err)
	}
}

func TestMigrations_FormatMeasures(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	format := func(extra map[string]any) map[string]any {
		values := map[string]any{"event": fx.Event2.Id, "race_type": fx.Road.Id}
		for k, v := range extra {
			values[k] = v
		}
		return values
	}

	// Every measure is optional at the schema level: that one of them is set
	// (format_measure_required) is a business rule enforced by a hook, which
	// events.Register attaches and which has its own tests.
	mustSave(t, app, "formats", format(map[string]any{"distance_km": 10}))
	mustSave(t, app, "formats", format(map[string]any{"duration_min": 360}))
	mustSave(t, app, "formats", format(map[string]any{"time_limit_min": 2880, "distance_km": 6.706}))

	for name, extra := range map[string]map[string]any{
		"decimal duration":    {"duration_min": 1.5},
		"negative duration":   {"duration_min": -1},
		"decimal time limit":  {"time_limit_min": 10.5},
		"negative time limit": {"time_limit_min": -1},
		"negative distance":   {"distance_km": -1},
		"decimal elevation":   {"elevation_gain_m": 10.5},
		"negative elevation":  {"elevation_gain_m": -1},
		"unknown event":       {"event": "missing"},
		"missing race type":   {"race_type": ""},
	} {
		if _, err := trySave(app, "formats", format(extra)); err == nil {
			t.Errorf("%s: saving the format must fail", name)
		}
	}
}

func TestMigrations_Settings(t *testing.T) {
	app := testutil.NewApp(t)
	s := app.Settings()

	if s.Backups.Cron != "0 3 * * *" || s.Backups.CronMaxKeep != 7 {
		t.Errorf("backups = cron %q, keep %d; want %q, 7", s.Backups.Cron, s.Backups.CronMaxKeep, "0 3 * * *")
	}
	if !s.Batch.Enabled || s.Batch.MaxRequests != 50 {
		t.Errorf("batch = enabled %v, max %d; want enabled, 50", s.Batch.Enabled, s.Batch.MaxRequests)
	}
	if !s.RateLimits.Enabled {
		t.Fatal("rate limits must be enabled")
	}

	wantRules := map[string]struct {
		max      int
		duration int64
	}{
		// PocketBase defaults, kept.
		"*:auth":     {2, 3},
		"*:create":   {20, 5},
		"/api/batch": {3, 1},
		"/api/":      {300, 10},
		// Ours.
		"/api/app/invitations/":    {10, 60},
		"/api/app/passkeys/login/": {20, 60},
	}
	if len(s.RateLimits.Rules) != len(wantRules) {
		t.Errorf("got %d rate limit rules, want %d: %+v", len(s.RateLimits.Rules), len(wantRules), s.RateLimits.Rules)
	}
	for label, want := range wantRules {
		var found *core.RateLimitRule
		for i := range s.RateLimits.Rules {
			if s.RateLimits.Rules[i].Label == label {
				found = &s.RateLimits.Rules[i]
			}
		}
		if found == nil {
			t.Errorf("rate limit rule %q is missing", label)
			continue
		}
		if found.MaxRequests != want.max || found.Duration != want.duration || found.Audience != "" {
			t.Errorf("rule %q = %+v, want %d requests per %ds for everyone", label, *found, want.max, want.duration)
		}
	}
}

// PocketBase applies the first matching prefix rule, so our rules only take
// effect if they come before the generic "/api/" one.
func TestMigrations_SettingsRateLimitRulesAreEffective(t *testing.T) {
	app := testutil.NewApp(t)
	limits := app.Settings().RateLimits

	for path, wantMax := range map[string]int{
		"/api/app/invitations/some-token/accept": 10,
		"/api/app/passkeys/login/start":          20,
		"/api/collections/events/records":        300,
	} {
		rule, ok := limits.FindRateLimitRule([]string{"POST " + path, path})
		if !ok || rule.MaxRequests != wantMax {
			t.Errorf("%s is limited by %+v, want %d requests", path, rule, wantMax)
		}
	}
}

func TestSeed_Fixture(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	if got := fx.P2.GetString("added_by"); got != fx.AliceRunner.Id {
		t.Errorf("P2.added_by = %q, want Alice's runner %q", got, fx.AliceRunner.Id)
	}
	if fx.P2.GetBool("confirmed") {
		t.Error("P2 must not be confirmed")
	}
	if !fx.P1.GetBool("confirmed") || fx.P1.GetString("status") != "registered" {
		t.Errorf("P1 must be a confirmed registration, got %q / %v", fx.P1.GetString("status"), fx.P1.GetBool("confirmed"))
	}

	// Accounts and their runners.
	if fx.Admin.GetString("role") != "admin" || fx.Alice.GetString("role") != "member" {
		t.Error("only Admin has the admin role")
	}
	if !fx.Alice.ValidatePassword("password-123") || fx.Alice.Email() != "alice@example.test" {
		t.Error("Alice must be able to log in with the shared fixture password")
	}
	if fx.AliceRunner.GetString("user") != fx.Alice.Id {
		t.Error("Alice's runner must be linked to her account")
	}
	if fx.SamRunner.GetString("name") != "Sam" || fx.SamRunner.GetString("user") != "" {
		t.Error("Sam must be a runner without account")
	}

	// Events and formats.
	if fx.Event.GetString("start_date") != "2026-06-13" || fx.Event.GetString("end_date") != "2026-06-14" ||
		fx.Event.GetString("created_by") != fx.AliceRunner.Id {
		t.Errorf("unexpected event: %v", fx.Event.FieldsData())
	}
	if fx.Event2.GetString("start_date") != "2026-06-22" || fx.Event2.GetString("created_by") != fx.BobRunner.Id {
		t.Errorf("unexpected second event: %v", fx.Event2.FieldsData())
	}
	if fx.F42.GetFloat("distance_km") != 42 || fx.F42.GetInt("elevation_gain_m") != 2400 ||
		fx.F42.GetString("date") != "2026-06-14" || fx.F42.GetString("race_type") != fx.Trail.Id {
		t.Errorf("unexpected F42: %v", fx.F42.FieldsData())
	}
	if fx.F15.GetString("date") != "" || fx.F15.GetFloat("distance_km") != 15 {
		t.Errorf("unexpected F15: %v", fx.F15.FieldsData())
	}
	if fx.FLyon.GetString("race_type") != fx.Road.Id || fx.FLyon.GetString("event") != fx.Event2.Id {
		t.Errorf("unexpected FLyon: %v", fx.FLyon.FieldsData())
	}
	if fx.Cross.GetString("label") != "Cross" || fx.Backyard.GetString("label") != "Backyard" {
		t.Error("Cross and Backyard must be the seeded race types")
	}
}

// The down migrations must really undo the up ones, so that a migration can be
// rolled back and applied again.
func TestMigrations_DownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	runner := core.NewMigrationsRunner(app, core.AppMigrations)

	// Every migration of the application, however many there are by now.
	total := len(core.AppMigrations.Items())
	reverted, err := runner.Down(total)
	if err != nil {
		t.Fatal(err)
	}
	if len(reverted) != total {
		t.Fatalf("reverted %v, want all %d migrations", reverted, total)
	}

	for _, name := range []string{
		"runners", "race_types", "events", "formats", "participations", "invitations", "passkeys",
	} {
		if _, err := app.FindCollectionByNameOrId(name); err == nil {
			t.Errorf("collection %q must be gone after the rollback", name)
		}
	}
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"name", "avatar"} {
		if users.Fields.GetByName(name) == nil {
			t.Errorf("users.%s must be back", name)
		}
	}
	for _, name := range []string{"role", "disabled"} {
		if users.Fields.GetByName(name) != nil {
			t.Errorf("users.%s must be gone", name)
		}
	}
	if s := app.Settings(); s.Batch.Enabled || s.RateLimits.Enabled || s.Backups.Cron != "" {
		t.Errorf("settings must be back to the defaults: %+v", s)
	}
	if got := len(app.Settings().RateLimits.Rules); got != 4 {
		t.Errorf("%d rate limit rules left, want the 4 defaults", got)
	}

	if _, err := runner.Up(); err != nil {
		t.Fatalf("applying the migrations again: %v", err)
	}
	if got, _ := app.CountRecords("race_types"); got != 6 {
		t.Errorf("%d race types after applying again, want 6", got)
	}
	testutil.Seed(t, app) // the whole schema is usable again
}
