package migrations_test

import (
	"errors"
	"slices"
	"strings"
	"testing"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/dbutils"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

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
		"participations", "invitations", "passkeys", "comments", "offers", "offer_members", "calendar_feeds",
		"mcp_tokens", "push_subscriptions", "reminder_deliveries",
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

	// A participation to an event, without a format, is unique by runner and
	// event. Sam is on no format of Event2, so the first one is accepted: that
	// is what shows that the second one is refused for the duplicate.
	undecided := map[string]any{"runner": fx.SamRunner.Id, "event": fx.Event2.Id, "status": "interested"}
	mustSave(t, app, "participations", undecided)
	if _, err := trySave(app, "participations", undecided); err == nil {
		t.Error("a second participation of Sam in Event2, without a format, must fail")
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

// The email index ignores the case, both for uniqueness and, because
// PocketBase reads its collation, for the sign-in (see accounts tests).
func TestMigrations_UserEmailUniqueIgnoresCase(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app) // contains alice@example.test

	if _, err := trySave(app, "users", map[string]any{
		"email": "ALICE@Example.test", "password": "1234567890", "role": "member",
	}); err == nil {
		t.Error(`saving "ALICE@Example.test" next to "alice@example.test" must fail`)
	}
	if _, err := app.FindAuthRecordByEmail("users", "Alice@Example.TEST"); err != nil {
		t.Errorf("finding an account by its email in other letters: %v", err)
	}
}

// emailIndexes returns the definitions of the unique indexes of users.email.
func emailIndexes(t testing.TB, app core.App) []string {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	var found []string
	for _, index := range users.Indexes {
		parsed := dbutils.ParseIndex(index)
		if parsed.Unique && len(parsed.Columns) == 1 && strings.EqualFold(parsed.Columns[0].Name, "email") {
			found = append(found, index)
		}
	}
	return found
}

func TestMigrations_UsersEmailNoCaseDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)

	var migration *core.Migration
	for _, m := range core.AppMigrations.Items() {
		if m.File == "7_users_email_nocase.go" {
			migration = m
		}
	}
	if migration == nil {
		t.Fatal("the migration 7_users_email_nocase.go is not registered")
	}

	const (
		nocase   = "CREATE UNIQUE INDEX `idx_email__pb_users_auth_` ON `users` (`email` COLLATE NOCASE) WHERE `email` != ''"
		original = "CREATE UNIQUE INDEX `idx_email__pb_users_auth_` ON `users` (`email`) WHERE `email` != ''"
	)
	if got := emailIndexes(t, app); !slices.Equal(got, []string{nocase}) {
		t.Errorf("email indexes = %q, want [%q]", got, nocase)
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if got := emailIndexes(t, app); !slices.Equal(got, []string{original}) {
		t.Errorf("after the rollback, email indexes = %q, want PocketBase's [%q]", got, original)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	if got := emailIndexes(t, app); !slices.Equal(got, []string{nocase}) {
		t.Errorf("after applying again, email indexes = %q, want [%q]", got, nocase)
	}
}

// migrationFile returns the migration of the application that is in that file.
func migrationFile(t testing.TB, file string) *core.Migration {
	t.Helper()
	for _, m := range core.AppMigrations.Items() {
		if m.File == file {
			return m
		}
	}
	t.Fatalf("the migration %s is not registered", file)
	return nil
}

// The rules of "participations" are added with the code that keeps its
// invariants, by the migration 5_participation_rules.go: rolling it back
// leaves them superuser-only, and applying it again restores the ones that it
// sets, which are not the final ones (the migration 8 adds a guard to the
// update rule). The migration is run on its own so that the test does not
// depend on the ones added after it. What the rules allow is tested with the
// hooks, in the participations package.
func TestMigrations_ParticipationRulesDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	migration := migrationFile(t, "5_participation_rules.go")

	// rules returns the rules of the collection in the order list, view,
	// create, update, delete.
	rules := func() []*string {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		return []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule}
	}
	for i, r := range rules() {
		if r == nil {
			t.Errorf("participations: rule %d is null, want one", i)
		}
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	for i, r := range rules() {
		if r != nil {
			t.Errorf("participations: rule %d is %q after the rollback, want null", i, *r)
		}
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	const (
		signedIn = `@request.auth.id != ""`
		owner    = `(@request.auth.role = "admin" || runner.user = @request.auth.id || confirmed = false)`
	)
	want := []string{
		signedIn,
		signedIn,
		signedIn,
		signedIn + ` && @request.body.runner:isset = false && @request.body.added_by:isset = false && ` + owner,
		signedIn + ` && ` + owner,
	}
	for i, got := range rules() {
		if got == nil || *got != want[i] {
			t.Errorf("participations: rule %d = %v after applying the migration again, want %q", i, got, want[i])
		}
	}
}

// The participations belong to an event as well as to a format (migration
// 8_participation_event.go): a participation without a format is for the event
// only.
func TestMigrations_ParticipationEvent(t *testing.T) {
	app := testutil.NewApp(t)
	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		t.Fatal(err)
	}
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		t.Fatal(err)
	}

	event, ok := participations.Fields.GetByName("event").(*core.RelationField)
	if !ok {
		t.Fatal("participations.event must be a relation field")
	}
	if event.CollectionId != events.Id || event.MaxSelect != 1 {
		t.Errorf("participations.event = collection %q, maxSelect %d; want events, 1", event.CollectionId, event.MaxSelect)
	}
	if !event.Required || !event.CascadeDelete {
		t.Errorf("participations.event = required %v, cascade %v; want both", event.Required, event.CascadeDelete)
	}

	format, ok := participations.Fields.GetByName("format").(*core.RelationField)
	if !ok {
		t.Fatal("participations.format must be a relation field")
	}
	if format.CollectionId != formats.Id {
		t.Errorf("participations.format points at %q, want formats", format.CollectionId)
	}
	if format.Required {
		t.Error("participations.format must not be required any more")
	}
	if !format.CascadeDelete {
		t.Error("participations.format must still be deleted with its format")
	}

	// The unique index of a runner and a format only counts the participations
	// that have a format, and a second one counts those that have none.
	for _, want := range []string{
		"CREATE UNIQUE INDEX idx_participations_runner_format ON participations (runner, format) WHERE format != ''",
		"CREATE UNIQUE INDEX idx_participations_runner_event ON participations (runner, event) WHERE format = ''",
	} {
		if !slices.Contains(participations.Indexes, want) {
			t.Errorf("participations.indexes = %q, want %q among them", participations.Indexes, want)
		}
	}
	if len(participations.Indexes) != 2 {
		t.Errorf("participations has %d indexes, want the 2 partial ones: %q", len(participations.Indexes), participations.Indexes)
	}

	// The update rule keeps every guard of the v1, and refuses a body that has
	// an event.
	if participations.UpdateRule == nil {
		t.Fatal("participations: the update rule is null")
	}
	update := *participations.UpdateRule
	if !strings.HasPrefix(update, `@request.auth.id != "" && `) {
		t.Errorf("the update rule must start with the signed-in guard: %q", update)
	}
	if !strings.Contains(update, `@request.body.event:isset = false`) {
		t.Errorf("the update rule must refuse an event in the body: %q", update)
	}
}

// The migration 8 gives an event to the participations that exist when the
// application is updated: the event of their format. The rollback takes the
// column away, and applying the migration again fills it.
func TestMigrations_ParticipationEventBackfill(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "8_participation_event.go")

	// A participation without a format does not exist in the v1: the rollback
	// deletes it, as the v1 schema could not hold it.
	undecided := mustSave(t, app, "participations", map[string]any{
		"runner": fx.AdminRunner.Id, "event": fx.Event2.Id, "status": "interested",
	})

	collection := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		return c
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	c := collection()
	if c.Fields.GetByName("event") != nil {
		t.Error("participations.event must be gone after the rollback")
	}
	if format, ok := c.Fields.GetByName("format").(*core.RelationField); !ok || !format.Required {
		t.Error("participations.format must be required again after the rollback")
	}
	for _, p := range []*core.Record{fx.P1, fx.P2, fx.P3} {
		if _, err := app.FindRecordById("participations", p.Id); err != nil {
			t.Errorf("the participation %s must survive the rollback: %v", p.Id, err)
		}
	}
	if _, err := app.FindRecordById("participations", undecided.Id); err == nil {
		t.Error("a participation without a format must be deleted by the rollback")
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	for _, p := range []*core.Record{fx.P1, fx.P2, fx.P3} {
		got, err := app.FindRecordById("participations", p.Id)
		if err != nil {
			t.Fatal(err)
		}
		if got.GetString("event") != fx.Event.Id {
			t.Errorf("the participation %s is in the event %q, want %q", p.Id, got.GetString("event"), fx.Event.Id)
		}
	}
}

