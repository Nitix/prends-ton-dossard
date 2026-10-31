package testutil

import (
	"io"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Row is one API test case, run by RunRows.
type Row struct {
	Name string
	// Before runs once the fixture is seeded and before the request, to put
	// the database in a state that Seed does not create.
	Before func(t testing.TB, app *tests.TestApp, fx Fixture)
	// As is who calls: "anon" (no Authorization header, also the default),
	// "admin", "alice" or "bob" (the token of that fixture account).
	As     string
	Method string
	URL    func(fx Fixture) string
	// Body returns the JSON request body. Leave it nil for no body.
	Body func(fx Fixture) string
	// Status is the expected HTTP status.
	Status int
	// Contains and NotContains are texts the response body must, or must not,
	// contain. With neither, the body is not checked, except that a 204 must
	// have none.
	Contains    []string
	NotContains []string
	// After runs once the response is checked, to assert on the database.
	After func(t testing.TB, app *tests.TestApp, fx Fixture)
}

// RunRows runs each row as a subtest on its own application: NewApp, then
// Seed, then the request, so that rows cannot affect one another.
func RunRows(t *testing.T, rows []Row) {
	t.Helper()

	for _, row := range rows {
		t.Run(row.Name, func(t *testing.T) {
			app := NewApp(t)
			fx := Seed(t, app)
			if row.Before != nil {
				row.Before(t, app, fx)
			}

			headers := map[string]string{}
			if user := userFor(t, row.As, fx); user != nil {
				headers["Authorization"] = Token(t, user)
			}

			var body io.Reader
			if row.Body != nil {
				body = strings.NewReader(row.Body(fx))
			}

			notContains := row.NotContains
			if len(row.Contains) == 0 && len(row.NotContains) == 0 && row.Status != http.StatusNoContent {
				// ApiScenario wants an expectation whenever the body is not
				// empty. A text that no JSON body can contain checks nothing.
				notContains = []string{"\x00"}
			}

			scenario := tests.ApiScenario{
				Method:             row.Method,
				URL:                row.URL(fx),
				Body:               body,
				Headers:            headers,
				ExpectedStatus:     row.Status,
				ExpectedContent:    row.Contains,
				NotExpectedContent: notContains,
				TestAppFactory:     func(testing.TB) *tests.TestApp { return app },
				// NewApp already registered the cleanup.
				DisableTestAppCleanup: true,
			}
			if row.After != nil {
				scenario.AfterTestFunc = func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					row.After(t, app, fx)
				}
			}
			scenario.Test(t)
		})
	}
}

// userFor returns the fixture account that as stands for, or nil for anon.
func userFor(t testing.TB, as string, fx Fixture) *core.Record {
	t.Helper()
	switch as {
	case "", "anon":
		return nil
	case "admin":
		return fx.Admin
	case "alice":
		return fx.Alice
	case "bob":
		return fx.Bob
	}
	t.Fatalf("unknown Row.As %q: want anon, admin, alice or bob", as)
	return nil
}
