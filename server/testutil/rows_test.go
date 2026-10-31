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
			// Invitations are created by the routes of the application: the
			// create rule is null, so only superusers can write.
			Name:   "a member cannot create an invitation",
			As:     "alice",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/collections/invitations/records" },
			Body:   func(fx testutil.Fixture) string { return `{"kind":"invite","runner":"` + fx.SamRunner.Id + `"}` },
			Status: http.StatusForbidden,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				afterRan = true
				if n, err := app.CountRecords("invitations"); err != nil || n != 0 {
					t.Errorf("no invitation must exist, got %d (err %v)", n, err)
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