// An orphan participation (its format row does not exist: a hand edit, or a
// restore of an inconsistent database) is invisible in the v1, which reads the
// participations through their format, and it has no event to take. The
// migration 8 deletes it, instead of writing NULL into the event, which is
// NOT NULL and would fail the whole migration, and with it the start of the
// container. The other participations get the event of their format.
func TestMigrations_ParticipationEventBackfillOrphan(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// The database as the v1 left it: the migration 8 and every one after it
	// rolled back, however many there are by now.
	migrations := core.AppMigrations.Items()
	from := slices.IndexFunc(migrations, func(m *core.Migration) bool { return m.File == "8_participation_event.go" })
	if from < 0 {
		t.Fatal("the migration 8_participation_event.go is not registered")
	}
	var want []string
	for _, m := range slices.Backward(migrations[from:]) {
		want = append(want, m.File)
	}
	runner := core.NewMigrationsRunner(app, core.AppMigrations)
	reverted, err := runner.Down(len(want))
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(reverted, want) {
		t.Fatalf("reverted %v, want %v", reverted, want)
	}

	// The orphan is written with SQL: no record of "formats" has this id, and
	// the collection has no foreign key to refuse it.
	const orphan = "orphanpart0001"
	if _, err := app.DB().NewQuery(
		"INSERT INTO participations (id, runner, format, status, confirmed) VALUES ({:id}, {:runner}, {:format}, 'interested', 1)",
	).Bind(map[string]any{"id": orphan, "runner": fx.AdminRunner.Id, "format": "nosuchformat01"}).Execute(); err != nil {
		t.Fatalf("inserting the orphan participation: %v", err)
	}

	if _, err := runner.Up(); err != nil {
		t.Fatalf("applying the migrations to a database with an orphan participation: %v", err)
	}

	if _, err := app.FindRecordById("participations", orphan); err == nil {
		t.Error("the orphan participation must be deleted by the migration")
	}
	for _, p := range []*core.Record{fx.P1, fx.P2, fx.P3} {
		got, err := app.FindRecordById("participations", p.Id)
		if err != nil {
			t.Fatalf("the participation %s must survive the migration: %v", p.Id, err)
		}
		if got.GetString("event") != fx.Event.Id {
			t.Errorf("the participation %s is in the event %q, want %q", p.Id, got.GetString("event"), fx.Event.Id)
		}
	}
	if got, _ := app.CountRecords("participations"); got != 3 {
		t.Errorf("%d participations after the migration, want the 3 of the fixture", got)
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

	// Deleting an event deletes its formats, and their participations, and the
	// participations that are for the event only.
	undecided := mustSave(t, app, "participations", map[string]any{
		"runner": fx.AdminRunner.Id, "event": fx.Event.Id, "status": "interested",
	})
	if err := app.Delete(fx.Event); err != nil {
		t.Fatal(err)
	}
	for _, r := range []*core.Record{fx.F42, fx.F15, fx.P1, fx.P2, fx.P3, undecided} {
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

	// format returns the values of a valid format, with extra on top. The
	// valid base has a measure, so that a case that is refused for something
	// else is not refused for the lack of one.
	format := func(extra map[string]any) map[string]any {
		values := map[string]any{"event": fx.Event2.Id, "race_type": fx.Road.Id, "distance_km": 10}
		for k, v := range extra {
			values[k] = v
		}
		return values
	}

	// Every measure is optional at the schema level: that one of them is set
	// (format_measure_required) is a business rule enforced by a hook, which
	// events.Register attaches and which has its own tests. A zero is how
	// PocketBase stores a number that is not set.
	mustSave(t, app, "formats", format(nil))
	mustSave(t, app, "formats", format(map[string]any{"distance_km": 0, "duration_min": 360}))
	mustSave(t, app, "formats", format(map[string]any{"distance_km": 0, "time_limit_min": 2880}))
	mustSave(t, app, "formats", format(map[string]any{"time_limit_min": 2880, "distance_km": 6.706}))

	// Each case is refused for its own reason: the error is on that field
	// alone, and only the first case is refused for the missing measure.
	for _, c := range []struct {
		name  string
		extra map[string]any
		field string
		code  string // the code expected on the field, when it is not a schema one
	}{
		{"no measure", map[string]any{"distance_km": 0}, "distance_km", "format_measure_required"},
		{"decimal duration", map[string]any{"duration_min": 1.5}, "duration_min", ""},
		{"negative duration", map[string]any{"duration_min": -1}, "duration_min", ""},
		{"decimal time limit", map[string]any{"time_limit_min": 10.5}, "time_limit_min", ""},
		{"negative time limit", map[string]any{"time_limit_min": -1}, "time_limit_min", ""},
		{"negative distance", map[string]any{"distance_km": -1}, "distance_km", ""},
		{"decimal elevation", map[string]any{"elevation_gain_m": 10.5}, "elevation_gain_m", ""},
		{"negative elevation", map[string]any{"elevation_gain_m": -1}, "elevation_gain_m", ""},
		{"unknown event", map[string]any{"event": "missing"}, "event", ""},
		{"missing race type", map[string]any{"race_type": ""}, "race_type", ""},
	} {
		_, err := trySave(app, "formats", format(c.extra))
		var errs validation.Errors
		if !errors.As(err, &errs) {
			t.Errorf("%s: want validation errors, got %v", c.name, err)
			continue
		}
		if len(errs) != 1 || errs[c.field] == nil {
			t.Errorf("%s: want an error on %s alone, got %v", c.name, c.field, errs)
			continue
		}
		code := errs[c.field].(validation.Error).Code()
		if c.code != "" && code != c.code {
			t.Errorf("%s: code = %q, want %q", c.name, code, c.code)
		}
		if c.code == "" && code == "format_measure_required" {
			t.Errorf("%s: refused for the missing measure, not for the schema", c.name)
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
		// A backstop per address for the requests of /mcp that carry no valid
		// token: the limit of a token is held by the mcp package.
		"/mcp": {1500, 60},
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
		"/mcp":                                   1500,
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
		"runners", "race_types", "events", "formats", "participations", "invitations", "passkeys", "comments", "offers", "offer_members", "calendar_feeds",
		"mcp_tokens", "push_subscriptions", "reminder_deliveries",
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
	if s := app.Settings(); s.Batch.Enabled || s.RateLimits.Enabled || s.Backups.Cron != "" || len(s.TrustedProxy.Headers) != 0 {
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
	// The types are started from their name again (the migration 9i).
	backyard, err := app.FindFirstRecordByData("race_types", "label", "Backyard")
	if err != nil {
		t.Fatal(err)
	}
	if got := backyard.GetStringSlice("measures"); !slices.Equal(got, []string{"time_limit"}) {
		t.Errorf("Backyard has measures %q after applying again, want [time_limit]", got)
	}
	testutil.Seed(t, app) // the whole schema is usable again
}

// The migration 9a adds the deadline of an event and the price of a format,
// and its rollback takes them away again.
func TestMigrations_RegistrationDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	migration := migrationFile(t, "9a_registration.go")

	field := func(collection, name string) core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(collection)
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName(name)
	}

	deadline, ok := field("events", "registration_deadline").(*core.TextField)
	if !ok {
		t.Fatalf("events.registration_deadline must be a text field, got %T", field("events", "registration_deadline"))
	}
	if deadline.Required {
		t.Error("events.registration_deadline must be optional")
	}
	price, ok := field("formats", "price_eur").(*core.NumberField)
	if !ok {
		t.Fatalf("formats.price_eur must be a number field, got %T", field("formats", "price_eur"))
	}
	if price.Required || price.Min == nil || *price.Min != 0 || price.Max != nil || price.OnlyInt {
		t.Errorf("formats.price_eur = required %v, min %v, max %v, only int %v; want optional, min 0, no max, decimals",
			price.Required, price.Min, price.Max, price.OnlyInt)
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if field("events", "registration_deadline") != nil {
		t.Error("events.registration_deadline must be gone after the rollback")
	}
	if field("formats", "price_eur") != nil {
		t.Error("formats.price_eur must be gone after the rollback")
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	if _, ok := field("events", "registration_deadline").(*core.TextField); !ok {
		t.Errorf("events.registration_deadline must be a text field again, got %T", field("events", "registration_deadline"))
	}
	if _, ok := field("formats", "price_eur").(*core.NumberField); !ok {
		t.Errorf("formats.price_eur must be a number field again, got %T", field("formats", "price_eur"))
	}
}

// The migration 9b adds the status "supporter" to the participations. Its
// rollback turns the supporters into interested runners, since the status goes
// away, and applying it again brings the status back.
func TestMigrations_SupporterDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9b_supporter.go")

	statuses := func() []string {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		status, ok := c.Fields.GetByName("status").(*core.SelectField)
		if !ok {
			t.Fatalf("participations.status must be a select field, got %T", c.Fields.GetByName("status"))
		}
		return status.Values
	}
	statusOf := func(id string) string {
		t.Helper()
		r, err := app.FindRecordById("participations", id)
		if err != nil {
			t.Fatal(err)
		}
		return r.GetString("status")
	}

	want := []string{"interested", "registered", "finished", "dnf", "dns", "supporter"}
	if got := statuses(); !slices.Equal(got, want) {
		t.Errorf("participations.status values = %q, want %q", got, want)
	}

	// Sam cheers at the event of Lyon, and Admin is only interested in it.
	supporter := mustSave(t, app, "participations", map[string]any{
		"runner": fx.SamRunner.Id, "event": fx.Event2.Id, "status": "supporter", "added_by": fx.BobRunner.Id,
	})
	interested := mustSave(t, app, "participations", map[string]any{
		"runner": fx.AdminRunner.Id, "event": fx.Event2.Id, "status": "interested",
	})

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if got, want := statuses(), want[:5]; !slices.Equal(got, want) {
		t.Errorf("after the rollback, participations.status values = %q, want %q", got, want)
	}
	if got := statusOf(supporter.Id); got != "interested" {
		t.Errorf("after the rollback, the supporter is %q, want interested", got)
	}
	if got := statusOf(interested.Id); got != "interested" {
		t.Errorf("after the rollback, the interested runner is %q, want interested", got)
	}
	// The other participations, and what else the supporter had, are left as
	// they were.
	if got := statusOf(fx.P1.Id); got != "registered" {
		t.Errorf("after the rollback, P1 is %q, want registered", got)
	}
	if r, err := app.FindRecordById("participations", supporter.Id); err != nil {
		t.Fatal(err)
	} else if r.GetString("event") != fx.Event2.Id || r.GetString("runner") != fx.SamRunner.Id || r.GetString("added_by") != fx.BobRunner.Id {
		t.Errorf("after the rollback, the former supporter changed beyond its status: %v", r.FieldsData())
	}
	// The status is gone for good: the schema refuses it.
	if _, err := trySave(app, "participations", map[string]any{
		"runner": fx.BobRunner.Id, "event": fx.Event2.Id, "status": "supporter",
	}); err == nil {
		t.Error("after the rollback, the status supporter must be refused")
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	if got := statuses(); !slices.Equal(got, want) {
		t.Errorf("after applying again, participations.status values = %q, want %q", got, want)
	}
	if got := statusOf(supporter.Id); got != "interested" {
		t.Errorf("a supporter does not come back with the status: %q, want interested", got)
	}
	mustSave(t, app, "participations", map[string]any{
		"runner": fx.BobRunner.Id, "event": fx.Event2.Id, "status": "supporter",
	})
}

// The migration 9c creates the comments of an event: the table, its index and
// its rules. Its rollback drops the table, and applying it again gives it back.
func TestMigrations_CommentsDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9c_comments.go")

	collection := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("comments")
		if err != nil {
			t.Fatalf("the collection comments is missing: %v", err)
		}
		return c
	}
	// checkTable checks the fields, the index and the rules of the collection.
	checkTable := func(when string) {
		t.Helper()
		c := collection()
		relationTo := func(name, to string, cascade bool) {
			t.Helper()
			f, ok := c.Fields.GetByName(name).(*core.RelationField)
			if !ok {
				t.Fatalf("%s: comments.%s must be a relation field, got %T", when, name, c.Fields.GetByName(name))
			}
			target, err := app.FindCollectionByNameOrId(to)
			if err != nil {
				t.Fatal(err)
			}
			if f.CollectionId != target.Id || f.MaxSelect != 1 || !f.Required || f.CascadeDelete != cascade {
				t.Errorf("%s: comments.%s = collection %q, maxSelect %d, required %v, cascade %v; want %s, 1, true, %v",
					when, name, f.CollectionId, f.MaxSelect, f.Required, f.CascadeDelete, to, cascade)
			}
		}
		// A comment goes with its event, and its author is never deleted from
		// under it: a runner who wrote one cannot be deleted.
		relationTo("event", "events", true)
		relationTo("author", "runners", false)

		body, ok := c.Fields.GetByName("body").(*core.TextField)
		if !ok {
			t.Fatalf("%s: comments.body must be a text field, got %T", when, c.Fields.GetByName("body"))
		}
		if !body.Required || body.Max != 2000 {
			t.Errorf("%s: comments.body = required %v, max %d; want required, 2000", when, body.Required, body.Max)
		}
		for _, name := range []string{"created", "updated"} {
			if _, ok := c.Fields.GetByName(name).(*core.AutodateField); !ok {
				t.Errorf("%s: comments.%s must be a date field that PocketBase fills, got %T", when, name, c.Fields.GetByName(name))
			}
		}

		const index = "CREATE INDEX idx_comments_event_created ON comments (event, created)"
		if len(c.Indexes) != 1 || c.Indexes[0] != index {
			t.Errorf("%s: comments.indexes = %q, want [%q]", when, c.Indexes, index)
		}

		const (
			signedIn = `@request.auth.id != ""`
			author   = `author.user = @request.auth.id`
		)
		want := []string{
			signedIn,
			signedIn,
			signedIn,
			signedIn + ` && ` + author + ` && @request.body.author:isset = false && @request.body.event:isset = false`,
			signedIn + ` && (` + author + ` || @request.auth.role = "admin")`,
		}
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			if got == nil || *got != want[i] {
				t.Errorf("%s: comments rule %d = %v, want %q", when, i, got, want[i])
			}
		}
	}

	checkTable("as created")
	mustSave(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.AliceRunner.Id, "body": "Salut"})

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	if _, err := app.FindCollectionByNameOrId("comments"); err == nil {
		t.Error("the collection comments must be gone after the rollback")
	}
	// What the table held went with it, and nothing else did.
	mustStore := func(collection, id string) {
		t.Helper()
		if _, err := app.FindRecordById(collection, id); err != nil {
			t.Errorf("after the rollback, the %s %s is gone: %v", collection, id, err)
		}
	}
	mustStore("events", fx.Event.Id)
	mustStore("runners", fx.AliceRunner.Id)

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTable("after applying again")
	if got, err := app.CountRecords("comments"); err != nil || got != 0 {
		t.Errorf("after applying again, %d comments (error %v), want an empty table", got, err)
	}
	mustSave(t, app, "comments", map[string]any{"event": fx.Event.Id, "author": fx.BobRunner.Id, "body": "Salut"})
}

// The migration 9d creates the offers of an event (a car or a lodging) and the
// places that people take in them: the two tables, their indexes and their
// rules. Its rollback drops the places, then the offers, and applying it again
// gives them back.
func TestMigrations_OffersDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9d_offers.go")

	collection := func(name string) *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatalf("the collection %s is missing: %v", name, err)
		}
		return c
	}
	// relationTo checks a relation of a collection.
	relationTo := func(when string, c *core.Collection, name, to string, required, cascade bool) {
		t.Helper()
		f, ok := c.Fields.GetByName(name).(*core.RelationField)
		if !ok {
			t.Fatalf("%s: %s.%s must be a relation field, got %T", when, c.Name, name, c.Fields.GetByName(name))
		}
		target := collection(to)
		if f.CollectionId != target.Id || f.MaxSelect != 1 || f.Required != required || f.CascadeDelete != cascade {
			t.Errorf("%s: %s.%s = collection %q, maxSelect %d, required %v, cascade %v; want %s, 1, %v, %v",
				when, c.Name, name, f.CollectionId, f.MaxSelect, f.Required, f.CascadeDelete, to, required, cascade)
		}
	}
	timestamps := func(when string, c *core.Collection) {
		t.Helper()
		for _, name := range []string{"created", "updated"} {
			if _, ok := c.Fields.GetByName(name).(*core.AutodateField); !ok {
				t.Errorf("%s: %s.%s must be a date field that PocketBase fills, got %T", when, c.Name, name, c.Fields.GetByName(name))
			}
		}
	}
	rules := func(when string, c *core.Collection, want [5]string) {
		t.Helper()
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			switch {
			case want[i] == "" && got != nil:
				t.Errorf("%s: %s rule %d = %q, want null (superusers only)", when, c.Name, i, *got)
			case want[i] != "" && (got == nil || *got != want[i]):
				t.Errorf("%s: %s rule %d = %v, want %q", when, c.Name, i, got, want[i])
			}
		}
	}

	const (
		signedIn = `@request.auth.id != ""`
		admin    = `@request.auth.role = "admin"`
		owner    = `owner.user = @request.auth.id`
	)
	// checkTables checks the fields, the indexes and the rules of both tables.
	checkTables := func(when string) {
		t.Helper()

		offers := collection("offers")
		// An offer goes with its event, and its owner is never deleted from
		// under it: a runner who offers one cannot be deleted.
		relationTo(when, offers, "event", "events", true, true)
		relationTo(when, offers, "owner", "runners", true, false)
		kind, ok := offers.Fields.GetByName("kind").(*core.SelectField)
		if !ok {
			t.Fatalf("%s: offers.kind must be a select field, got %T", when, offers.Fields.GetByName("kind"))
		}
		if !slices.Equal(kind.Values, []string{"ride", "lodging"}) || kind.MaxSelect != 1 || !kind.Required {
			t.Errorf("%s: offers.kind = values %q, maxSelect %d, required %v; want ride and lodging, 1, true",
				when, kind.Values, kind.MaxSelect, kind.Required)
		}
		place, ok := offers.Fields.GetByName("place").(*core.TextField)
		if !ok {
			t.Fatalf("%s: offers.place must be a text field, got %T", when, offers.Fields.GetByName("place"))
		}
		if !place.Required || place.Max != 120 {
			t.Errorf("%s: offers.place = required %v, max %d; want required, 120", when, place.Required, place.Max)
		}
		seats, ok := offers.Fields.GetByName("seats").(*core.NumberField)
		if !ok {
			t.Fatalf("%s: offers.seats must be a number field, got %T", when, offers.Fields.GetByName("seats"))
		}
		if !seats.OnlyInt || seats.Required || seats.Min == nil || *seats.Min != 0 || seats.Max == nil || *seats.Max != 30 {
			t.Errorf("%s: offers.seats = onlyInt %v, required %v, min %v, max %v; want an optional integer from 0 to 30",
				when, seats.OnlyInt, seats.Required, seats.Min, seats.Max)
		}
		for _, name := range []string{"date", "time", "end_date"} {
			if f, ok := offers.Fields.GetByName(name).(*core.TextField); !ok || f.Required {
				t.Errorf("%s: offers.%s must be an optional text field, got %T", when, name, offers.Fields.GetByName(name))
			}
		}
		if f, ok := offers.Fields.GetByName("url").(*core.URLField); !ok || f.Required {
			t.Errorf("%s: offers.url must be an optional URL field, got %T", when, offers.Fields.GetByName("url"))
		}
		notes, ok := offers.Fields.GetByName("notes").(*core.TextField)
		if !ok {
			t.Fatalf("%s: offers.notes must be a text field, got %T", when, offers.Fields.GetByName("notes"))
		}
		if notes.Required || notes.Max != 1000 {
			t.Errorf("%s: offers.notes = required %v, max %d; want optional, 1000", when, notes.Required, notes.Max)
		}
		timestamps(when, offers)
		const offerIndex = "CREATE INDEX idx_offers_event_kind ON offers (event, kind)"
		if len(offers.Indexes) != 1 || offers.Indexes[0] != offerIndex {
			t.Errorf("%s: offers.indexes = %q, want [%q]", when, offers.Indexes, offerIndex)
		}
		rules(when, offers, [5]string{
			signedIn,
			signedIn,
			signedIn,
			signedIn + ` && (` + owner + ` || ` + admin + `)` +
				` && @request.body.owner:isset = false && @request.body.event:isset = false && @request.body.kind:isset = false`,
			signedIn + ` && (` + owner + ` || ` + admin + `)`,
		})

		members := collection("offer_members")
		// A place goes with its offer and with its runner. Who added it is only
		// a mark: it is not required, and it holds nobody back.
		relationTo(when, members, "offer", "offers", true, true)
		relationTo(when, members, "runner", "runners", true, true)
		relationTo(when, members, "added_by", "runners", false, false)
		timestamps(when, members)
		const memberIndex = "CREATE UNIQUE INDEX idx_offer_members_offer_runner ON offer_members (offer, runner)"
		if len(members.Indexes) != 1 || members.Indexes[0] != memberIndex {
			t.Errorf("%s: offer_members.indexes = %q, want [%q]", when, members.Indexes, memberIndex)
		}
		placeRule := signedIn + ` && (runner.user = @request.auth.id || offer.owner.user = @request.auth.id || ` + admin + `)`
		// Nobody changes a place: its update rule is null.
		rules(when, members, [5]string{signedIn, signedIn, placeRule, "", placeRule})
	}

	// saveBoth saves a car and a place in it.
	saveBoth := func() {
		t.Helper()
		car := mustSave(t, app, "offers", map[string]any{
			"event": fx.Event.Id, "kind": "ride", "owner": fx.BobRunner.Id, "place": "Lyon", "seats": 3,
		})
		mustSave(t, app, "offer_members", map[string]any{"offer": car.Id, "runner": fx.AliceRunner.Id})
	}

	checkTables("as created")
	saveBoth()

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with an offer and a place: %v", err)
	}
	for _, name := range []string{"offer_members", "offers"} {
		if _, err := app.FindCollectionByNameOrId(name); err == nil {
			t.Errorf("the collection %s must be gone after the rollback", name)
		}
	}
	// What the tables held went with them, and nothing else did.
	for name, id := range map[string]string{
		"events": fx.Event.Id, "runners": fx.AliceRunner.Id, "participations": fx.P1.Id,
	} {
		if _, err := app.FindRecordById(name, id); err != nil {
			t.Errorf("after the rollback, the %s %s is gone: %v", name, id, err)
		}
	}
	// Rolling back again, with nothing left to drop, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTables("after applying again")
	for _, name := range []string{"offers", "offer_members"} {
		if got, err := app.CountRecords(name); err != nil || got != 0 {
			t.Errorf("after applying again, %d records in %s (error %v), want an empty table", got, name, err)
		}
	}
	saveBoth()
}

