package reminders_test

import (
	"net/http"
	"slices"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/reminders"
	"courses/server/testutil"
)

func at(testutil.Fixture) string { return reminders.Path }

func put(raw string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return raw }
}

func chosen(t testing.TB, app *tests.TestApp, user *core.Record) []string {
	t.Helper()
	stored, err := app.FindRecordById("users", user.Id)
	if err != nil {
		t.Fatal(err)
	}
	return stored.GetStringSlice("reminders")
}

func TestReminderRoutes(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{Name: "a session is needed to read", As: "anon", Method: http.MethodGet, URL: at, Status: http.StatusUnauthorized},
		{
			Name: "a session is needed to save", As: "anon", Method: http.MethodPut, URL: at, Body: put(`{"reminders":["day"]}`),
			Status: http.StatusUnauthorized,
		},
		{
			Name: "the choice is empty by default", As: "alice", Method: http.MethodGet, URL: at,
			Status: http.StatusOK, Contains: []string{`{"reminders":[]}`},
		},
		{
			Name: "the choice is read", As: "alice", Method: http.MethodGet, URL: at,
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				alice, _ := app.FindRecordById("users", fx.Alice.Id)
				alice.Set("reminders", []string{"hour"})
				if err := app.Save(alice); err != nil {
					t.Fatal(err)
				}
			},
			Status: http.StatusOK, Contains: []string{`{"reminders":["hour"]}`},
		},
		{
			Name: "the order and the duplicates do not matter", As: "alice", Method: http.MethodPut, URL: at,
			Body:   put(`{"reminders":["hour","day","day"]}`),
			Status: http.StatusOK, Contains: []string{`{"reminders":["day","hour"]}`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := chosen(t, app, fx.Alice); !slices.Equal(got, []string{"day", "hour"}) {
					t.Errorf("stored %v, want [day hour]", got)
				}
			},
		},
		{
			Name: "an empty choice clears it", As: "alice", Method: http.MethodPut, URL: at,
			Body: put(`{"reminders":[]}`),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				alice, _ := app.FindRecordById("users", fx.Alice.Id)
				alice.Set("reminders", []string{"day"})
				if err := app.Save(alice); err != nil {
					t.Fatal(err)
				}
			},
			Status: http.StatusOK, Contains: []string{`{"reminders":[]}`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := chosen(t, app, fx.Alice); len(got) != 0 {
					t.Errorf("stored %v, want none", got)
				}
			},
		},
		{
			Name: "a value that is not a kind is refused", As: "alice", Method: http.MethodPut, URL: at,
			Body:     put(`{"reminders":["week"]}`),
			Status:   http.StatusBadRequest,
			Contains: []string{`"reminders":{"code":"validation_invalid_value"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := chosen(t, app, fx.Alice); len(got) != 0 {
					t.Errorf("stored %v, want none", got)
				}
			},
		},
		{
			Name: "a body that is not JSON is refused", As: "alice", Method: http.MethodPut, URL: at,
			Body: put(`not json`), Status: http.StatusBadRequest,
		},
		{
			Name: "bob does not see the choice of alice", As: "bob", Method: http.MethodGet, URL: at,
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				alice, _ := app.FindRecordById("users", fx.Alice.Id)
				alice.Set("reminders", []string{"day", "hour"})
				if err := app.Save(alice); err != nil {
					t.Fatal(err)
				}
			},
			Status: http.StatusOK, Contains: []string{`{"reminders":[]}`},
		},
		{
			Name: "bob saves his own and alice keeps hers", As: "bob", Method: http.MethodPut, URL: at,
			Body: put(`{"reminders":["day"]}`),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				alice, _ := app.FindRecordById("users", fx.Alice.Id)
				alice.Set("reminders", []string{"hour"})
				if err := app.Save(alice); err != nil {
					t.Fatal(err)
				}
			},
			Status: http.StatusOK, Contains: []string{`{"reminders":["day"]}`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := chosen(t, app, fx.Alice); !slices.Equal(got, []string{"hour"}) {
					t.Errorf("Alice's choice is %v, want [hour]", got)
				}
				if got := chosen(t, app, fx.Bob); !slices.Equal(got, []string{"day"}) {
					t.Errorf("Bob's choice is %v, want [day]", got)
				}
			},
		},
	})
}

func TestReminderRoutes_AbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)
	for _, method := range []string{http.MethodGet, http.MethodPut} {
		scenario := tests.ApiScenario{
			Method:                method,
			URL:                   reminders.Path,
			Headers:               map[string]string{"Authorization": testutil.Token(t, fx.Alice)},
			ExpectedStatus:        http.StatusNotFound,
			NotExpectedContent:    []string{"\x00"},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
		}
		if method == http.MethodPut {
			scenario.Body = http.NoBody
		}
		scenario.Name = method
		scenario.Test(t)
	}
}

func TestOf(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	for _, row := range []struct {
		name string
		set  []string
		want []string
	}{
		{"none", nil, []string{}},
		{"day", []string{"day"}, []string{"day"}},
		{"hour", []string{"hour"}, []string{"hour"}},
		{"stored the other way round", []string{"hour", "day"}, []string{"day", "hour"}},
	} {
		t.Run(row.name, func(t *testing.T) {
			user, _ := app.FindRecordById("users", fx.Alice.Id)
			user.Set("reminders", row.set)
			if got := reminders.Of(user); !slices.Equal(got, row.want) || got == nil {
				t.Errorf("Of = %#v, want %#v", got, row.want)
			}
		})
	}
}
