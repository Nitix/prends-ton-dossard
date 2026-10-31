package accounts_test

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/accounts"
	"courses/server/apperr"
	"courses/server/testutil"
)

// RequireAdmin lets the active admins through and refuses everybody else with
// the forbidden code. The probe route stands for any route that uses it.
func TestRequireAdmin(t *testing.T) {
	rows := []struct {
		name   string
		as     func(testutil.Fixture) *core.Record // nil: anonymous
		before func(testing.TB, *tests.TestApp, testutil.Fixture)
		status int
		body   string
	}{
		{name: "an admin gets through", as: admin, status: http.StatusOK, body: `"ok":true`},
		{name: "a member is forbidden", as: alice, status: http.StatusForbidden, body: code(apperr.CodeForbidden)},
		{name: "an anonymous caller is unauthorized", status: http.StatusUnauthorized, body: `"status":401`},
		{
			// The token comes from the record that Before saved, so it is the one
			// of an account that was disabled: nothing else than the role is held
			// against it.
			name: "a disabled admin is forbidden",
			as:   admin,
			before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				other := core.NewRecord(fx.Admin.Collection())
				other.Set("email", "other-admin@example.test")
				other.Set("password", testutil.Password)
				other.Set("role", "admin")
				other.Set("verified", true)
				if err := app.Save(other); err != nil {
					t.Fatal(err)
				}
				fx.Admin.Set("disabled", true)
				if err := app.Save(fx.Admin); err != nil {
					t.Fatal(err)
				}
			},
			status: http.StatusForbidden,
			body:   code(apperr.CodeForbidden),
		},
	}

	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			if row.before != nil {
				row.before(t, app, fx)
			}

			headers := map[string]string{}
			if row.as != nil {
				headers["Authorization"] = testutil.Token(t, row.as(fx))
			}
			(&tests.ApiScenario{
				Method:          http.MethodGet,
				URL:             "/probe",
				Headers:         headers,
				ExpectedStatus:  row.status,
				ExpectedContent: []string{row.body},
				TestAppFactory:  func(testing.TB) *tests.TestApp { return app },
				BeforeTestFunc: func(_ testing.TB, _ *tests.TestApp, e *core.ServeEvent) {
					e.Router.GET("/probe", func(e *core.RequestEvent) error {
						return e.JSON(http.StatusOK, map[string]bool{"ok": true})
					}).Bind(apis.RequireAuth("users")).BindFunc(accounts.RequireAdmin)
				},
				DisableTestAppCleanup: true,
			}).Test(t)
		})
	}
}