// The migration 9e adds the result of a participation: a time, a rank, how many
// were ranked, and a note. Its rollback takes the four fields away, with what
// they hold, and keeps the participations; applying it again gives the fields
// back, empty.
func TestMigrations_ResultsDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9e_results.go")

	field := func(name string) core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName(name)
	}
	// checkFields checks the type and the limits of the four fields.
	checkFields := func(when string) {
		t.Helper()
		for _, name := range []string{"finish_time_s", "rank", "rank_of"} {
			f, ok := field(name).(*core.NumberField)
			if !ok {
				t.Fatalf("%s: participations.%s must be a number field, got %T", when, name, field(name))
			}
			// A whole number, 0 or more, that is 0 when it is not given.
			if !f.OnlyInt || f.Required || f.Min == nil || *f.Min != 0 || f.Max != nil {
				t.Errorf("%s: participations.%s = only int %v, required %v, min %v, max %v; want an optional integer, min 0, no max",
					when, name, f.OnlyInt, f.Required, f.Min, f.Max)
			}
		}
		note, ok := field("result_note").(*core.TextField)
		if !ok {
			t.Fatalf("%s: participations.result_note must be a text field, got %T", when, field("result_note"))
		}
		if note.Required || note.Max != 200 {
			t.Errorf("%s: participations.result_note = required %v, max %d; want optional, 200", when, note.Required, note.Max)
		}
	}
	// saveResult gives P1 a complete result.
	saveResult := func() {
		t.Helper()
		p1, err := app.FindRecordById("participations", fx.P1.Id)
		if err != nil {
			t.Fatal(err)
		}
		p1.Set("status", "finished")
		p1.Set("finish_time_s", 15130)
		p1.Set("rank", 12)
		p1.Set("rank_of", 340)
		p1.Set("result_note", "3e V1H")
		if err := app.Save(p1); err != nil {
			t.Fatal(err)
		}
	}

	checkFields("as created")
	saveResult()

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a result: %v", err)
	}
	for _, name := range []string{"finish_time_s", "rank", "rank_of", "result_note"} {
		if field(name) != nil {
			t.Errorf("participations.%s must be gone after the rollback", name)
		}
	}
	// The participation stays as it was, result apart.
	p1, err := app.FindRecordById("participations", fx.P1.Id)
	if err != nil {
		t.Fatalf("after the rollback, P1 is gone: %v", err)
	}
	if p1.GetString("status") != "finished" || p1.GetString("runner") != fx.AliceRunner.Id || p1.GetString("format") != fx.F42.Id {
		t.Errorf("after the rollback, P1 changed beyond its result: %v", p1.FieldsData())
	}
	// Rolling back again, with nothing left to remove, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkFields("after applying again")
	p1, err = app.FindRecordById("participations", fx.P1.Id)
	if err != nil {
		t.Fatal(err)
	}
	if p1.GetInt("finish_time_s") != 0 || p1.GetInt("rank") != 0 || p1.GetInt("rank_of") != 0 || p1.GetString("result_note") != "" {
		t.Errorf("after applying again, the result is %v, want it empty", p1.FieldsData())
	}
	saveResult()
}

