package migrations_test

import (
	"fmt"
	"net/http"
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
