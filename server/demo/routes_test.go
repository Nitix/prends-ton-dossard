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

// The demo account is shared by every visitor: a skin kept on it would be the
// one of whoever chose last, put on the next visitor over their own device's
// (the site puts the skin of an account on the device at sign-in). So the demo
// instance keeps none on that account: an update that sets it is dropped, with
// no error (the site saves the skin whenever it is chosen, and must not see
// the demo as a failure), and the rest of the update applies. Every other
// account of the instance keeps its own, and a site with no demo changes nothing.

// skinOf reads the skin that an account is stored with.
func skinOf(t testing.TB, app core.App, id string) string {
	t.Helper()
	user, err := app.FindRecordById("users", id)
	if err != nil {
		t.Fatal(err)
	}
	return user.GetString("skin")
}

// patchAccount updates an account through the API, as who, and checks the answer.
func patchAccount(t *testing.T, app *tests.TestApp, as, account *core.Record, body string, contains ...string) {
	t.Helper()
	(&tests.ApiScenario{
		Method:          http.MethodPatch,
		URL:             "/api/collections/users/records/" + account.Id,
		Body:            strings.NewReader(body),
		Headers:         map[string]string{"Authorization": testutil.Token(t, as), "Content-Type": "application/json"},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: contains,
		TestAppFactory:  func(testing.TB) *tests.TestApp { return app },
		// The application is cleaned up by testutil.
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestDemo_KeepsNoSkinOnTheDemoAccount(t *testing.T) {
	for _, email := range []string{"alice@example.test", "ALICE@Example.Test"} {
		t.Run("an update of the skin is dropped, without an error: "+email, func(t *testing.T) {
			app, fx := demoApp(t, email)

			patchAccount(t, app, fx.Alice, fx.Alice, `{"skin":"nuit"}`, `"skin":""`)

			if got := skinOf(t, app, fx.Alice.Id); got != "" {
				t.Errorf("the demo account has skin %q, want it empty", got)
			}
		})
	}

	t.Run("the rest of the update applies", func(t *testing.T) {
		app, fx := demoApp(t, "alice@example.test")

		patchAccount(t, app, fx.Alice, fx.Alice,
			`{"skin":"nuit","oldPassword":"`+testutil.Password+`","password":"x-123456789","passwordConfirm":"x-123456789"}`,
			`"skin":""`)

		user, err := app.FindRecordById("users", fx.Alice.Id)
		if err != nil {
			t.Fatal(err)
		}
		if !user.ValidatePassword("x-123456789") {
			t.Error("the password of the demo account must have changed with the update")
		}
		if got := user.GetString("skin"); got != "" {
			t.Errorf("the demo account has skin %q, want it empty", got)
		}
	})

	t.Run("not through the code either: a save, an account made with a skin", func(t *testing.T) {
		app, fx := demoApp(t, "newcomer@example.test")
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		demo := core.NewRecord(users)
		demo.SetEmail("newcomer@example.test")
		demo.SetPassword(testutil.Password)
		demo.Set("role", "member")
		demo.Set("skin", "nuit")
		if err := app.Save(demo); err != nil {
			t.Fatal(err)
		}
		if got := skinOf(t, app, demo.Id); got != "" {
			t.Errorf("an account made with the email of the demo has skin %q, want it empty", got)
		}

		demo.Set("skin", "nuit")
		if err := app.Save(demo); err != nil {
			t.Fatal(err)
		}
		if got := skinOf(t, app, demo.Id); got != "" {
			t.Errorf("the demo account saved with a skin has skin %q, want it empty", got)
		}
		// Another account of the instance is left alone.
		fx.Bob.Set("skin", "nuit")
		if err := app.Save(fx.Bob); err != nil {
			t.Fatal(err)
		}
		if got := skinOf(t, app, fx.Bob.Id); got != "nuit" {
			t.Errorf("bob has skin %q on a demo instance, want nuit", got)
		}
	})

	t.Run("a skin that was there before the demo is emptied when a visitor enters", func(t *testing.T) {
		app, fx := demoApp(t, "alice@example.test")
		// Straight to the table, as a copy of a database made before would have it.
		if _, err := app.DB().NewQuery("UPDATE users SET skin = 'nuit' WHERE id = {:id}").
			Bind(map[string]any{"id": fx.Alice.Id}).Execute(); err != nil {
			t.Fatal(err)
		}

		call(t, app, tests.ApiScenario{
			Method:             http.MethodPost,
			ExpectedStatus:     http.StatusOK,
			ExpectedContent:    []string{`"token":"`},
			NotExpectedContent: []string{`"skin":"nuit"`},
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				if got := skinOf(t, app, fx.Alice.Id); got != "" {
					t.Errorf("the demo account has skin %q after a visitor entered, want it empty", got)
				}
			},
		})
	})
}

func TestDemo_OtherAccountsKeepTheirSkin(t *testing.T) {
	t.Run("on a demo instance", func(t *testing.T) {
		app, fx := demoApp(t, "alice@example.test")

		patchAccount(t, app, fx.Bob, fx.Bob, `{"skin":"nuit"}`, `"skin":"nuit"`)

		if got := skinOf(t, app, fx.Bob.Id); got != "nuit" {
			t.Errorf("bob has skin %q, want nuit", got)
		}
	})

	t.Run("on a site with no demo, the account that a demo would use keeps it too", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		patchAccount(t, app, fx.Alice, fx.Alice, `{"skin":"nuit"}`, `"skin":"nuit"`)

		if got := skinOf(t, app, fx.Alice.Id); got != "nuit" {
			t.Errorf("alice has skin %q, want nuit", got)
		}
	})
}