// The migration 9f adds the track of a format, a GPX file, and the link to its
// route. Its rollback takes both fields away, with what they hold, and keeps
// the formats; applying it again gives the fields back, empty.
func TestMigrations_FormatRouteDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9f_format_route.go")

	field := func(name string) core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("formats")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName(name)
	}
	// checkFields checks the type and the limits of the two fields.
	checkFields := func(when string) {
		t.Helper()
		gpx, ok := field("gpx").(*core.FileField)
		if !ok {
			t.Fatalf("%s: formats.gpx must be a file field, got %T", when, field("gpx"))
		}
		// One file, 10 MiB at most, not protected: the site reads it with a
		// plain request, which cannot ask for a file token.
		if gpx.MaxSelect != 1 || gpx.MaxSize != 10<<20 || gpx.Protected || gpx.Required || len(gpx.Thumbs) != 0 {
			t.Errorf("%s: formats.gpx = maxSelect %d, maxSize %d, protected %v, required %v, thumbs %q; want 1, 10 MiB, false, false, none",
				when, gpx.MaxSelect, gpx.MaxSize, gpx.Protected, gpx.Required, gpx.Thumbs)
		}
		if want := []string{"application/gpx+xml", "application/xml", "text/xml"}; !slices.Equal(gpx.MimeTypes, want) {
			t.Errorf("%s: formats.gpx mime types = %q, want %q", when, gpx.MimeTypes, want)
		}

		route, ok := field("route_url").(*core.URLField)
		if !ok {
			t.Fatalf("%s: formats.route_url must be a URL field, got %T", when, field("route_url"))
		}
		// Optional, and any site: Strava, Garmin, the page of the race.
		if route.Required || len(route.OnlyDomains) != 0 || len(route.ExceptDomains) != 0 {
			t.Errorf("%s: formats.route_url = required %v, only %q, except %q; want an optional URL on any domain",
				when, route.Required, route.OnlyDomains, route.ExceptDomains)
		}
	}
	// saveRoute gives F42 a track and a link.
	saveRoute := func() {
		t.Helper()
		f42, err := app.FindRecordById("formats", fx.F42.Id)
		if err != nil {
			t.Fatal(err)
		}
		file, err := filesystem.NewFileFromBytes(testutil.GPX(t, 20), "trace.gpx")
		if err != nil {
			t.Fatal(err)
		}
		f42.Set("gpx", file)
		f42.Set("route_url", "https://www.strava.com/routes/1")
		if err := app.Save(f42); err != nil {
			t.Fatal(err)
		}
	}

	checkFields("as created")
	saveRoute()

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a track: %v", err)
	}
	for _, name := range []string{"gpx", "route_url"} {
		if field(name) != nil {
			t.Errorf("formats.%s must be gone after the rollback", name)
		}
	}
	// The format stays as it was, track and link apart.
	f42, err := app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatalf("after the rollback, F42 is gone: %v", err)
	}
	if f42.GetString("event") != fx.Event.Id || f42.GetInt("distance_km") != 42 || f42.GetInt("elevation_gain_m") != 2400 {
		t.Errorf("after the rollback, F42 changed beyond its track: %v", f42.FieldsData())
	}
	// Rolling back again, with nothing left to remove, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkFields("after applying again")
	f42, err = app.FindRecordById("formats", fx.F42.Id)
	if err != nil {
		t.Fatal(err)
	}
	if f42.GetString("gpx") != "" || f42.GetString("route_url") != "" {
		t.Errorf("after applying again, F42 has gpx %q and route_url %q, want both empty", f42.GetString("gpx"), f42.GetString("route_url"))
	}
	saveRoute()
}

