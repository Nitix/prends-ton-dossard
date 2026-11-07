package migrations_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// records builds the URL of a collection's records, or of one of them.
func records(collection string, id ...string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		url := "/api/collections/" + collection + "/records"
		if len(id) > 0 {
			url += "/" + id[0]
		}
		return url
	}
}

// recordOf is like records for a record of the fixture.
func recordOf(collection string, record func(testutil.Fixture) *core.Record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		return records(collection, record(fx).Id)(fx)
	}
}

// body returns a fixed JSON request body.
func body(json string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return json }
}

// exists reports whether the record of that collection and id is in the database.
func exists(app core.App, collection, id string) bool {
	_, err := app.FindRecordById(collection, id)
	return err == nil
}

// setFields updates the given fields of an existing record, bypassing the rules.
func setFields(t testing.TB, app core.App, collection, id string, values map[string]any) {
	t.Helper()
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		t.Fatal(err)
	}
	for k, v := range values {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
}

// measuresOf reads the measures a race type is stored with.
func measuresOf(t testing.TB, app core.App, id string) []string {
	t.Helper()
	record, err := app.FindRecordById("race_types", id)
	if err != nil {
		t.Fatal(err)
	}
	return record.GetStringSlice("measures")
}

// The status codes below are the ones PocketBase answers when a rule refuses a
// request: an empty page for a list, 404 for a view, update or delete (so that
// a record's existence is not revealed), 400 for a create, and 403 when the
// rule is null (superuser only).
func TestRules(t *testing.T) {
	aliceRunner := func(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
	bobRunner := func(fx testutil.Fixture) *core.Record { return fx.BobRunner }
	samRunner := func(fx testutil.Fixture) *core.Record { return fx.SamRunner }

	testutil.RunRows(t, []testutil.Row{
		// users
		{
			Name:     "alice cannot view bob",
			As:       "alice",
			Method:   http.MethodGet,
			URL:      recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Bob }),
			Status:   http.StatusNotFound,
			Contains: []string{`"status":404`},
		},
		{
			Name:     "alice views herself",
			As:       "alice",
			Method:   http.MethodGet,
			URL:      recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Alice }),
			Status:   http.StatusOK,
			Contains: []string{"alice@example.test"},
		},
		{
			Name:     "admin views bob",
			As:       "admin",
			Method:   http.MethodGet,
			URL:      recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Bob }),
			Status:   http.StatusOK,
			Contains: []string{"bob@example.test"},
		},
		{
			Name:   "alice cannot make herself admin",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Alice }),
			Body:   body(`{"role":"admin"}`),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindRecordById("users", fx.Alice.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := user.GetString("role"); got != "member" {
					t.Errorf("alice's role = %q, want member", got)
				}
			},
		},
		{
			Name:   "admin changes the role of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Bob }),
			Body:   body(`{"role":"admin"}`),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindRecordById("users", fx.Bob.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := user.GetString("role"); got != "admin" {
					t.Errorf("bob's role = %q, want admin", got)
				}
			},
		},
		{
			Name:   "admin cannot change the password of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Bob }),
			Body:   body(`{"password":"x-123456789","passwordConfirm":"x-123456789"}`),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindRecordById("users", fx.Bob.Id)
				if err != nil {
					t.Fatal(err)
				}
				if !user.ValidatePassword(testutil.Password) {
					t.Error("bob's password must be unchanged")
				}
			},
		},
		{
			// An admin has no oldPassword requirement for the accounts of others
			// (and cannot change them anyway), but must have one for their own.
			Name:   "admin cannot change their own password without the old one",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Admin }),
			Body:   body(`{"password":"x-123456789","passwordConfirm":"x-123456789"}`),
			Status: http.StatusBadRequest,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindRecordById("users", fx.Admin.Id)
				if err != nil {
					t.Fatal(err)
				}
				if !user.ValidatePassword(testutil.Password) {
					t.Error("the password of the admin must be unchanged")
				}
			},
		},
		{
			Name:   "admin changes their own password with the old one",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", func(fx testutil.Fixture) *core.Record { return fx.Admin }),
			Body: body(`{"oldPassword":"password-123","password":"x-123456789",` +
				`"passwordConfirm":"x-123456789"}`),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindRecordById("users", fx.Admin.Id)
				if err != nil {
					t.Fatal(err)
				}
				if !user.ValidatePassword("x-123456789") {
					t.Error("the password of the admin must have changed")
				}
			},
		},
		{
			Name:   "nobody signs up through the API",
			As:     "anon",
			Method: http.MethodPost,
			URL:    records("users"),
			Body: body(`{"email":"new@example.test","password":"password-123",` +
				`"passwordConfirm":"password-123","role":"member"}`),
			Status: http.StatusForbidden,
		},

		// runners
		{
			Name:     "anon lists no runner",
			As:       "anon",
			Method:   http.MethodGet,
			URL:      records("runners"),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":0`},
		},
		{
			Name:     "alice lists the runners",
			As:       "alice",
			Method:   http.MethodGet,
			URL:      records("runners"),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":4`},
		},
		{
			Name:   "alice cannot create a runner",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("runners"),
			Body:   body(`{"name":"Zoé"}`),
			Status: http.StatusBadRequest,
		},
		{
			Name:   "admin creates a runner",
			As:     "admin",
			Method: http.MethodPost,
			URL:    records("runners"),
			Body:   body(`{"name":"Zoé"}`),
			Status: http.StatusOK,
		},
		{
			Name:   "alice renames her runner",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", aliceRunner),
			Body:   body(`{"name":"Alice B."}`),
			Status: http.StatusOK,
		},
		{
			Name:   "alice cannot rename the runner of bob",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", bobRunner),
			Body:   body(`{"name":"X"}`),
			Status: http.StatusNotFound,
		},
		{
			Name:   "alice cannot link her runner to bob",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", aliceRunner),
			Body:   func(fx testutil.Fixture) string { return fmt.Sprintf(`{"user":%q}`, fx.Bob.Id) },
			Status: http.StatusNotFound,
		},
		{
			Name:   "not even admin links a runner to an account",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("runners", samRunner),
			Body:   func(fx testutil.Fixture) string { return fmt.Sprintf(`{"user":%q}`, fx.Alice.Id) },
			Status: http.StatusNotFound,
		},
		{
			Name:   "alice cannot delete a runner",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    recordOf("runners", samRunner),
			Status: http.StatusNotFound,
		},
		{
			// Sam has no account: for an anonymous request, "user is the
			// caller" must not match an empty user.
			Name:   "anon cannot rename a runner without account",
			As:     "anon",
			Method: http.MethodPatch,
			URL:    recordOf("runners", samRunner),
			Body:   body(`{"name":"Hacked"}`),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				runner, err := app.FindRecordById("runners", fx.SamRunner.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := runner.GetString("name"); got != "Sam" {
					t.Errorf("Sam's runner is named %q, want it unchanged", got)
				}
			},
		},
		{
			Name:   "alice cannot rename a runner without account",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("runners", samRunner),
			Body:   body(`{"name":"Hacked"}`),
			Status: http.StatusNotFound,
		},

		// race_types
		{
			Name:     "alice lists the race types",
			As:       "alice",
			Method:   http.MethodGet,
			URL:      records("race_types"),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":6`},
		},
		{
			Name:   "alice cannot create a race type",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("race_types"),
			Body:   body(`{"label":"Triathlon"}`),
			Status: http.StatusBadRequest,
		},
		{
			Name:   "admin creates a race type",
			As:     "admin",
			Method: http.MethodPost,
			URL:    records("race_types"),
			Body:   body(`{"label":"Triathlon"}`),
			Status: http.StatusOK,
		},
		// The measures a race type says it uses (migration 9i) are an update like
		// any other: the demo hands a member session to anyone, so a member must
		// not be able to change what the form shows for everybody.
		{
			Name:   "alice cannot change the measures of a race type",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("race_types", func(fx testutil.Fixture) *core.Record { return fx.Backyard }),
			Body:   body(`{"measures":["distance"]}`),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := measuresOf(t, app, fx.Backyard.Id); !slices.Equal(got, []string{"time_limit"}) {
					t.Errorf("the measures of the Backyard are %q, want [time_limit]", got)
				}
			},
		},
		{
			Name:   "admin changes the measures of a race type",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("race_types", func(fx testutil.Fixture) *core.Record { return fx.Backyard }),
			Body:   body(`{"measures":["distance"]}`),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := measuresOf(t, app, fx.Backyard.Id); !slices.Equal(got, []string{"distance"}) {
					t.Errorf("the measures of the Backyard are %q, want [distance]", got)
				}
			},
		},
		{
			Name:   "admin deletes an unused race type",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    recordOf("race_types", func(fx testutil.Fixture) *core.Record { return fx.Cross }),
			Status: http.StatusNoContent,
		},

		// events
		{
			Name:   "bob edits the event of alice",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Body:   body(`{"location":"Chamonix"}`),
			Status: http.StatusOK,
		},
		{
			Name:   "bob cannot delete the event of alice",
			As:     "bob",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "events", fx.Event.Id) {
					t.Error("the event must survive")
				}
			},
		},
		{
			Name:   "alice deletes her event with its formats and participations",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Status: http.StatusNoContent,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if exists(app, "events", fx.Event.Id) {
					t.Error("the event must be deleted")
				}
				if exists(app, "formats", fx.F42.Id) {
					t.Error("the format F42 must be deleted with its event")
				}
				if exists(app, "participations", fx.P1.Id) {
					t.Error("the participation P1 must be deleted with its format")
				}
			},
		},
		{
			Name:   "anon cannot delete an event without creator",
			As:     "anon",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "events", fx.Event.Id, map[string]any{"created_by": ""})
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "events", fx.Event.Id) {
					t.Error("the event must survive")
				}
			},
		},
		{
			Name:   "anon cannot delete an event created by a runner without account",
			As:     "anon",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "events", fx.Event.Id, map[string]any{"created_by": fx.SamRunner.Id})
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "events", fx.Event.Id) {
					t.Error("the event must survive")
				}
			},
		},
		{
			Name:   "alice cannot delete an event created by a runner without account",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event }),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "events", fx.Event.Id, map[string]any{"created_by": fx.SamRunner.Id})
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "events", fx.Event.Id) {
					t.Error("the event must survive")
				}
			},
		},
		{
			Name:   "admin deletes the event of bob",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    recordOf("events", func(fx testutil.Fixture) *core.Record { return fx.Event2 }),
			Status: http.StatusNoContent,
		},

		// formats
		{
			Name:   "bob adds a format to the event of alice",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: func(fx testutil.Fixture) string {
				return fmt.Sprintf(`{"event":%q,"race_type":%q,"distance_km":21.1}`, fx.Event.Id, fx.Road.Id)
			},
			Status: http.StatusOK,
		},
		{
			Name:   "bob edits a format of alice",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    recordOf("formats", func(fx testutil.Fixture) *core.Record { return fx.F42 }),
			Body:   body(`{"distance_km":43}`),
			Status: http.StatusOK,
		},
		{
			Name:   "bob cannot move a format to another event",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    recordOf("formats", func(fx testutil.Fixture) *core.Record { return fx.F42 }),
			Body:   func(fx testutil.Fixture) string { return fmt.Sprintf(`{"event":%q}`, fx.Event2.Id) },
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				format, err := app.FindRecordById("formats", fx.F42.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := format.GetString("event"); got != fx.Event.Id {
					t.Errorf("F42.event = %q, want it unchanged (%q)", got, fx.Event.Id)
				}
			},
		},
		{
			Name:   "bob cannot delete a format of the event of alice",
			As:     "bob",
			Method: http.MethodDelete,
			URL:    recordOf("formats", func(fx testutil.Fixture) *core.Record { return fx.F42 }),
			Status: http.StatusNotFound,
		},
		{
			Name:   "anon cannot delete a format of an event without creator",
			As:     "anon",
			Method: http.MethodDelete,
			URL:    recordOf("formats", func(fx testutil.Fixture) *core.Record { return fx.F42 }),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				setFields(t, app, "events", fx.Event.Id, map[string]any{"created_by": ""})
			},
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "formats", fx.F42.Id) {
					t.Error("the format must survive")
				}
			},
		},
		{
			Name:   "alice deletes a format of her event",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    recordOf("formats", func(fx testutil.Fixture) *core.Record { return fx.F42 }),
			Status: http.StatusNoContent,
		},

		// invitations
		{
			// An empty page, not a 403: the rule is not null. The same request
			// with an invitation in the database is in TestRules_Invitations.
			Name:     "alice cannot list the invitations",
			As:       "alice",
			Method:   http.MethodGet,
			URL:      records("invitations"),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":0`},
		},
		{
			Name:        "admin lists the invitations",
			As:          "admin",
			Method:      http.MethodGet,
			URL:         records("invitations"),
			Status:      http.StatusOK,
			NotContains: []string{"token_hash"},
		},

		// passkeys
		{
			Name:   "alice cannot create a passkey through the API",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("passkeys"),
			Body: func(fx testutil.Fixture) string {
				return fmt.Sprintf(`{"user":%q,"name":"Phone","credential_id":"abc","credential":{"id":"abc"}}`, fx.Alice.Id)
			},
			Status: http.StatusForbidden,
		},
	})
}

