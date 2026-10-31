package accounts_test

import (
	"errors"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
	"courses/server/testutil"
)

// path returns a fixed URL.
func path(url string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return url }
}

// recordURL returns the URL of the record that of picks in a collection.
func recordURL(collection string, of func(testutil.Fixture) *core.Record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		return "/api/collections/" + collection + "/records/" + of(fx).Id
	}
}

// json returns a request body.
func json(s string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return s }
}

func admin(fx testutil.Fixture) *core.Record       { return fx.Admin }
func bob(fx testutil.Fixture) *core.Record         { return fx.Bob }
func alice(fx testutil.Fixture) *core.Record       { return fx.Alice }
func adminRunner(fx testutil.Fixture) *core.Record { return fx.AdminRunner }
func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func samRunner(fx testutil.Fixture) *core.Record   { return fx.SamRunner }
func trail(fx testutil.Fixture) *core.Record       { return fx.Trail }
func cross(fx testutil.Fixture) *core.Record       { return fx.Cross }

// code is how the API reports a refused request: data.code.
func code(c string) string { return `"code":"` + c + `"` }

// stored returns the record as it is in the database.
func stored(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		t.Fatalf("finding %s %s: %v", collection, id, err)
	}
	return record
}

// edit saves the values on the account, as the application itself would.
func edit(t testing.TB, app core.App, id string, values map[string]any) {
	t.Helper()
	record := stored(t, app, "users", id)
	for k, v := range values {
		record.Set(k, v)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("editing the account %s: %v", id, err)
	}
}

// accountIs asserts the stored role and disabled flag of an account.
func accountIs(who func(testutil.Fixture) *core.Record, role string, disabled bool) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record := stored(t, app, "users", who(fx).Id)
		if got := record.GetString("role"); got != role {
			t.Errorf("role = %q, want %q", got, role)
		}
		if got := record.GetBool("disabled"); got != disabled {
			t.Errorf("disabled = %v, want %v", got, disabled)
		}
	}
}

// exists asserts that a record is still in, or is gone from, its collection.
func exists(collection string, of func(testutil.Fixture) *core.Record, want bool) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		_, err := app.FindRecordById(collection, of(fx).Id)
		if got := err == nil; got != want {
			t.Errorf("%s %s exists = %v, want %v", collection, of(fx).Id, got, want)
		}
	}
}

// emailIs asserts the stored email of an account.
func emailIs(who func(testutil.Fixture) *core.Record, want string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		if got := stored(t, app, "users", who(fx).Id).Email(); got != want {
			t.Errorf("email = %q, want %q", got, want)
		}
	}
}

// bobBecomesAdmin makes Bob a second admin.
func bobBecomesAdmin(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	edit(t, app, fx.Bob.Id, map[string]any{"role": "admin"})
}

func TestUsers_LastAdmin(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "the only admin cannot give up the admin role",
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"role":"member"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeLastAdmin)},
			After:    accountIs(admin, "admin", false),
		},
		{
			Name:     "the only admin cannot disable themselves",
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"disabled":true}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeLastAdmin)},
			After:    accountIs(admin, "admin", false),
		},
		{
			Name:     "an admin can give up the role once another admin is active",
			Before:   bobBecomesAdmin,
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"role":"member"}`),
			Status:   http.StatusOK,
			Contains: []string{`"role":"member"`},
			After:    accountIs(admin, "member", false),
		},
		{
			Name:     "an admin can disable themselves once another admin is active",
			Before:   bobBecomesAdmin,
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"disabled":true}`),
			Status:   http.StatusOK,
			Contains: []string{`"disabled":true`},
			After:    accountIs(admin, "admin", true),
		},
		{
			Name: "a disabled admin is not another admin",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				edit(t, app, fx.Bob.Id, map[string]any{"role": "admin", "disabled": true})
			},
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"role":"member"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeLastAdmin)},
			After:    accountIs(admin, "admin", false),
		},
		{
			Name:     "another admin can be demoted while one stays",
			Before:   bobBecomesAdmin,
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", bob),
			Body:     json(`{"role":"member"}`),
			Status:   http.StatusOK,
			Contains: []string{`"role":"member"`},
			After:    accountIs(bob, "member", false),
		},
		{
			Name:     "another admin can be disabled while one stays",
			Before:   bobBecomesAdmin,
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", bob),
			Body:     json(`{"disabled":true}`),
			Status:   http.StatusOK,
			Contains: []string{`"disabled":true`},
			After:    accountIs(bob, "admin", true),
		},
		{
			Name:     "an edit that keeps the only admin admin is accepted",
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", admin),
			Body:     json(`{"role":"admin","disabled":false}`),
			Status:   http.StatusOK,
			Contains: []string{`"role":"admin"`},
			After:    accountIs(admin, "admin", false),
		},
		{
			Name:     "a member can be disabled whatever the admins",
			As:       "admin",
			Method:   http.MethodPatch,
			URL:      recordURL("users", bob),
			Body:     json(`{"disabled":true}`),
			Status:   http.StatusOK,
			Contains: []string{`"disabled":true`},
			After:    accountIs(bob, "member", true),
		},
	})
}