// The migration 9g creates the calendar link of an account: the table, its
// unique index on the account and its rules, which are all null (only the
// routes of the calendar package read and write it). Its rollback drops the
// table, and applying it again gives it back, empty.
func TestMigrations_CalendarFeedsDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9g_calendar_feeds.go")

	collection := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("calendar_feeds")
		if err != nil {
			t.Fatalf("the collection calendar_feeds is missing: %v", err)
		}
		return c
	}
	// checkTable checks the fields, the index and the rules of the collection.
	checkTable := func(when string) {
		t.Helper()
		c := collection()

		// A link goes with its account.
		user, ok := c.Fields.GetByName("user").(*core.RelationField)
		if !ok {
			t.Fatalf("%s: calendar_feeds.user must be a relation field, got %T", when, c.Fields.GetByName("user"))
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		if user.CollectionId != users.Id || user.MaxSelect != 1 || !user.Required || !user.CascadeDelete {
			t.Errorf("%s: calendar_feeds.user = collection %q, maxSelect %d, required %v, cascade %v; want users, 1, true, true",
				when, user.CollectionId, user.MaxSelect, user.Required, user.CascadeDelete)
		}

		// Only the hash of the token is kept, and no API response shows it.
		hash, ok := c.Fields.GetByName("token_hash").(*core.TextField)
		if !ok {
			t.Fatalf("%s: calendar_feeds.token_hash must be a text field, got %T", when, c.Fields.GetByName("token_hash"))
		}
		if !hash.Required || !hash.Hidden {
			t.Errorf("%s: calendar_feeds.token_hash = required %v, hidden %v; want required and hidden", when, hash.Required, hash.Hidden)
		}

		lang, ok := c.Fields.GetByName("lang").(*core.SelectField)
		if !ok {
			t.Fatalf("%s: calendar_feeds.lang must be a select field, got %T", when, c.Fields.GetByName("lang"))
		}
		if !slices.Equal(lang.Values, []string{"fr", "en"}) || lang.MaxSelect != 1 || !lang.Required {
			t.Errorf("%s: calendar_feeds.lang = values %q, maxSelect %d, required %v; want fr and en, 1, true",
				when, lang.Values, lang.MaxSelect, lang.Required)
		}

		for _, name := range []string{"created", "updated"} {
			if _, ok := c.Fields.GetByName(name).(*core.AutodateField); !ok {
				t.Errorf("%s: calendar_feeds.%s must be a date field that PocketBase fills, got %T", when, name, c.Fields.GetByName(name))
			}
		}

		// An account has one link: a new one replaces the old.
		const index = "CREATE UNIQUE INDEX idx_calendar_feeds_user ON calendar_feeds (user)"
		if len(c.Indexes) != 1 || c.Indexes[0] != index {
			t.Errorf("%s: calendar_feeds.indexes = %q, want [%q]", when, c.Indexes, index)
		}

		// Every rule is null: nobody reads or writes the table through the
		// collection API, not even its owner.
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			if got != nil {
				t.Errorf("%s: calendar_feeds rule %d = %q, want null (superusers only)", when, i, *got)
			}
		}
	}
	saveFeed := func(user *core.Record) *core.Record {
		t.Helper()
		return mustSave(t, app, "calendar_feeds", map[string]any{"user": user.Id, "token_hash": "a1b2", "lang": "fr"})
	}

	checkTable("as created")
	saveFeed(fx.Alice)

	// The index: a second link for the same account is refused, and one for
	// another account is not.
	if _, err := trySave(app, "calendar_feeds", map[string]any{"user": fx.Alice.Id, "token_hash": "c3d4", "lang": "en"}); err == nil {
		t.Error("a second calendar link for the same account must be refused")
	} else {
		var invalid validation.Errors
		if !errors.As(err, &invalid) || invalid["user"] == nil {
			t.Errorf("the second link for an account: error %v, want a validation error on user", err)
		}
	}
	saveFeed(fx.Bob)

	// The link goes with its account.
	account := mustSave(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
	saveFeed(account)
	if err := app.Delete(account); err != nil {
		t.Fatal(err)
	}
	if got, err := app.CountRecords("calendar_feeds"); err != nil || got != 2 {
		t.Errorf("after deleting an account, %d links (error %v), want the 2 of Alice and Bob", got, err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with links: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("calendar_feeds"); err == nil {
		t.Error("the collection calendar_feeds must be gone after the rollback")
	}
	// What the table held went with it, and nothing else did.
	for name, id := range map[string]string{"users": fx.Alice.Id, "runners": fx.AliceRunner.Id} {
		if _, err := app.FindRecordById(name, id); err != nil {
			t.Errorf("after the rollback, the %s %s is gone: %v", name, id, err)
		}
	}
	// Rolling back again, with nothing left to drop, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTable("after applying again")
	if got, err := app.CountRecords("calendar_feeds"); err != nil || got != 0 {
		t.Errorf("after applying again, %d links (error %v), want an empty table", got, err)
	}
	saveFeed(fx.Alice)
}

// The migration 9h adds the token itself to the calendar link, next to its
// hash, so that the site can show the link again. The field is hidden and not
// required: the links made before the migration have none. Its rollback takes
// the field away, with the tokens, and keeps the links, which go on working
// through their hash; applying it again gives the field back, empty.
func TestMigrations_CalendarTokenDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9h_calendar_token.go")

	field := func() core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("calendar_feeds")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName("token")
	}
	checkField := func(when string) {
		t.Helper()
		token, ok := field().(*core.TextField)
		if !ok {
			t.Fatalf("%s: calendar_feeds.token must be a text field, got %T", when, field())
		}
		// Hidden, like the hash: no API response shows it. Not required: a link
		// made before the migration has none.
		if token.Required || !token.Hidden {
			t.Errorf("%s: calendar_feeds.token = required %v, hidden %v; want optional and hidden", when, token.Required, token.Hidden)
		}
	}
	// hashes is the hash that each account's link was saved with.
	hashes := map[string]string{}
	saveLink := func(user *core.Record, hash, token string) {
		t.Helper()
		values := map[string]any{"user": user.Id, "token_hash": hash, "lang": "fr"}
		if token != "" {
			values["token"] = token
		}
		mustSave(t, app, "calendar_feeds", values)
		hashes[user.Id] = hash
	}
	linkOf := func(user *core.Record) *core.Record {
		t.Helper()
		link, err := app.FindFirstRecordByData("calendar_feeds", "user", user.Id)
		if err != nil {
			t.Fatalf("the link of %s is gone: %v", user.Id, err)
		}
		return link
	}

	checkField("as created")
	// One link made before the migration (no token), one after.
	saveLink(fx.Alice, "alices-hash", "")
	saveLink(fx.Bob, "bobs-hash", "bobs-token")
	if got := linkOf(fx.Alice).GetString("token"); got != "" {
		t.Errorf("a link saved without a token has token %q, want it empty", got)
	}
	if got := linkOf(fx.Bob).GetString("token"); got != "bobs-token" {
		t.Errorf("the token of Bob's link is %q, want bobs-token", got)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with tokens: %v", err)
	}
	if field() != nil {
		t.Error("calendar_feeds.token must be gone after the rollback")
	}
	// The links stay as they were, token apart: the hash is what finds them.
	for _, user := range []*core.Record{fx.Alice, fx.Bob} {
		link := linkOf(user)
		if link.GetString("token_hash") != hashes[user.Id] || link.GetString("lang") != "fr" {
			t.Errorf("after the rollback, the link of %s changed beyond its token: %v", user.Id, link.FieldsData())
		}
	}
	// Rolling back again, with nothing left to remove, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkField("after applying again")
	for _, user := range []*core.Record{fx.Alice, fx.Bob} {
		if got := linkOf(user).GetString("token"); got != "" {
			t.Errorf("after applying again, the link of %s has token %q, want it empty", user.Id, got)
		}
	}
	// The field takes a token again.
	alice := linkOf(fx.Alice)
	alice.Set("token", "new-token")
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	if got := linkOf(fx.Alice).GetString("token"); got != "new-token" {
		t.Errorf("after applying again, the token is %q, want new-token", got)
	}
}

// The migration 9i adds `measures` to the race types: which of the four
// measures of a format (distance, elevation, duration, time limit) the type
// uses. It starts the types that exist from their name, compared without case
// or accents, and leaves the others empty, which the site reads as all four. Its
// rollback takes the field away and keeps the types; applying it again works the
// defaults out again.
func TestMigrations_RaceTypeMeasures(t *testing.T) {
	app := testutil.NewApp(t)
	migration := migrationFile(t, "9i_race_type_measures.go")

	checkField := func(when string) {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("race_types")
		if err != nil {
			t.Fatal(err)
		}
		measures, ok := c.Fields.GetByName("measures").(*core.SelectField)
		if !ok {
			t.Fatalf("%s: race_types.measures must be a select field, got %T", when, c.Fields.GetByName("measures"))
		}
		want := []string{"distance", "elevation", "duration", "time_limit"}
		if !slices.Equal(measures.Values, want) || measures.MaxSelect != 4 || measures.Required {
			t.Errorf("%s: race_types.measures = values %q, maxSelect %d, required %v; want %q, 4, false",
				when, measures.Values, measures.MaxSelect, measures.Required, want)
		}
	}
	// measuresOf is what the type of that label holds.
	measuresOf := func(label string) []string {
		t.Helper()
		record, err := app.FindFirstRecordByData("race_types", "label", label)
		if err != nil {
			t.Fatalf("the race type %q: %v", label, err)
		}
		return record.GetStringSlice("measures")
	}

	// The three kinds of default: the distance, its elevation and its cut-off
	// for a race on a course; the cut-off for a backyard; a duration for a timed
	// race. Nothing for a name that tells nothing, and for a name that only
	// looks like one (Canicross, Marathon, 10 km, 5 Hills).
	course := []string{"distance", "elevation", "time_limit"}
	duration := []string{"duration"}
	seeded := map[string][]string{
		"Route": course, "Trail": course, "Ultra-trail": course, "Cross": course,
		"Backyard": {"time_limit"}, "Hyrox": {"distance"},
	}
	added := map[string][]string{
		"COURSE NATURE":    course, // the case
		"Ultra":            course,
		"Trail des Crêtes": course, // contains « trail »
		"6 heures":         duration,
		"24h":              duration,
		"12 H":             duration, // a number then « h », whatever the case
		"6h30":             duration,
		"Chronométré":      duration, // the accent
		"Ultra en durée":   duration, // the accent, and not « Ultra » alone
		"Contre-la-montre": duration,
		"Trail 6 heures":   duration, // a timed trail is a duration
		"Backyard Ultra":   {"time_limit"},
		"Hyrox Double":     {"distance"},
		"Canicross":        nil, // « cross » alone is the type, not any word that ends with it
		"Marathon":         nil, // an « h », but no number before it
		"10 km":            nil, // a number, but no « h » after it
		"5 Hills":          nil, // « 5 h », but the « h » starts a word
		"Marche nordique":  nil,
		"Course à pied":    nil,
	}

	checkField("as created")
	for label, want := range seeded {
		if got := measuresOf(label); !slices.Equal(got, want) {
			t.Errorf("as created: %q has measures %q, want %q", label, got, want)
		}
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback: %v", err)
	}
	c, err := app.FindCollectionByNameOrId("race_types")
	if err != nil {
		t.Fatal(err)
	}
	if c.Fields.GetByName("measures") != nil {
		t.Error("race_types.measures must be gone after the rollback")
	}
	// The types stay, with their label.
	if got, _ := app.CountRecords("race_types"); got != 6 {
		t.Errorf("%d race types after the rollback, want the 6 of the seed", got)
	}
	// Rolling back again, with nothing left to remove, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	// Types made before the migration: it starts them all.
	for label := range added {
		mustSave(t, app, "race_types", map[string]any{"label": label})
	}
	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkField("after applying again")
	for label, want := range seeded {
		if got := measuresOf(label); !slices.Equal(got, want) {
			t.Errorf("after applying again: %q has measures %q, want %q", label, got, want)
		}
	}
	for label, want := range added {
		if got := measuresOf(label); !slices.Equal(got, want) {
			t.Errorf("after applying again: %q has measures %q, want %q", label, got, want)
		}
	}

	// The field takes a choice of the four, in any number, and nothing else.
	if _, err := trySave(app, "race_types", map[string]any{"label": "Sprint", "measures": []string{"distance", "duration"}}); err != nil {
		t.Errorf("two measures are refused: %v", err)
	}
	if _, err := trySave(app, "race_types", map[string]any{"label": "Vitesse", "measures": []string{"speed"}}); err == nil {
		t.Error("a measure that is not one of the four was accepted")
	}
}