// With an invitation in the database: the rows of TestRules cannot tell an
// empty page from a refused one, and an empty collection has no token_hash to
// leak.
func TestRules_Invitations(t *testing.T) {
	scenarios := []struct {
		name        string
		as          string
		url         func(invitation *core.Record) string
		status      int
		contains    []string
		notContains []string
	}{
		{
			name:        "alice lists none",
			as:          "alice",
			url:         func(*core.Record) string { return "/api/collections/invitations/records" },
			status:      http.StatusOK,
			contains:    []string{`"totalItems":0`},
			notContains: []string{"token_hash"},
		},
		{
			name:        "alice cannot view one",
			as:          "alice",
			url:         func(i *core.Record) string { return "/api/collections/invitations/records/" + i.Id },
			status:      http.StatusNotFound,
			notContains: []string{"token_hash"},
		},
		{
			name:        "admin lists it without its token hash",
			as:          "admin",
			url:         func(*core.Record) string { return "/api/collections/invitations/records" },
			status:      http.StatusOK,
			contains:    []string{`"totalItems":1`, `"kind":"invite"`},
			notContains: []string{"token_hash", "deadbeef"},
		},
		{
			name:        "admin views it without its token hash",
			as:          "admin",
			url:         func(i *core.Record) string { return "/api/collections/invitations/records/" + i.Id },
			status:      http.StatusOK,
			contains:    []string{`"kind":"invite"`},
			notContains: []string{"token_hash", "deadbeef"},
		},
	}

	for _, s := range scenarios {
		t.Run(s.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			invitation := mustSave(t, app, "invitations", map[string]any{
				"runner":     fx.SamRunner.Id,
				"kind":       "invite",
				"role":       "member",
				"token_hash": "deadbeef",
				"expires_at": "2030-01-01 00:00:00.000Z",
			})

			user := fx.Alice
			if s.as == "admin" {
				user = fx.Admin
			}
			(&tests.ApiScenario{
				Method:                http.MethodGet,
				URL:                   s.url(invitation),
				Headers:               map[string]string{"Authorization": testutil.Token(t, user)},
				ExpectedStatus:        s.status,
				ExpectedContent:       s.contains,
				NotExpectedContent:    s.notContains,
				TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
				DisableTestAppCleanup: true,
			}).Test(t)
		})
	}
}