// A disabled account has its token key renewed, which is what makes every
// token issued before the change invalid.
func TestUsers_DisableInvalidatesSessions(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	bobToken := testutil.Token(t, fx.Bob)
	adminToken := testutil.Token(t, fx.Admin)

	step := func(name, method, url, token, body string, status int, contains string) {
		t.Helper()
		scenario := tests.ApiScenario{
			Name:                  name,
			Method:                method,
			URL:                   url,
			Body:                  strings.NewReader(body),
			Headers:               map[string]string{"Authorization": token},
			ExpectedStatus:        status,
			ExpectedContent:       []string{contains},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
		}
		scenario.Test(t)
	}

	refresh := "/api/collections/users/auth-refresh"
	step("the token of an enabled account refreshes", http.MethodPost, refresh, bobToken, "", http.StatusOK, `"token"`)
	step("the admin disables the account", http.MethodPatch, "/api/collections/users/records/"+fx.Bob.Id, adminToken, `{"disabled":true}`, http.StatusOK, `"disabled":true`)
	step("the token issued before no longer refreshes", http.MethodPost, refresh, bobToken, "", http.StatusUnauthorized, `"status":401`)

	if stored(t, app, "users", fx.Bob.Id).TokenKey() == fx.Bob.TokenKey() {
		t.Error("the token key of the disabled account was not renewed")
	}
}