// The migration 9j adds `skin` to the accounts: the theme of the site that the
// person chose, so that it follows them to every device. The server does not
// know the themes, only the shape of an id: the site ignores one it does not
// know. The rule that lets a person edit their own account then also lets them
// set it, and it is refused to everybody else, an admin included. The rollback
// takes the field away with the choices, puts the rule back, and keeps the
// accounts; applying it again works.
func TestMigrations_UserSkin(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9j_user_skin.go")

	users := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	checkField := func(when string) {
		t.Helper()
		skin, ok := users().Fields.GetByName("skin").(*core.TextField)
		if !ok {
			t.Fatalf("%s: users.skin must be a text field, got %T", when, users().Fields.GetByName("skin"))
		}
		// Not hidden: a person's own record carries it to every device they sign
		// in on. Not required: nobody has one until they choose.
		if skin.Required || skin.Hidden || skin.Max != 32 || skin.Pattern != `^[a-z][a-z0-9-]*$` {
			t.Errorf("%s: users.skin = required %v, hidden %v, max %d, pattern %q; want optional, visible, 32, ^[a-z][a-z0-9-]*$",
				when, skin.Required, skin.Hidden, skin.Max, skin.Pattern)
		}
	}
	// refusesOtherAccounts reports whether the rule that updates an account
	// keeps an admin from setting the skin of another account.
	refusesOtherAccounts := func() bool {
		t.Helper()
		rule := users().UpdateRule
		return rule != nil && strings.Contains(*rule, "@request.body.skin:isset = false")
	}
	setSkin := func(skin any) error {
		t.Helper()
		alice, err := app.FindRecordById("users", fx.Alice.Id)
		if err != nil {
			t.Fatal(err)
		}
		alice.Set("skin", skin)
		return app.Save(alice)
	}

	checkField("as created")
	if !refusesOtherAccounts() {
		t.Error("as created: the rule that updates an account must refuse an admin the skin of another account")
	}
	// An account is created without one: the site reads that as « none chosen ».
	if got := fx.Alice.GetString("skin"); got != "" {
		t.Errorf("an account made without a skin has skin %q, want it empty", got)
	}

	// The shape of an id: lower case, a letter first, then letters, digits and
	// hyphens, at most 32 characters. Empty clears the choice.
	for _, skin := range []string{"nuit", "crete", "a", "alpage-2", strings.Repeat("a", 32), ""} {
		if err := setSkin(skin); err != nil {
			t.Errorf("the skin %q is refused: %v", skin, err)
		}
	}
	for _, skin := range []string{
		"Nuit", "nuit chaud", "1nuit", "-nuit", "nuit_chaud", "nuit!", "<b>", "crête", strings.Repeat("a", 33),
	} {
		if err := setSkin(skin); err == nil {
			t.Errorf("the skin %q was accepted", skin)
		}
	}

	if err := setSkin("nuit"); err != nil {
		t.Fatal(err)
	}
	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a skin set: %v", err)
	}
	if users().Fields.GetByName("skin") != nil {
		t.Error("users.skin must be gone after the rollback")
	}
	// The accounts stay as they were, skin apart, and the rule is migration 4's again.
	alice, err := app.FindRecordById("users", fx.Alice.Id)
	if err != nil {
		t.Fatalf("Alice is gone: %v", err)
	}
	if alice.GetString("email") != "alice@example.test" || alice.GetString("role") != "member" {
		t.Errorf("after the rollback, Alice changed beyond her skin: %v", alice.FieldsData())
	}
	if rule := users().UpdateRule; rule == nil || !strings.Contains(*rule, "@request.body.role:isset = false") || refusesOtherAccounts() {
		t.Errorf("after the rollback, the update rule is %v, want migration 4's", rule)
	}
	// Rolling back again, with nothing left to remove, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkField("after applying again")
	if !refusesOtherAccounts() {
		t.Error("after applying again: the update rule must refuse an admin the skin of another account")
	}
	// The choice went with the field: the accounts start over, with none.
	if got := mustFind(t, app, "users", fx.Alice.Id).GetString("skin"); got != "" {
		t.Errorf("after applying again, Alice has skin %q, want it empty", got)
	}
	if err := setSkin("sentier"); err != nil {
		t.Errorf("a skin is refused after applying again: %v", err)
	}
}

