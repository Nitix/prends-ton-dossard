package testutil

import (
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/tests"
)

// Sequence runs requests one after the other on one application, so that each
// one sees what the previous ones did.
type Sequence struct {
	t   *testing.T
	app *tests.TestApp
}

// NewSequence returns a Sequence on app.
func NewSequence(t *testing.T, app *tests.TestApp) Sequence {
	return Sequence{t: t, app: app}
}

// Step sends a request, as the account that token belongs to (none when empty),
// checks the status and the texts the response contains, and returns the response
// body.
func (s Sequence) Step(name, method, url, token, body string, status int, contains ...string) string {
	s.t.Helper()
	var response string
	scenario := tests.ApiScenario{
		Name:                  name,
		Method:                method,
		URL:                   url,
		Body:                  strings.NewReader(body),
		Headers:               map[string]string{"Authorization": token},
		ExpectedStatus:        status,
		ExpectedContent:       contains,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return s.app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			data, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatalf("reading the response: %v", err)
			}
			response = string(data)
		},
	}
	scenario.Test(s.t)
	return response
}

// TokenIn returns the token of an auth response.
func TokenIn(t testing.TB, response string) string {
	t.Helper()
	var auth struct {
		Token string `json:"token"`
	}
	if err := json.Unmarshal([]byte(response), &auth); err != nil || auth.Token == "" {
		t.Fatalf("no token in the response %q (%v)", response, err)
	}
	return auth.Token
}