// A null rule is what keeps the API out of the writes that only the routes of
// the application (or the command line) may do: nothing else can regress it
// silently, since a request to those endpoints is refused either way.
func TestRules_NullRules(t *testing.T) {
	app := testutil.NewApp(t)

	for _, want := range []struct {
		collection string
		rules      map[string]func(*core.Collection) *string
	}{
		{"users", map[string]func(*core.Collection) *string{
			"create": func(c *core.Collection) *string { return c.CreateRule },
			"delete": func(c *core.Collection) *string { return c.DeleteRule },
		}},
		{"invitations", map[string]func(*core.Collection) *string{
			"create": func(c *core.Collection) *string { return c.CreateRule },
			"update": func(c *core.Collection) *string { return c.UpdateRule },
			"delete": func(c *core.Collection) *string { return c.DeleteRule },
		}},
		{"passkeys", map[string]func(*core.Collection) *string{
			"create": func(c *core.Collection) *string { return c.CreateRule },
		}},
	} {
		c, err := app.FindCollectionByNameOrId(want.collection)
		if err != nil {
			t.Fatal(err)
		}
		for action, rule := range want.rules {
			if got := rule(c); got != nil {
				t.Errorf("%s: the %s rule is %q, want null", want.collection, action, *got)
			}
		}
	}
}