// The migration 9k creates the personal tokens of the accounts, and adds the
// rate limit rule of /mcp to the settings. Its rollback drops the table, and
// the tokens in it, and takes the rule away; the settings of the other
// migrations stay.
func TestMigrations_MCPTokensDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9k_mcp_tokens.go")

	collection := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("mcp_tokens")
		if err != nil {
			t.Fatalf("the collection mcp_tokens is missing: %v", err)
		}
		return c
	}
	// checkTable checks the fields, the index and the rules of the collection.
	checkTable := func(when string) {
		t.Helper()
		c := collection()

		// A token goes with its account.
		user, ok := c.Fields.GetByName("user").(*core.RelationField)
		if !ok {
			t.Fatalf("%s: mcp_tokens.user must be a relation field, got %T", when, c.Fields.GetByName("user"))
		}
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		if user.CollectionId != users.Id || user.MaxSelect != 1 || !user.Required || !user.CascadeDelete {
			t.Errorf("%s: mcp_tokens.user = collection %q, maxSelect %d, required %v, cascade %v; want users, 1, true, true",
				when, user.CollectionId, user.MaxSelect, user.Required, user.CascadeDelete)
		}

		name, ok := c.Fields.GetByName("name").(*core.TextField)
		if !ok {
			t.Fatalf("%s: mcp_tokens.name must be a text field, got %T", when, c.Fields.GetByName("name"))
		}
		if !name.Required || name.Min != 1 || name.Max != 50 {
			t.Errorf("%s: mcp_tokens.name = required %v, min %d, max %d; want required, 1, 50", when, name.Required, name.Min, name.Max)
		}

		// Only the hash of the secret is kept, and no API response shows it.
		hash, ok := c.Fields.GetByName("token_hash").(*core.TextField)
		if !ok {
			t.Fatalf("%s: mcp_tokens.token_hash must be a text field, got %T", when, c.Fields.GetByName("token_hash"))
		}
		if !hash.Required || !hash.Hidden {
			t.Errorf("%s: mcp_tokens.token_hash = required %v, hidden %v; want required and hidden", when, hash.Required, hash.Hidden)
		}

		// The last use is not known for a token that was never used.
		lastUsed, ok := c.Fields.GetByName("last_used_at").(*core.DateField)
		if !ok {
			t.Fatalf("%s: mcp_tokens.last_used_at must be a date field, got %T", when, c.Fields.GetByName("last_used_at"))
		}
		if lastUsed.Required {
			t.Errorf("%s: mcp_tokens.last_used_at must not be required", when)
		}

		for _, field := range []string{"created", "updated"} {
			if _, ok := c.Fields.GetByName(field).(*core.AutodateField); !ok {
				t.Errorf("%s: mcp_tokens.%s must be a date field that PocketBase fills, got %T", when, field, c.Fields.GetByName(field))
			}
		}

		const index = "CREATE INDEX idx_mcp_tokens_user ON mcp_tokens (user)"
		if len(c.Indexes) != 1 || c.Indexes[0] != index {
			t.Errorf("%s: mcp_tokens.indexes = %q, want [%q]", when, c.Indexes, index)
		}

		// Every rule is null: nobody reads or writes the table through the
		// collection API, not even its owner.
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			if got != nil {
				t.Errorf("%s: mcp_tokens rule %d = %q, want null (superusers only)", when, i, *got)
			}
		}
	}
	// mcpRule is the rate limit rule that matches a POST to /mcp.
	mcpRule := func() (core.RateLimitRule, bool) {
		limits := app.Settings().RateLimits
		return limits.FindRateLimitRule([]string{"POST /mcp", "/mcp"})
	}
	checkRule := func(when string) {
		t.Helper()
		rule, ok := mcpRule()
		if !ok || rule.Label != "/mcp" || rule.MaxRequests != 1500 || rule.Duration != 60 || rule.Audience != "" {
			t.Errorf("%s: /mcp is limited by %+v (found %v), want 1500 requests per 60 s for everyone", when, rule, ok)
		}
		// The other rules are where they were: ours, and the defaults.
		if got := len(app.Settings().RateLimits.Rules); got != 7 {
			t.Errorf("%s: %d rate limit rules, want 7: %+v", when, got, app.Settings().RateLimits.Rules)
		}
	}
	saveToken := func(user *core.Record, name string) *core.Record {
		t.Helper()
		return mustSave(t, app, "mcp_tokens", map[string]any{"user": user.Id, "name": name, "token_hash": "a1b2"})
	}

	checkTable("as created")
	checkRule("as created")

	// The name is 1 to 50 characters.
	for _, c := range []struct {
		name string
		code string // "" when accepted
	}{
		{name: "Claude", code: ""},
		{name: strings.Repeat("é", 50), code: ""},
		{name: "", code: "validation_required"},
		{name: strings.Repeat("é", 51), code: "validation_max_text_constraint"},
	} {
		_, err := trySave(app, "mcp_tokens", map[string]any{"user": fx.Alice.Id, "name": c.name, "token_hash": "a1b2"})
		if c.code == "" {
			if err != nil {
				t.Errorf("a token named %q (%d characters) is refused: %v", c.name, len([]rune(c.name)), err)
			}
			continue
		}
		var invalid validation.Errors
		if !errors.As(err, &invalid) || invalid["name"] == nil {
			t.Errorf("a token named %q (%d characters): error %v, want a validation error on name", c.name, len([]rune(c.name)), err)
			continue
		}
		if got := invalid["name"].(validation.Error).Code(); got != c.code {
			t.Errorf("a token named %q (%d characters): code %q, want %q", c.name, len([]rune(c.name)), got, c.code)
		}
	}
	// The hash is not optional, and a token has an account.
	if _, err := trySave(app, "mcp_tokens", map[string]any{"user": fx.Alice.Id, "name": "Claude"}); err == nil {
		t.Error("a token without a hash must be refused")
	}
	if _, err := trySave(app, "mcp_tokens", map[string]any{"name": "Claude", "token_hash": "a1b2"}); err == nil {
		t.Error("a token without an account must be refused")
	}

	// The token goes with its account.
	account := mustSave(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
	saveToken(account, "Zoé")
	if err := app.Delete(account); err != nil {
		t.Fatal(err)
	}
	if got, err := app.CountRecords("mcp_tokens"); err != nil || got != 2 {
		t.Errorf("after deleting an account, %d tokens (error %v), want the 2 of Alice", got, err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with tokens: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("mcp_tokens"); err == nil {
		t.Error("the collection mcp_tokens must be gone after the rollback")
	}
	if rule, ok := mcpRule(); ok {
		t.Errorf("after the rollback /mcp is still limited by %+v", rule)
	}
	// What the table held went with it, and nothing else did.
	for name, id := range map[string]string{"users": fx.Alice.Id, "runners": fx.AliceRunner.Id} {
		if _, err := app.FindRecordById(name, id); err != nil {
			t.Errorf("after the rollback, the %s %s is gone: %v", name, id, err)
		}
	}
	// The rules of the other migrations are still there.
	if rule, ok := app.Settings().RateLimits.FindRateLimitRule([]string{"POST /api/app/invitations/x", "/api/app/invitations/x"}); !ok || rule.MaxRequests != 10 {
		t.Errorf("after the rollback, the invitations are limited by %+v (found %v), want 10", rule, ok)
	}
	if got := len(app.Settings().RateLimits.Rules); got != 6 {
		t.Errorf("after the rollback, %d rate limit rules, want the 6 that were there before", got)
	}
	// Rolling back again, with nothing left to drop, is not an error.
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTable("after applying again")
	checkRule("after applying again")
	if got, err := app.CountRecords("mcp_tokens"); err != nil || got != 0 {
		t.Errorf("after applying again, %d tokens (error %v), want an empty table", got, err)
	}
	saveToken(fx.Alice, "Claude")
}

// mustFind reads a record that must be there.
func mustFind(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

// The migration 9l adds the opening of the registration to the events: a day
// and an optional time. Its rollback removes both fields, and what they hold.
func TestMigrations_RegistrationOpeningDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9l_registration_opening.go")

	// An event that was there before: it stays valid through the rollback and
	// through applying again, and the values go with the fields.
	event := func() *core.Record {
		t.Helper()
		return mustFind(t, app, "events", fx.Event.Id)
	}
	// stillSaves saves the event again, as an edit of its name does, and checks
	// what it holds of the opening.
	stillSaves := func(when, day, hhmm string) {
		t.Helper()
		e := event()
		e.Set("notes", when)
		if err := app.Save(e); err != nil {
			t.Fatalf("%s: the event does not save: %v", when, err)
		}
		if got, got2 := event().GetString("registration_opening"), event().GetString("registration_opening_time"); got != day || got2 != hhmm {
			t.Errorf("%s: the event opens on %q at %q, want %q at %q", when, got, got2, day, hhmm)
		}
	}

	field := func(name string) core.Field {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("events")
		if err != nil {
			t.Fatal(err)
		}
		return c.Fields.GetByName(name)
	}
	check := func(when string) {
		t.Helper()
		for _, name := range []string{"registration_opening", "registration_opening_time"} {
			f, ok := field(name).(*core.TextField)
			if !ok {
				t.Fatalf("%s: events.%s must be a text field, got %T", when, name, field(name))
			}
			if f.Required || f.Hidden {
				t.Errorf("%s: events.%s must be optional and visible", when, name)
			}
		}
	}

	check("as created")
	stillSaves("as created", "", "")
	opened := event()
	opened.Set("registration_opening", "2026-05-01")
	opened.Set("registration_opening_time", "10:00")
	if err := app.Save(opened); err != nil {
		t.Fatalf("an opening is refused: %v", err)
	}
	stillSaves("with an opening", "2026-05-01", "10:00")

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"registration_opening", "registration_opening_time"} {
		if field(name) != nil {
			t.Errorf("events.%s must be gone after the rollback", name)
		}
	}
	// The event is still there, and valid, without the values.
	if event().GetString("name") != fx.Event.GetString("name") {
		t.Error("the event changed beyond its opening")
	}
	stillSaves("after the rollback", "", "")

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	check("after applying again")
	// The values went with the fields: the event starts over with none, and saves.
	stillSaves("after applying again", "", "")
}

// The migration 9m adds the reminders to the accounts: a choice of at most two
// of "day" and "hour", empty by default, and one more condition on the update
// rule, which keeps an admin from setting those of another account.
func TestMigrations_UserRemindersDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9m_user_reminders.go")

	users := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	checkField := func(when string) {
		t.Helper()
		reminders, ok := users().Fields.GetByName("reminders").(*core.SelectField)
		if !ok {
			t.Fatalf("%s: users.reminders must be a select field, got %T", when, users().Fields.GetByName("reminders"))
		}
		if reminders.Required || reminders.Hidden || reminders.MaxSelect != 2 || !slices.Equal(reminders.Values, []string{"day", "hour"}) {
			t.Errorf("%s: users.reminders = required %v, hidden %v, max %d, values %v; want optional, visible, 2, [day hour]",
				when, reminders.Required, reminders.Hidden, reminders.MaxSelect, reminders.Values)
		}
	}
	// The two rules, written out: the one of 9j before this migration, and the
	// same with one more condition inside the admin's parentheses. Compared by
	// equality, so that a change to any other clause on the way is seen.
	const ruleOf9j = `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false)` +
		` || (@request.auth.role = "admin" && @request.body.email:isset = false && @request.body.password:isset = false && @request.body.skin:isset = false)`
	ruleOf9m := ruleOf9j[:len(ruleOf9j)-1] + ` && @request.body.reminders:isset = false)`
	updateRule := func() string {
		t.Helper()
		rule := users().UpdateRule
		if rule == nil {
			return "<nil>"
		}
		return *rule
	}
	setReminders := func(value any) error {
		t.Helper()
		alice := mustFind(t, app, "users", fx.Alice.Id)
		alice.Set("reminders", value)
		return app.Save(alice)
	}

	checkField("as created")
	if got := updateRule(); got != ruleOf9m {
		t.Errorf("as created: the update rule of the accounts is\n%s\nwant\n%s", got, ruleOf9m)
	}
	if got := fx.Alice.GetStringSlice("reminders"); len(got) != 0 {
		t.Errorf("an account made without reminders has %v, want none", got)
	}
	for _, ok := range [][]string{{}, {"day"}, {"hour"}, {"day", "hour"}} {
		if err := setReminders(ok); err != nil {
			t.Errorf("the reminders %v are refused: %v", ok, err)
		}
	}
	for _, bad := range [][]string{{"week"}, {"day", "week"}} {
		if err := setReminders(bad); err == nil {
			t.Errorf("the reminders %v were accepted", bad)
		}
	}

	if err := setReminders([]string{"day", "hour"}); err != nil {
		t.Fatal(err)
	}
	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with reminders set: %v", err)
	}
	if users().Fields.GetByName("reminders") != nil {
		t.Error("users.reminders must be gone after the rollback")
	}
	if got := updateRule(); got != ruleOf9j {
		t.Errorf("after the rollback, the update rule is\n%s\nwant the one of 9j\n%s", got, ruleOf9j)
	}
	if alice := mustFind(t, app, "users", fx.Alice.Id); alice.GetString("email") != "alice@example.test" {
		t.Errorf("after the rollback, Alice changed beyond her reminders: %v", alice.FieldsData())
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkField("after applying again")
	if got := updateRule(); got != ruleOf9m {
		t.Errorf("after applying again, the update rule is\n%s\nwant\n%s", got, ruleOf9m)
	}
	if got := mustFind(t, app, "users", fx.Alice.Id).GetStringSlice("reminders"); len(got) != 0 {
		t.Errorf("after applying again, Alice has reminders %v, want none", got)
	}
	if err := setReminders([]string{"hour"}); err != nil {
		t.Errorf("reminders are refused after applying again: %v", err)
	}
}