// The refusal is the authRule of the collection (disabled = false), which
// PocketBase answers with a 403 once the credentials are right: 400 is what it
// answers for wrong credentials.
func TestUsers_DisabledCannotSignIn(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a disabled account cannot sign in",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				edit(t, app, fx.Bob.Id, map[string]any{"disabled": true})
			},
			Method:      http.MethodPost,
			URL:         path("/api/collections/users/auth-with-password"),
			Body:        json(`{"identity":"bob@example.test","password":"` + testutil.Password + `"}`),
			Status:      http.StatusForbidden,
			NotContains: []string{`"token"`},
		},
		{
			Name:     "an enabled account signs in",
			Method:   http.MethodPost,
			URL:      path("/api/collections/users/auth-with-password"),
			Body:     json(`{"identity":"bob@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusOK,
			Contains: []string{`"token"`},
		},
	})
}

func TestDelete_Guards(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "a runner with participations cannot be deleted",
			As:       "admin",
			Method:   http.MethodDelete,
			URL:      recordURL("runners", aliceRunner),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeRunnerHasParticipations)},
			After:    exists("runners", aliceRunner, true),
		},
		{
			Name:     "a runner without account but with participations cannot be deleted",
			As:       "admin",
			Method:   http.MethodDelete,
			URL:      recordURL("runners", samRunner),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeRunnerHasParticipations)},
			After:    exists("runners", samRunner, true),
		},
		{
			Name:   "a runner without participation can be deleted",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    recordURL("runners", adminRunner),
			Status: http.StatusNoContent,
			After:  exists("runners", adminRunner, false),
		},
		{
			Name:     "a race type used by a race cannot be deleted",
			As:       "admin",
			Method:   http.MethodDelete,
			URL:      recordURL("race_types", trail),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeRaceTypeInUse)},
			After:    exists("race_types", trail, true),
		},
		{
			Name:   "a race type that no race uses can be deleted",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    recordURL("race_types", cross),
			Status: http.StatusNoContent,
			After:  exists("race_types", cross, false),
		},
	})
}

// The guards are model hooks, so they also refuse the writes that do not come
// from a request (the Go code, the commands, the dashboard).
func TestGuards_RefuseWritesOutsideTheAPI(t *testing.T) {
	codeOf := func(t *testing.T, err error) string {
		t.Helper()
		var apiErr *router.ApiError
		if !errors.As(err, &apiErr) {
			t.Fatalf("error = %v, want an API error", err)
		}
		got, _ := apiErr.Data["code"].(string)
		return got
	}

	t.Run("demoting the only admin", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// The fixture record was created in this process and never reloaded.
		fx.Admin.Set("role", "member")
		if got := codeOf(t, app.Save(fx.Admin)); got != apperr.CodeLastAdmin {
			t.Errorf("code = %q, want %q", got, apperr.CodeLastAdmin)
		}
	})
	t.Run("deleting a runner with participations", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		if got := codeOf(t, app.Delete(fx.AliceRunner)); got != apperr.CodeRunnerHasParticipations {
			t.Errorf("code = %q, want %q", got, apperr.CodeRunnerHasParticipations)
		}
	})
	t.Run("deleting a race type in use", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		if got := codeOf(t, app.Delete(fx.Trail)); got != apperr.CodeRaceTypeInUse {
			t.Errorf("code = %q, want %q", got, apperr.CodeRaceTypeInUse)
		}
	})
}

func TestMeEmail(t *testing.T) {
	const url = "/api/app/me/email"
	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "anonymous",
			Method: http.MethodPost,
			URL:    path(url),
			Body:   json(`{"email":"new@example.test","password":"` + testutil.Password + `"}`),
			Status: http.StatusUnauthorized,
		},
		{
			Name:     "wrong password",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"new@example.test","password":"wrong-pass-1"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeWrongPassword)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "no password",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"new@example.test"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeWrongPassword)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "the password is checked before the email",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"pas-un-email","password":"wrong-pass-1"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeWrongPassword)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "the password is checked before the availability",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"bob@example.test","password":"wrong-pass-1"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeWrongPassword)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "not an email",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"pas-un-email","password":"` + testutil.Password + `"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailInvalid)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "no email",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"password":"` + testutil.Password + `"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailInvalid)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "an email that belongs to another account",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"bob@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailTaken)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "an email that belongs to another account, in other letters",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"BOB@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailTaken)},
			After:    emailIs(alice, "alice@example.test"),
		},
		{
			Name:     "a new email",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"new@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusOK,
			Contains: []string{`"email":"new@example.test"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				emailIs(alice, "new@example.test")(t, app, fx)
				if _, err := app.FindAuthRecordByEmail("users", "alice@example.test"); err == nil {
					t.Error("the old email still finds an account")
				}
			},
		},
		{
			Name:     "the caller's own email in other letters",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(url),
			Body:     json(`{"email":"Alice@example.test","password":"` + testutil.Password + `"}`),
			Status:   http.StatusOK,
			Contains: []string{`"email":"Alice@example.test"`},
			After:    emailIs(alice, "Alice@example.test"),
		},
	})
}

func TestMeEmail_SignInWithTheNewEmail(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	step := func(name, url, token, body string, status int, contains string) {
		t.Helper()
		scenario := tests.ApiScenario{
			Name:                  name,
			Method:                http.MethodPost,
			URL:                   url,
			Body:                  strings.NewReader(body),
			Headers:               map[string]string{"Authorization": token},
			ExpectedStatus:        status,
			ExpectedContent:       []string{contains},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
		}
		scenario.Test(t)
	}

	login := "/api/collections/users/auth-with-password"
	credentials := func(email string) string {
		return `{"identity":"` + email + `","password":"` + testutil.Password + `"}`
	}
	step("change the email", "/api/app/me/email", testutil.Token(t, fx.Alice),
		`{"email":"new@example.test","password":"`+testutil.Password+`"}`, http.StatusOK, `"email":"new@example.test"`)
	step("sign in with the new email", login, "", credentials("new@example.test"), http.StatusOK, `"token"`)
	step("the old email no longer signs in", login, "", credentials("alice@example.test"), http.StatusBadRequest, `"status":400`)
}
