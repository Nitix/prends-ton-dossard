package migrations_test

import (
	"io"
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

const adminPasskeyID = "passkeyadmin001"

// superAdminSetup marks the fixture's Admin super admin and makes Bob an
// ordinary admin, so that "bob" in a row is an admin who is not the super admin.
// It gives Admin and Alice one passkey each, with a known id.
func superAdminSetup(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	setFields(t, app, "users", fx.Admin.Id, map[string]any{"super_admin": true})
	setFields(t, app, "users", fx.Bob.Id, map[string]any{"role": "admin"})
	for id, user := range map[string]*core.Record{adminPasskeyID: fx.Admin, alicePasskeyID: fx.Alice} {
		mustSave(t, app, "passkeys", map[string]any{
			"id":            id,
			"user":          user.Id,
			"name":          "Phone",
			"credential_id": "credential-" + id,
			"credential":    map[string]any{"id": id},
		})
	}
}

// field checks one field of a record after the request.
func field(collection string, record func(testutil.Fixture) *core.Record, name string, want any) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		got := mustFind(t, app, collection, record(fx).Id).Get(name)
		if got != want {
			t.Errorf("%s.%s = %v (%T), want %v (%T)", collection, name, got, got, want, want)
		}
	}
}

// A super admin's account, runner and passkeys are out of reach of the other
// admins; their own owner keeps what any member has, and the other accounts
// stay as they were.
func TestRules_SuperAdmin(t *testing.T) {
	admin := func(fx testutil.Fixture) *core.Record { return fx.Admin }
	alice := func(fx testutil.Fixture) *core.Record { return fx.Alice }
	bob := func(fx testutil.Fixture) *core.Record { return fx.Bob }
	adminRunner := func(fx testutil.Fixture) *core.Record { return fx.AdminRunner }
	aliceRunner := func(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
	samRunner := func(fx testutil.Fixture) *core.Record { return fx.SamRunner }
	passkey := func(id string) func(testutil.Fixture) string { return records("passkeys", id) }
	photo := func(t testing.TB, _ testutil.Fixture) (io.Reader, string) {
		return testutil.ImageForm(t, "avatar", "photo.png", testutil.PNG(t, 64, 64))
	}
	passkeyExists := func(id string, want bool) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
			t.Helper()
			if got := exists(app, "passkeys", id); got != want {
				t.Errorf("passkey %s exists = %v, want %v", id, got, want)
			}
		}
	}

	testutil.RunRows(t, []testutil.Row{
		// Nobody writes the mark through the API.
		{
			Name: "an admin cannot make themselves super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", bob), Body: body(`{"super_admin":true}`),
			Status: http.StatusNotFound, After: field("users", bob, "super_admin", false),
		},
		{
			Name: "an admin cannot make a member super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", alice), Body: body(`{"super_admin":true}`),
			Status: http.StatusNotFound, After: field("users", alice, "super_admin", false),
		},
		{
			Name: "the super admin cannot drop their own mark", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"super_admin":false}`),
			Status: http.StatusNotFound, After: field("users", admin, "super_admin", true),
		},
		{
			Name: "an admin cannot take the mark away", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"super_admin":false}`),
			Status: http.StatusNotFound, After: field("users", admin, "super_admin", true),
		},
		// Another admin changes nothing of the super admin.
		{
			Name: "an admin cannot demote the super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"role":"member"}`),
			Status: http.StatusNotFound, After: field("users", admin, "role", "admin"),
		},
		{
			Name: "an admin cannot disable the super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"disabled":true}`),
			Status: http.StatusNotFound, After: field("users", admin, "disabled", false),
		},
		{
			Name: "an admin cannot rename the runner of the super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("runners", adminRunner), Body: body(`{"name":"Renamed"}`),
			Status: http.StatusNotFound, After: field("runners", adminRunner, "name", "Admin"),
		},
		{
			Name: "an admin cannot set the photo of the super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("runners", adminRunner), Form: photo,
			Status: http.StatusNotFound, After: field("runners", adminRunner, "avatar", ""),
		},
		{
			Name: "an admin cannot delete a passkey of the super admin", Before: superAdminSetup,
			As: "bob", Method: http.MethodDelete, URL: passkey(adminPasskeyID),
			Status: http.StatusNotFound, After: passkeyExists(adminPasskeyID, true),
		},
		// The super admin keeps what any member has on their own account.
		{
			Name: "the super admin cannot change their own role", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"role":"member"}`),
			Status: http.StatusNotFound, After: field("users", admin, "role", "admin"),
		},
		{
			Name: "the super admin sets their own skin", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"skin":"ocean"}`),
			Status: http.StatusOK, After: field("users", admin, "skin", "ocean"),
		},
		{
			Name: "the super admin sets their own reminders", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("users", admin), Body: body(`{"reminders":["day"]}`),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := mustFind(t, app, "users", fx.Admin.Id).GetStringSlice("reminders"); len(got) != 1 || got[0] != "day" {
					t.Errorf("the reminders of the super admin are %v, want [day]", got)
				}
			},
		},
		{
			Name: "the super admin renames their own runner", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("runners", adminRunner), Body: body(`{"name":"Boss"}`),
			Status: http.StatusOK, After: field("runners", adminRunner, "name", "Boss"),
		},
		{
			Name: "the super admin sets their own photo", Before: superAdminSetup,
			As: "admin", Method: http.MethodPatch, URL: recordOf("runners", adminRunner), Form: photo,
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if avatarOf(t, app, fx.AdminRunner.Id) == "" {
					t.Error("the photo of the super admin was not saved")
				}
			},
		},
		{
			Name: "the super admin deletes their own passkey", Before: superAdminSetup,
			As: "admin", Method: http.MethodDelete, URL: passkey(adminPasskeyID),
			Status: http.StatusNoContent, After: passkeyExists(adminPasskeyID, false),
		},
		// The other accounts and runners stay as they were.
		{
			Name: "an admin still changes the role of a member", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("users", alice), Body: body(`{"role":"admin"}`),
			Status: http.StatusOK, After: field("users", alice, "role", "admin"),
		},
		{
			Name: "an admin still renames a member's runner", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("runners", aliceRunner), Body: body(`{"name":"Alicia"}`),
			Status: http.StatusOK, After: field("runners", aliceRunner, "name", "Alicia"),
		},
		{
			Name: "an admin still renames a runner without account", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("runners", samRunner), Body: body(`{"name":"Samuel"}`),
			Status: http.StatusOK, After: field("runners", samRunner, "name", "Samuel"),
		},
		{
			Name: "an admin still sets the photo of a runner without account", Before: superAdminSetup,
			As: "bob", Method: http.MethodPatch, URL: recordOf("runners", samRunner), Form: photo,
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if avatarOf(t, app, fx.SamRunner.Id) == "" {
					t.Error("the photo of Sam was not saved")
				}
			},
		},
		{
			Name: "an admin still deletes a passkey of a member", Before: superAdminSetup,
			As: "bob", Method: http.MethodDelete, URL: passkey(alicePasskeyID),
			Status: http.StatusNoContent, After: passkeyExists(alicePasskeyID, false),
		},
		{
			Name: "a member still renames their own runner", Before: superAdminSetup,
			As: "alice", Method: http.MethodPatch, URL: recordOf("runners", aliceRunner), Body: body(`{"name":"Ali"}`),
			Status: http.StatusOK, After: field("runners", aliceRunner, "name", "Ali"),
		},
		{
			Name: "a member cannot rename the runner of the super admin", Before: superAdminSetup,
			As: "alice", Method: http.MethodPatch, URL: recordOf("runners", adminRunner), Body: body(`{"name":"X"}`),
			Status: http.StatusNotFound, After: field("runners", adminRunner, "name", "Admin"),
		},
	})
}