// The migration 9n creates the subscriptions to the notifications, one per
// device. Its rollback drops the table, and what is in it; the accounts stay.
func TestMigrations_PushSubscriptionsDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9n_push_subscriptions.go")

	collection := func() *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("push_subscriptions")
		if err != nil {
			t.Fatalf("the collection push_subscriptions is missing: %v", err)
		}
		return c
	}
	checkTable := func(when string) {
		t.Helper()
		c := collection()
		users, _ := app.FindCollectionByNameOrId("users")
		user, ok := c.Fields.GetByName("user").(*core.RelationField)
		if !ok || user.CollectionId != users.Id || user.MaxSelect != 1 || !user.Required || !user.CascadeDelete {
			t.Errorf("%s: push_subscriptions.user = %+v, want a required relation to users, one, cascade", when, c.Fields.GetByName("user"))
		}
		for name, want := range map[string]struct {
			required, hidden bool
			max              int
		}{
			"endpoint": {true, false, 1000}, "p256dh": {true, true, 0}, "auth": {true, true, 0}, "label": {false, false, 60},
		} {
			f, ok := c.Fields.GetByName(name).(*core.TextField)
			if !ok {
				t.Fatalf("%s: push_subscriptions.%s must be a text field, got %T", when, name, c.Fields.GetByName(name))
			}
			if f.Required != want.required || f.Hidden != want.hidden || f.Max != want.max {
				t.Errorf("%s: push_subscriptions.%s = required %v, hidden %v, max %d; want %v, %v, %d",
					when, name, f.Required, f.Hidden, f.Max, want.required, want.hidden, want.max)
			}
		}
		lang, ok := c.Fields.GetByName("lang").(*core.SelectField)
		if !ok || !lang.Required || lang.MaxSelect != 1 || !slices.Equal(lang.Values, []string{"fr", "en"}) {
			t.Errorf("%s: push_subscriptions.lang = %+v, want a required select of fr, en", when, c.Fields.GetByName("lang"))
		}
		if f, ok := c.Fields.GetByName("last_success_at").(*core.DateField); !ok || f.Required {
			t.Errorf("%s: push_subscriptions.last_success_at must be an optional date field", when)
		}
		failures, ok := c.Fields.GetByName("failures").(*core.NumberField)
		if !ok || !failures.OnlyInt || failures.Min == nil || *failures.Min != 0 || failures.Required {
			t.Errorf("%s: push_subscriptions.failures = %+v, want an integer of at least 0", when, c.Fields.GetByName("failures"))
		}
		for _, field := range []string{"created", "updated"} {
			if _, ok := c.Fields.GetByName(field).(*core.AutodateField); !ok {
				t.Errorf("%s: push_subscriptions.%s must be a date field that PocketBase fills", when, field)
			}
		}
		wantIndexes := []string{
			"CREATE UNIQUE INDEX idx_push_subscriptions_endpoint ON push_subscriptions (endpoint)",
			"CREATE INDEX idx_push_subscriptions_user ON push_subscriptions (user)",
		}
		if !slices.Equal([]string(c.Indexes), wantIndexes) {
			t.Errorf("%s: push_subscriptions.indexes = %q, want %q", when, c.Indexes, wantIndexes)
		}
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			if got != nil {
				t.Errorf("%s: push_subscriptions rule %d = %q, want null (superusers only)", when, i, *got)
			}
		}
	}
	device := func(endpoint string) map[string]any {
		return map[string]any{"user": fx.Alice.Id, "endpoint": endpoint, "p256dh": "k", "auth": "a", "lang": "fr"}
	}
	with := func(endpoint, key string, value any) map[string]any {
		values := device(endpoint)
		values[key] = value
		return values
	}

	checkTable("as created")

	mustSave(t, app, "push_subscriptions", device("https://fcm.googleapis.com/one"))
	noKeys := device("https://fcm.googleapis.com/two")
	delete(noKeys, "p256dh")
	delete(noKeys, "auth")
	noAccount := device("https://fcm.googleapis.com/two")
	delete(noAccount, "user")
	for name, values := range map[string]map[string]any{
		"the same endpoint again":         device("https://fcm.googleapis.com/one"),
		"no endpoint":                     device(""),
		"an endpoint over 1000":           device("https://fcm.googleapis.com/" + strings.Repeat("x", 1000)),
		"a language that is not fr or en": with("https://fcm.googleapis.com/two", "lang", "de"),
		"no keys":                         noKeys,
		"no account":                      noAccount,
		"a negative count":                with("https://fcm.googleapis.com/two", "failures", -1),
		"a label over 60":                 with("https://fcm.googleapis.com/two", "label", strings.Repeat("é", 61)),
	} {
		if _, err := trySave(app, "push_subscriptions", values); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}

	// The device goes with its account.
	account := mustSave(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
	mustSave(t, app, "push_subscriptions", with("https://fcm.googleapis.com/zoe", "user", account.Id))
	if err := app.Delete(account); err != nil {
		t.Fatal(err)
	}
	if got, err := app.CountRecords("push_subscriptions"); err != nil || got != 1 {
		t.Errorf("after deleting an account, %d subscriptions (error %v), want the 1 of Alice", got, err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with subscriptions: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("push_subscriptions"); err == nil {
		t.Error("the collection push_subscriptions must be gone after the rollback")
	}
	if _, err := app.FindRecordById("users", fx.Alice.Id); err != nil {
		t.Errorf("after the rollback, Alice is gone: %v", err)
	}
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTable("after applying again")
	if got, err := app.CountRecords("push_subscriptions"); err != nil || got != 0 {
		t.Errorf("after applying again, %d subscriptions (error %v), want an empty table", got, err)
	}
}

func TestMigrations_ReminderDeliveriesDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9o_reminder_deliveries.go")

	checkTable := func(when string) {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("reminder_deliveries")
		if err != nil {
			t.Fatalf("%s: the collection reminder_deliveries is missing: %v", when, err)
		}
		for name, target := range map[string]string{"user": "users", "event": "events"} {
			to, _ := app.FindCollectionByNameOrId(target)
			rel, ok := c.Fields.GetByName(name).(*core.RelationField)
			if !ok || rel.CollectionId != to.Id || rel.MaxSelect != 1 || !rel.Required || !rel.CascadeDelete {
				t.Errorf("%s: reminder_deliveries.%s = %+v, want a required relation to %s, one, cascade", when, name, c.Fields.GetByName(name), target)
			}
		}
		kind, ok := c.Fields.GetByName("kind").(*core.SelectField)
		if !ok || !kind.Required || kind.MaxSelect != 1 || !slices.Equal(kind.Values, []string{"day", "hour"}) {
			t.Errorf("%s: reminder_deliveries.kind = %+v, want a required select of day, hour", when, c.Fields.GetByName("kind"))
		}
		if f, ok := c.Fields.GetByName("opening_at").(*core.TextField); !ok || !f.Required {
			t.Errorf("%s: reminder_deliveries.opening_at must be a required text field", when)
		}
		delivered, ok := c.Fields.GetByName("delivered").(*core.NumberField)
		if !ok || !delivered.OnlyInt || delivered.Min == nil || *delivered.Min != 0 {
			t.Errorf("%s: reminder_deliveries.delivered = %+v, want an integer of at least 0", when, c.Fields.GetByName("delivered"))
		}
		if _, ok := c.Fields.GetByName("created").(*core.AutodateField); !ok {
			t.Errorf("%s: reminder_deliveries.created must be a date field that PocketBase fills", when)
		}
		wantIndexes := []string{
			"CREATE UNIQUE INDEX idx_reminder_deliveries_once ON reminder_deliveries (user, event, kind, opening_at)",
			"CREATE INDEX idx_reminder_deliveries_created ON reminder_deliveries (created)",
		}
		if !slices.Equal([]string(c.Indexes), wantIndexes) {
			t.Errorf("%s: reminder_deliveries.indexes = %q, want %q", when, c.Indexes, wantIndexes)
		}
		for i, got := range []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule} {
			if got != nil {
				t.Errorf("%s: reminder_deliveries rule %d = %q, want null (superusers only)", when, i, *got)
			}
		}
	}
	row := func(user, event *core.Record, kind, at string) map[string]any {
		return map[string]any{"user": user.Id, "event": event.Id, "kind": kind, "opening_at": at, "delivered": 1}
	}
	const at = "2026-12-01T09:00:00Z"
	checkTable("as created")

	mustSave(t, app, "reminder_deliveries", row(fx.Alice, fx.Event, "day", at))
	// Another kind, another opening, another person, another event: other rows.
	mustSave(t, app, "reminder_deliveries", row(fx.Alice, fx.Event, "hour", at))
	mustSave(t, app, "reminder_deliveries", row(fx.Alice, fx.Event, "day", "2026-12-02T09:00:00Z"))
	mustSave(t, app, "reminder_deliveries", row(fx.Bob, fx.Event, "day", at))
	mustSave(t, app, "reminder_deliveries", row(fx.Alice, fx.Event2, "day", at))
	noAccount := row(fx.Alice, fx.Event, "day", "2026-12-03T09:00:00Z")
	delete(noAccount, "user")
	noEvent := row(fx.Alice, fx.Event, "day", "2026-12-03T09:00:00Z")
	delete(noEvent, "event")
	noOpening := row(fx.Alice, fx.Event, "day", "")
	for name, values := range map[string]map[string]any{
		"the same row again":             row(fx.Alice, fx.Event, "day", at),
		"a kind that is not day or hour": row(fx.Alice, fx.Event, "week", "2026-12-03T09:00:00Z"),
		"no account":                     noAccount,
		"no event":                       noEvent,
		"no opening":                     noOpening,
		"a negative count":               func() map[string]any { v := row(fx.Bob, fx.Event2, "day", at); v["delivered"] = -1; return v }(),
	} {
		if _, err := trySave(app, "reminder_deliveries", values); err == nil {
			t.Errorf("%s must be refused", name)
		}
	}

	// A row goes with its account, and with its event.
	account := mustSave(t, app, "users", map[string]any{"email": "zoe@example.test", "password": testutil.Password, "role": "member"})
	mustSave(t, app, "reminder_deliveries", row(account, fx.Event, "day", at))
	if err := app.Delete(account); err != nil {
		t.Fatal(err)
	}
	if got, err := app.CountRecords("reminder_deliveries"); err != nil || got != 5 {
		t.Errorf("after deleting an account, %d rows (error %v), want the 5 of the others", got, err)
	}

	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with rows: %v", err)
	}
	if _, err := app.FindCollectionByNameOrId("reminder_deliveries"); err == nil {
		t.Error("the collection reminder_deliveries must be gone after the rollback")
	}
	if _, err := app.FindRecordById("events", fx.Event.Id); err != nil {
		t.Errorf("after the rollback, the event is gone: %v", err)
	}
	if err := migration.Down(app); err != nil {
		t.Errorf("the rollback of a migration that is already rolled back: %v", err)
	}
	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkTable("after applying again")
	if got, err := app.CountRecords("reminder_deliveries"); err != nil || got != 0 {
		t.Errorf("after applying again, %d rows (error %v), want an empty table", got, err)
	}
}
