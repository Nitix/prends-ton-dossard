package testutil_test

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

func refreshURL(testutil.Fixture) string { return "/api/collections/users/auth-refresh" }

// RunRows is exercised on the two things the harness itself must get right:
// who the request is sent as, and what runs after it.
func TestRunRows(t *testing.T) {
	afterRan := false

	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "anon is not signed in",
			As:     "anon",
			Method: http.MethodPost,
			URL:    refreshURL,
			Status: http.StatusUnauthorized,
		},
		{
			Name:     "no As means anon",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
		},
		{
			Name:        "alice is signed in as alice",
			As:          "alice",
			Method:      http.MethodPost,
			URL:         refreshURL,
			Status:      http.StatusOK,
			Contains:    []string{`"email":"alice@example.test"`, `"role":"member"`},
			NotContains: []string{"bob@example.test"},
		},
		{
			Name:     "bob is signed in as bob",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusOK,
			Contains: []string{`"email":"bob@example.test"`},
		},
		{
			Name:     "admin is signed in as the admin account",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      refreshURL,
			Status:   http.StatusOK,
			Contains: []string{`"email":"admin@example.test"`, `"role":"admin"`},
		},
		{
			// The rules are still null: only superusers can write.
			Name:   "a member cannot create a runner yet",
			As:     "alice",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/collections/runners/records" },
			Body:   func(testutil.Fixture) string { return `{"name":"Zed"}` },
			Status: http.StatusForbidden,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				afterRan = true
				if _, err := app.FindFirstRecordByData("runners", "name", "Zed"); err == nil {
					t.Error("the runner Zed must not exist")
				}
				if _, err := app.FindRecordById("runners", fx.SamRunner.Id); err != nil {
					t.Errorf("After must see the seeded data: %v", err)
				}
			},
		},
	})

	if !afterRan {
		t.Error("Row.After was never called")
	}
}