// The migration 9s adds the mark and the three rules that keep the other admins
// away from it. Its rollback drops the mark, with what it holds, and puts back
// the rules of the migrations before it.
func TestMigrations_SuperAdminDownThenUp(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	migration := migrationFile(t, "9s_super_admin.go")

	collection := func(name string) *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	text := func(rule *string) string {
		if rule == nil {
			return "<nil>"
		}
		return *rule
	}
	// The rules, written out: before this migration, and with it. Compared by
	// equality, so that a change to any other clause on the way is seen.
	const (
		usersBefore = `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false)` +
			` || (@request.auth.role = "admin" && @request.body.email:isset = false && @request.body.password:isset = false && @request.body.skin:isset = false && @request.body.reminders:isset = false)`
		usersAfter = `(id = @request.auth.id && @request.body.role:isset = false && @request.body.disabled:isset = false && @request.body.email:isset = false && @request.body.super_admin:isset = false)` +
			` || (@request.auth.role = "admin" && super_admin != true && @request.body.email:isset = false && @request.body.password:isset = false && @request.body.skin:isset = false && @request.body.reminders:isset = false && @request.body.super_admin:isset = false)`
		runnersBefore  = `@request.body.user:isset = false && (@request.auth.role = "admin" || (@request.auth.id != "" && user = @request.auth.id))`
		runnersAfter   = `@request.body.user:isset = false && ((@request.auth.role = "admin" && user.super_admin != true) || (@request.auth.id != "" && user = @request.auth.id))`
		passkeysBefore = `@request.auth.id != "" && (user = @request.auth.id || @request.auth.role = "admin")`
		passkeysAfter  = `@request.auth.id != "" && (user = @request.auth.id || (@request.auth.role = "admin" && user.super_admin != true))`
	)
	checkRules := func(when, users, runners, passkeys string) {
		t.Helper()
		for _, c := range []struct{ what, got, want string }{
			{"users update", text(collection("users").UpdateRule), users},
			{"runners update", text(collection("runners").UpdateRule), runners},
			{"passkeys delete", text(collection("passkeys").DeleteRule), passkeys},
		} {
			if c.got != c.want {
				t.Errorf("%s: the %s rule is\n%s\nwant\n%s", when, c.what, c.got, c.want)
			}
		}
	}
	checkField := func(when string) {
		t.Helper()
		mark, ok := collection("users").Fields.GetByName("super_admin").(*core.BoolField)
		if !ok {
			t.Fatalf("%s: users.super_admin must be a bool field, got %T", when, collection("users").Fields.GetByName("super_admin"))
		}
		if mark.Required || mark.Hidden {
			t.Errorf("%s: users.super_admin = required %v, hidden %v; want optional and visible", when, mark.Required, mark.Hidden)
		}
	}

	checkField("as created")
	checkRules("as created", usersAfter, runnersAfter, passkeysAfter)
	if mustFind(t, app, "users", fx.Alice.Id).GetBool("super_admin") {
		t.Error("an account is made without the mark")
	}

	setFields(t, app, "users", fx.Admin.Id, map[string]any{"super_admin": true})
	if err := migration.Down(app); err != nil {
		t.Fatalf("the rollback with a super admin: %v", err)
	}
	if collection("users").Fields.GetByName("super_admin") != nil {
		t.Error("users.super_admin must be gone after the rollback")
	}
	checkRules("after the rollback", usersBefore, runnersBefore, passkeysBefore)
	if a := mustFind(t, app, "users", fx.Admin.Id); a.GetString("role") != "admin" || a.GetBool("disabled") {
		t.Errorf("after the rollback, the admin changed beyond the mark: %v", a.FieldsData())
	}

	if err := migration.Up(app); err != nil {
		t.Fatal(err)
	}
	checkField("after applying again")
	checkRules("after applying again", usersAfter, runnersAfter, passkeysAfter)
	if mustFind(t, app, "users", fx.Admin.Id).GetBool("super_admin") {
		t.Error("after applying again, the mark must start unset")
	}
}