// Rolling the rules back leaves every collection superuser-only, and applying
// them again restores them. The migration is run on its own so that the test
// does not depend on the ones added after it.
func TestRules_DownThenUp(t *testing.T) {
	app := testutil.NewApp(t)

	var migration *core.Migration
	for _, m := range core.AppMigrations.Items() {
		if m.File == "4_rules.go" {
			migration = m
		}
	}
	if migration == nil {
		t.Fatal("the migration 4_rules.go is not registered")
	}

	names := []string{"users", "runners", "race_types", "events", "formats", "invitations", "passkeys"}
	// rules returns the rules of a collection in the order list, view, create,
	// update, delete, then manage for an auth collection.
	rules := func(name string) []*string {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		all := []*string{c.ListRule, c.ViewRule, c.CreateRule, c.UpdateRule, c.DeleteRule}
		if c.IsAuth() {
			all = append(all, c.ManageRule)
		}
		return all
	}
	// The migration 9j replaces the update rule of the accounts (to keep the skin
	// of an account to its owner), and the migration 4 puts back its own: the
	// rules to compare with are those of the migration 4, as 9j's rollback leaves them.
	if err := migrationFile(t, "9j_user_skin.go").Down(app); err != nil {
		t.Fatal(err)
	}
	before := map[string][]*string{}
	for _, name := range names {
		before[name] = rules(name)
	}

	if err := migration.Down(app); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		for i, r := range rules(name) {
			if r != nil {
				t.Errorf("%s: rule %d is %q after the rollback, want null", name, i, *r)
			}
		}
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	for _, name := range names {
		got, want := rules(name), before[name]
		for i := range want {
			if (got[i] == nil) != (want[i] == nil) || (got[i] != nil && *got[i] != *want[i]) {
				t.Errorf("%s: rule %d differs after applying the migration again", name, i)
			}
		}
	}
}

