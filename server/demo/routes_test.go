package demo_test

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

const demoURL = "/api/app/demo"

// demoApp returns an application whose DEMO_LOGIN_EMAIL is email, with the
// accounts of the fixture.
func demoApp(t testing.TB, email string) (*tests.TestApp, testutil.Fixture) {
	t.Helper()
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": email})
	return app, testutil.Seed(t, app)
}

// call sends an anonymous request to the demo route of app, and checks the
// status and the text that the body must, and must not, contain.
func call(t *testing.T, app *tests.TestApp, scenario tests.ApiScenario) {
	t.Helper()
	scenario.URL = demoURL
	scenario.TestAppFactory = func(testing.TB) *tests.TestApp { return app }
	// The application is cleaned up by testutil.
	scenario.DisableTestAppCleanup = true
	if len(scenario.ExpectedContent) == 0 && len(scenario.NotExpectedContent) == 0 {
		// ApiScenario wants an expectation whenever the body is not empty.
		scenario.NotExpectedContent = []string{"\x00"}
	}
	scenario.Test(t)
}

// The real site never sets DEMO_LOGIN_EMAIL: nobody can sign in without an
// account there, and the routes are not even there to be asked.
func TestDemo_DisabledWithoutEnv(t *testing.T) {
	for _, method := range []string{http.MethodGet, http.MethodPost} {
		t.Run(method, func(t *testing.T) {
			app := testutil.NewApp(t)
			testutil.Seed(t, app)

			call(t, app, tests.ApiScenario{
				Method:             method,
				ExpectedStatus:     http.StatusNotFound,
				ExpectedContent:    []string{`"status":404`},
				NotExpectedContent: []string{`"token"`, `"enabled"`},
			})
		})
	}
}

// The login page asks it, signed out: that is how it knows to show the button.
func TestDemo_EnabledAnswers(t *testing.T) {
	app, _ := demoApp(t, "alice@example.test")

	call(t, app, tests.ApiScenario{
		Method:          http.MethodGet,
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`{"enabled":true}`},
	})
}

func TestDemo_LogsIntoTheDemoAccount(t *testing.T) {
	for _, tc := range []struct {
		name string
		// email is DEMO_LOGIN_EMAIL; body is what the caller sends.
		email, body string
	}{
		{name: "no body", email: "alice@example.test"},
		// The account is the one of the server's configuration, never the one
		// the caller names: else anybody could sign in as anybody.
		{name: "an email in the body is ignored", email: "alice@example.test", body: `{"email":"bob@example.test","password":"x"}`},
		{name: "capitals do not matter", email: "ALICE@Example.Test"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			app, fx := demoApp(t, tc.email)

			// The token of the answer, caught on its way: the test then asks
			// the application whose it is.
			var token string
			call(t, app, tests.ApiScenario{
				Method:         http.MethodPost,
				Body:           strings.NewReader(tc.body),
				Headers:        map[string]string{"Content-Type": "application/json"},
				ExpectedStatus: http.StatusOK,
				ExpectedContent: []string{
					`"token":"`,
					`"id":"` + fx.Alice.Id + `"`,
					`"collectionName":"users"`,
				},
				NotExpectedContent: []string{fx.Bob.Id, fx.Admin.Id},
				BeforeTestFunc: func(_ testing.TB, app *tests.TestApp, _ *core.ServeEvent) {
					app.OnRecordAuthRequest("users").BindFunc(func(e *core.RecordAuthRequestEvent) error {
						token = e.Token
						return e.Next()
					})
				},
				AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
					if token == "" {
						t.Fatal("no token was issued")
					}
					user, err := app.FindAuthRecordByToken(token, core.TokenTypeAuth)
					if err != nil {
						t.Fatalf("the token of the answer is not valid: %v", err)
					}
					if user.Id != fx.Alice.Id {
						t.Errorf("the token is the one of %s, want alice (%s)", user.Email(), fx.Alice.Id)
					}
				},
			})
		})
	}
}

// Anything but a member who can sign in and has a runner to show gives the same
// answer as no demo, to the question of the login page as well as to the click:
// a 404 with the code of not_found, and no token. The page then has no button
// to offer. An admin is never the demo account: whatever the visitors do there
// would be done with the powers of an admin.
func TestDemo_MissingOrDisabledAccount(t *testing.T) {
	for _, tc := range []struct {
		name string
		// email is DEMO_LOGIN_EMAIL; before changes the database.
		email  string
		before func(t testing.TB, app *tests.TestApp, fx testutil.Fixture)
	}{
		{name: "no account has that email", email: "nobody@example.test"},
		{name: "the account is an admin", email: "admin@example.test"},
		{
			name:  "the account is disabled",
			email: "alice@example.test",
			before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				fx.Alice.Set("disabled", true)
				if err := app.Save(fx.Alice); err != nil {
					t.Fatalf("disabling alice: %v", err)
				}
			},
		},
		{
			name:  "the account has no runner",
			email: "lonely@example.test",
			before: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				users, err := app.FindCollectionByNameOrId("users")
				if err != nil {
					t.Fatal(err)
				}
				lonely := core.NewRecord(users)
				lonely.SetEmail("lonely@example.test")
				lonely.SetPassword(testutil.Password)
				lonely.Set("role", "member")
				if err := app.Save(lonely); err != nil {
					t.Fatalf("creating an account without a runner: %v", err)
				}
			},
		},
	} {
		for _, method := range []string{http.MethodGet, http.MethodPost} {
			t.Run(tc.name+"/"+method, func(t *testing.T) {
				app, fx := demoApp(t, tc.email)
				if tc.before != nil {
					tc.before(t, app, fx)
				}

				call(t, app, tests.ApiScenario{
					Method:             method,
					ExpectedStatus:     http.StatusNotFound,
					ExpectedContent:    []string{`"code":"not_found"`},
					NotExpectedContent: []string{`"token"`, `"enabled"`},
				})
			})
		}
	}
}