const (
	alicePasskeyID = "passkeyalice001"
	bobPasskeyID   = "passkeybob00001"
)

// seedPasskeys gives Alice and Bob one passkey each, with a known id.
func seedPasskeys(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	for id, user := range map[string]*core.Record{alicePasskeyID: fx.Alice, bobPasskeyID: fx.Bob} {
		mustSave(t, app, "passkeys", map[string]any{
			"id":            id,
			"user":          user.Id,
			"name":          "Phone",
			"credential_id": "credential-" + id,
			"credential":    map[string]any{"id": id},
		})
	}
}

func TestRules_Passkeys(t *testing.T) {
	passkey := func(id string) func(testutil.Fixture) string { return records("passkeys", id) }

	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "anon lists no passkey",
			As:     "anon",
			Method: http.MethodGet,
			URL:    records("passkeys"),
			Before: seedPasskeys,
			Status: http.StatusOK,
			Contains: []string{
				`"totalItems":0`,
			},
		},
		{
			Name:        "alice lists her own passkey only, without its credential",
			As:          "alice",
			Method:      http.MethodGet,
			URL:         records("passkeys"),
			Before:      seedPasskeys,
			Status:      http.StatusOK,
			Contains:    []string{`"totalItems":1`, alicePasskeyID},
			NotContains: []string{bobPasskeyID, `"credential"`},
		},
		{
			Name:     "admin lists every passkey",
			As:       "admin",
			Method:   http.MethodGet,
			URL:      records("passkeys"),
			Before:   seedPasskeys,
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":2`},
		},
		{
			Name:   "alice cannot view the passkey of bob",
			As:     "alice",
			Method: http.MethodGet,
			URL:    passkey(bobPasskeyID),
			Before: seedPasskeys,
			Status: http.StatusNotFound,
		},
		{
			Name:   "alice renames her passkey",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    passkey(alicePasskeyID),
			Before: seedPasskeys,
			Body:   body(`{"name":"Laptop"}`),
			Status: http.StatusOK,
		},
		{
			Name:   "alice cannot rename the passkey of bob",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    passkey(bobPasskeyID),
			Before: seedPasskeys,
			Body:   body(`{"name":"Laptop"}`),
			Status: http.StatusNotFound,
		},
		{
			Name:   "alice cannot change the credential id of her passkey",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    passkey(alicePasskeyID),
			Before: seedPasskeys,
			Body:   body(`{"credential_id":"other"}`),
			Status: http.StatusNotFound,
		},
		{
			Name:   "anon cannot delete a passkey",
			As:     "anon",
			Method: http.MethodDelete,
			URL:    passkey(alicePasskeyID),
			Before: seedPasskeys,
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if !exists(app, "passkeys", alicePasskeyID) {
					t.Error("the passkey must survive")
				}
			},
		},
		{
			Name:   "alice cannot delete the passkey of bob",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    passkey(bobPasskeyID),
			Before: seedPasskeys,
			Status: http.StatusNotFound,
		},
		{
			Name:   "alice deletes her passkey",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    passkey(alicePasskeyID),
			Before: seedPasskeys,
			Status: http.StatusNoContent,
		},
		{
			Name:   "admin deletes the passkey of bob",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    passkey(bobPasskeyID),
			Before: seedPasskeys,
			Status: http.StatusNoContent,
		},
	})
}

// The skin of an account (migration 9j) is the theme of the site that its
// owner chose. A person sets their own, with the update that already lets them
// edit their account, and nobody else's: not another member, and not an admin,
// who edits the other fields of an account. Only the owner and the admins read
// an account, so the skin is not shown to the other members.
func TestRules_UserSkin(t *testing.T) {
	alice := func(fx testutil.Fixture) *core.Record { return fx.Alice }
	bob := func(fx testutil.Fixture) *core.Record { return fx.Bob }
	admin := func(fx testutil.Fixture) *core.Record { return fx.Admin }

	// skinIs checks the skin that an account is stored with.
	skinIs := func(account func(testutil.Fixture) *core.Record, want string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			t.Helper()
			if got := mustFind(t, app, "users", account(fx).Id).GetString("skin"); got != want {
				t.Errorf("the skin of the account is %q, want %q", got, want)
			}
		}
	}
	// aliceChose gives Alice a skin without going through the rules.
	aliceChose := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		setFields(t, app, "users", fx.Alice.Id, map[string]any{"skin": "nuit"})
	}

	rows := []testutil.Row{
		{
			Name:     "alice sets her skin",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      recordOf("users", alice),
			Body:     body(`{"skin":"nuit"}`),
			Status:   http.StatusOK,
			Contains: []string{`"skin":"nuit"`},
			After:    skinIs(alice, "nuit"),
		},
		{
			Name:     "alice clears her skin",
			As:       "alice",
			Before:   aliceChose,
			Method:   http.MethodPatch,
			URL:      recordOf("users", alice),
			Body:     body(`{"skin":""}`),
			Status:   http.StatusOK,
			Contains: []string{`"skin":""`},
			After:    skinIs(alice, ""),
		},
		{
			Name:   "alice cannot set the skin of bob",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"skin":"nuit"}`),
			Status: http.StatusNotFound,
			After:  skinIs(bob, ""),
		},
		{
			// An admin edits the other fields of another account (its role, its
			// disabled flag), but its skin is its owner's choice.
			Name:   "an admin cannot set the skin of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"skin":"nuit"}`),
			Status: http.StatusNotFound,
			After:  skinIs(bob, ""),
		},
		{
			Name:   "an admin cannot slip the skin of bob in with his role",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"role":"admin","skin":"nuit"}`),
			Status: http.StatusNotFound,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				skinIs(bob, "")(t, app, fx)
				if got := mustFind(t, app, "users", fx.Bob.Id).GetString("role"); got != "member" {
					t.Errorf("bob's role = %q, want member", got)
				}
			},
		},
		{
			Name:   "an admin sets their own skin",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", admin),
			Body:   body(`{"skin":"nuit"}`),
			Status: http.StatusOK,
			After:  skinIs(admin, "nuit"),
		},
		{
			Name:   "an admin still changes the disabled flag of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"disabled":true}`),
			Status: http.StatusOK,
		},
		{
			Name:   "alice cannot set her skin together with her role",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("users", alice),
			Body:   body(`{"role":"admin","skin":"nuit"}`),
			Status: http.StatusNotFound,
			After:  skinIs(alice, ""),
		},
		{
			Name:   "anon cannot set a skin",
			As:     "anon",
			Method: http.MethodPatch,
			URL:    recordOf("users", alice),
			Body:   body(`{"skin":"nuit"}`),
			Status: http.StatusNotFound,
			After:  skinIs(alice, ""),
		},

		// Who reads it: the owner, in every response about their account, and the
		// admins. No other member does, whichever way they ask.
		{
			Name:     "alice reads her skin",
			As:       "alice",
			Before:   aliceChose,
			Method:   http.MethodGet,
			URL:      recordOf("users", alice),
			Status:   http.StatusOK,
			Contains: []string{`"skin":"nuit"`},
		},
		{
			Name:     "alice gets her skin when she signs in",
			As:       "anon",
			Before:   aliceChose,
			Method:   http.MethodPost,
			URL:      func(testutil.Fixture) string { return "/api/collections/users/auth-with-password" },
			Body:     body(`{"identity":"alice@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusOK,
			Contains: []string{`"skin":"nuit"`},
		},
		{
			Name:     "an admin reads the skin of alice",
			As:       "admin",
			Before:   aliceChose,
			Method:   http.MethodGet,
			URL:      recordOf("users", alice),
			Status:   http.StatusOK,
			Contains: []string{`"skin":"nuit"`},
		},
		{
			Name:        "bob cannot read the skin of alice",
			As:          "bob",
			Before:      aliceChose,
			Method:      http.MethodGet,
			URL:         recordOf("users", alice),
			Status:      http.StatusNotFound,
			NotContains: []string{"nuit"},
		},
		{
			Name:        "bob lists no account but his own",
			As:          "bob",
			Before:      aliceChose,
			Method:      http.MethodGet,
			URL:         records("users"),
			Status:      http.StatusOK,
			Contains:    []string{`"totalItems":1`, "bob@example.test"},
			NotContains: []string{"nuit", "alice@example.test"},
		},
		{
			// The runner of Alice is public to the members, and `expand=user` asks
			// for her account with it: the view rule of the accounts decides, so
			// the account is left out.
			Name:        "bob cannot read the skin of alice by expanding her runner",
			As:          "bob",
			Before:      aliceChose,
			Method:      http.MethodGet,
			URL:         func(fx testutil.Fixture) string { return records("runners", fx.AliceRunner.Id)(fx) + "?expand=user" },
			Status:      http.StatusOK,
			Contains:    []string{`"name":"Alice"`},
			NotContains: []string{"nuit", "alice@example.test", `"skin"`},
		},
		{
			// Nor can he find her by it: a filter on the account of a runner would
			// tell which runner chose a skin, one guess at a time.
			Name:   "bob cannot find alice by the skin of her account",
			As:     "bob",
			Before: aliceChose,
			Method: http.MethodGet,
			URL: func(testutil.Fixture) string {
				return "/api/collections/runners/records?filter=user.skin%3D%27nuit%27"
			},
			Status:      http.StatusOK,
			Contains:    []string{`"totalItems":0`},
			NotContains: []string{`"name":"Alice"`},
		},
		{
			// The control of the row above: the same filter, asked by somebody who
			// may read her account, finds her runner. Without it, a filter that
			// matched nothing for another reason (a field that is not there, a
			// quote that is not understood) would pass as well.
			Name:   "an admin finds alice by the skin of her account",
			As:     "admin",
			Before: aliceChose,
			Method: http.MethodGet,
			URL: func(testutil.Fixture) string {
				return "/api/collections/runners/records?filter=user.skin%3D%27nuit%27"
			},
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":1`, `"name":"Alice"`},
		},
	}
	// The shape of an id, as the migration sets it.
	for _, bad := range []string{
		"Nuit", "nuit chaud", "1nuit", "-nuit", "nuit_chaud", "<b>nuit</b>", "crête", strings.Repeat("a", 33),
	} {
		rows = append(rows, testutil.Row{
			Name:   "alice cannot set the skin " + bad,
			As:     "alice",
			Method: http.MethodPatch,
			URL:    recordOf("users", alice),
			Body:   func(testutil.Fixture) string { return fmt.Sprintf(`{"skin":%q}`, bad) },
			Status: http.StatusBadRequest,
			After:  skinIs(alice, ""),
		})
	}
	testutil.RunRows(t, rows)
}

// The reminders are the choice of the person whose account it is: an admin
// sets their own, and not those of another account.
func TestUsers_AdminCannotSetTheRemindersOfAnother(t *testing.T) {
	bob := func(fx testutil.Fixture) *core.Record { return fx.Bob }
	admin := func(fx testutil.Fixture) *core.Record { return fx.Admin }
	remindersAre := func(account func(testutil.Fixture) *core.Record, want ...string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			t.Helper()
			got := mustFind(t, app, "users", account(fx).Id).GetStringSlice("reminders")
			if !slices.Equal(got, want) {
				t.Errorf("the reminders of the account are %v, want %v", got, want)
			}
		}
	}

	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "bob sets his own",
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      recordOf("users", bob),
			Body:     body(`{"reminders":["day","hour"]}`),
			Status:   http.StatusOK,
			Contains: []string{`"reminders":["day","hour"]`},
			After:    remindersAre(bob, "day", "hour"),
		},
		{
			Name:   "an admin cannot set those of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"reminders":["day"]}`),
			Status: http.StatusNotFound,
			After:  remindersAre(bob),
		},
		{
			Name:   "an admin cannot slip them in with the role of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"role":"admin","reminders":["day"]}`),
			Status: http.StatusNotFound,
			After:  remindersAre(bob),
		},
		{
			Name:   "an admin sets their own",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", admin),
			Body:   body(`{"reminders":["hour"]}`),
			Status: http.StatusOK,
			After:  remindersAre(admin, "hour"),
		},
		{
			Name:   "an admin still changes the disabled flag of bob",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    recordOf("users", bob),
			Body:   body(`{"disabled":true}`),
			Status: http.StatusOK,
		},
	})
}
