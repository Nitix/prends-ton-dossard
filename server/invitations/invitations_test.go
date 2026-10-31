package invitations_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
	"courses/server/invitations"
	"courses/server/testutil"
)

const (
	// samToken is the plain token of the invitations that the tests store for
	// Sam, bobToken the one of the ones they store for Bob.
	samToken = "token-for-sam"
	bobToken = "token-for-bob"

	baseURL = "/api/app/invitations"
)

// The Before and After hooks of a row.
type (
	beforeFunc = func(testing.TB, *tests.TestApp, testutil.Fixture)
	afterFunc  = func(testing.TB, *tests.TestApp, testutil.Fixture)
)

func path(url string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return url }
}

// code is how the API reports a refused request: data.code.
func code(c string) string { return `"code":"` + c + `"` }

// createBody returns the body of a request that creates an invitation for a
// runner; fields holds the other members of the JSON object.
func createBody(runner func(testutil.Fixture) *core.Record, fields string) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		return `{"runnerId":"` + runner(fx).Id + `",` + fields + `}`
	}
}

// acceptBody returns the body of an accept request. An empty email is left out,
// as the page does for a reset.
func acceptBody(email, password, confirm string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		data, err := json.Marshal(struct {
			Email           string `json:"email,omitempty"`
			Password        string `json:"password"`
			PasswordConfirm string `json:"passwordConfirm"`
		}{email, password, confirm})
		if err != nil {
			panic(err)
		}
		return string(data)
	}
}

func samRunner(fx testutil.Fixture) *core.Record   { return fx.SamRunner }
func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func bobRunner(fx testutil.Fixture) *core.Record   { return fx.BobRunner }

func accept(token string) func(testutil.Fixture) string {
	return path(baseURL + "/" + token + "/accept")
}

func show(token string) func(testutil.Fixture) string {
	return path(baseURL + "/" + token)
}

// ---------------------------------------------------------------------------
// Fixtures

// seedOption changes an invitation before seed saves it.
type seedOption func(*core.Record)

func expired() seedOption {
	return func(r *core.Record) { r.Set("expires_at", time.Now().Add(-time.Minute)) }
}

func used() seedOption {
	return func(r *core.Record) { r.Set("used_at", time.Now().Add(-time.Minute)) }
}

func withRole(role string) seedOption {
	return func(r *core.Record) { r.Set("role", role) }
}

// seed stores a valid invitation for runner, as Create would, except that the
// plain token is one the test knows.
func seed(t testing.TB, app core.App, runner *core.Record, kind invitations.Kind, token string, options ...seedOption) *core.Record {
	t.Helper()
	collection, err := app.FindCollectionByNameOrId("invitations")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Set("runner", runner.Id)
	record.Set("kind", string(kind))
	if kind == invitations.KindInvite {
		record.Set("role", "member")
	}
	record.Set("token_hash", invitations.Hash(token))
	record.Set("expires_at", time.Now().Add(7*24*time.Hour))
	for _, option := range options {
		option(record)
	}
	if err := app.Save(record); err != nil {
		t.Fatalf("seeding an invitation: %v", err)
	}
	return record
}

// inviteSam stores an invitation for Sam, who has no account.
func inviteSam(options ...seedOption) beforeFunc {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		seed(t, app, fx.SamRunner, invitations.KindInvite, samToken, options...)
	}
}

// resetBob stores a password reset for Bob.
func resetBob(options ...seedOption) beforeFunc {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		seed(t, app, fx.BobRunner, invitations.KindReset, bobToken, options...)
	}
}

// before runs the hooks one after the other.
func before(hooks ...beforeFunc) beforeFunc {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		for _, hook := range hooks {
			hook(t, app, fx)
		}
	}
}

// after runs the checks one after the other.
func after(checks ...afterFunc) afterFunc {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		for _, check := range checks {
			check(t, app, fx)
		}
	}
}

// failingUpdates makes every update of an invitation fail, which is the last
// write of an accept: what it did before must then be rolled back.
func failingUpdates(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
	t.Helper()
	app.OnRecordUpdate("invitations").BindFunc(func(*core.RecordEvent) error {
		return errors.New("the invitation cannot be saved")
	})
}

// ---------------------------------------------------------------------------
// Reading the database

func allInvitations(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	records, err := app.FindAllRecords("invitations")
	if err != nil {
		t.Fatal(err)
	}
	return records
}

// invitationOf returns the invitation whose plain token is token.
func invitationOf(t testing.TB, app core.App, token string) *core.Record {
	t.Helper()
	record, err := app.FindFirstRecordByData("invitations", "token_hash", invitations.Hash(token))
	if err != nil {
		t.Fatalf("finding the invitation of the token %q: %v", token, err)
	}
	return record
}

func stored(t testing.TB, app core.App, collection, id string) *core.Record {
	t.Helper()
	record, err := app.FindRecordById(collection, id)
	if err != nil {
		t.Fatalf("finding %s %s: %v", collection, id, err)
	}
	return record
}

func countUsers(t testing.TB, app core.App) int {
	t.Helper()
	n, err := app.CountRecords("users")
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

func isUsed(invitation *core.Record) bool { return !invitation.GetDateTime("used_at").IsZero() }

// ---------------------------------------------------------------------------
// Checks on the database

func invitationCount(want int) afterFunc {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		if got := len(allInvitations(t, app)); got != want {
			t.Errorf("%d invitations, want %d", got, want)
		}
	}
}

// invitationKept asserts that the invitation of the token is still in the
// database.
func invitationKept(token string) afterFunc {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		invitationOf(t, app, token)
	}
}

// invitationGone asserts that the invitation of the token was deleted.
func invitationGone(token string) afterFunc {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		if _, err := app.FindFirstRecordByData("invitations", "token_hash", invitations.Hash(token)); err == nil {
			t.Errorf("the invitation of the token %q is still there", token)
		}
	}
}

// stillPending asserts that the invitation of the token has not been used.
func stillPending(token string) afterFunc {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		if isUsed(invitationOf(t, app, token)) {
			t.Errorf("the invitation of the token %q was marked as used", token)
		}
	}
}

// noAccountCreated asserts that the fixture accounts are the only ones and that
// Sam still has none.
func noAccountCreated(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	if got := countUsers(t, app); got != 3 {
		t.Errorf("%d accounts, want the 3 of the fixture", got)
	}
	if got := stored(t, app, "runners", fx.SamRunner.Id).GetString("user"); got != "" {
		t.Errorf("Sam's runner is linked to the account %q", got)
	}
}

// bobUntouched asserts that Bob's account is as the fixture made it: the same
// password, and the same token key, so that his sessions are still valid.
func bobUntouched(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	bob := stored(t, app, "users", fx.Bob.Id)
	if !bob.ValidatePassword(testutil.Password) {
		t.Error("Bob's password changed")
	}
	if bob.TokenKey() != fx.Bob.TokenKey() {
		t.Error("Bob's token key changed")
	}
}

// refused asserts that a refused accept left everything as it was.
func refused(token string) afterFunc {
	return after(noAccountCreated, bobUntouched, stillPending(token))
}

// ---------------------------------------------------------------------------
// Create and revoke

func TestInvitations_Create(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "an admin creates an invitation to join",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusOK,
			Contains: []string{`"url":"http://localhost:5173/invitation/`, `"expiresAt"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				records := allInvitations(t, app)
				if len(records) != 1 {
					t.Fatalf("%d invitations, want 1", len(records))
				}
				inv := records[0]
				if got := len(inv.GetString("token_hash")); got != 64 {
					t.Errorf("len(token_hash) = %d, want 64", got)
				}
				want := time.Now().Add(7 * 24 * time.Hour)
				if got := inv.GetDateTime("expires_at").Time(); got.Before(want.Add(-time.Minute)) || got.After(want.Add(time.Minute)) {
					t.Errorf("expires_at = %s, want about %s", got, want)
				}
				if got := inv.GetString("runner"); got != fx.SamRunner.Id {
					t.Errorf("runner = %q, want Sam's", got)
				}
				if got := inv.GetString("kind"); got != "invite" {
					t.Errorf("kind = %q, want invite", got)
				}
				if got := inv.GetString("role"); got != "member" {
					t.Errorf("role = %q, want member by default", got)
				}
				if got := inv.GetString("created_by"); got != fx.Admin.Id {
					t.Errorf("created_by = %q, want the admin", got)
				}
				if isUsed(inv) {
					t.Error("the new invitation is used")
				}
			},
		},
		{
			Name:     "an invitation can give the admin role",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite","role":"admin"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				records := allInvitations(t, app)
				if len(records) != 1 || records[0].GetString("role") != "admin" {
					t.Fatalf("want one invitation with the admin role, got %d", len(records))
				}
			},
		},
		{
			Name:     "an admin creates a password reset for an account",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(bobRunner, `"kind":"reset","role":"admin"`),
			Status:   http.StatusOK,
			Contains: []string{`"url":"http://localhost:5173/invitation/`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				records := allInvitations(t, app)
				if len(records) != 1 {
					t.Fatalf("%d invitations, want 1", len(records))
				}
				if got := records[0].GetString("kind"); got != "reset" {
					t.Errorf("kind = %q, want reset", got)
				}
				if got := records[0].GetString("role"); got != "" {
					t.Errorf("role = %q, a reset gives none", got)
				}
				if got := records[0].GetString("runner"); got != fx.BobRunner.Id {
					t.Errorf("runner = %q, want Bob's", got)
				}
			},
		},
		{
			Name:   "a new invitation replaces the pending one of the runner",
			As:     "admin",
			Before: inviteSam(),
			Method: http.MethodPost, URL: path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After:    after(invitationCount(1), invitationGone(samToken)),
		},
		{
			Name: "an expired invitation of the runner is replaced too",
			As:   "admin", Before: inviteSam(expired()),
			Method: http.MethodPost, URL: path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After:    after(invitationCount(1), invitationGone(samToken)),
		},
		{
			Name: "the invitations of other runners are kept",
			As:   "admin",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				runners, err := app.FindCollectionByNameOrId("runners")
				if err != nil {
					t.Fatal(err)
				}
				zed := core.NewRecord(runners)
				zed.Set("name", "Zed")
				if err := app.Save(zed); err != nil {
					t.Fatal(err)
				}
				seed(t, app, zed, invitations.KindInvite, "token-for-zed")
			},
			Method: http.MethodPost, URL: path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After:    after(invitationCount(2), invitationKept("token-for-zed")),
		},
		{
			Name: "a used invitation of the runner is kept",
			As:   "admin", Before: inviteSam(used()),
			Method: http.MethodPost, URL: path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After:    after(invitationCount(2), invitationKept(samToken)),
		},
		{
			// Not reachable through the API: the account of Bob came from elsewhere
			// than an invitation. The kinds are told apart all the same.
			Name: "a pending invitation of the other kind is kept",
			As:   "admin",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				seed(t, app, fx.BobRunner, invitations.KindInvite, "token-stale-invite")
			},
			Method: http.MethodPost, URL: path(baseURL),
			Body:     createBody(bobRunner, `"kind":"reset"`),
			Status:   http.StatusOK,
			Contains: []string{`"url"`},
			After:    after(invitationCount(2), invitationKept("token-stale-invite")),
		},
		{
			Name:     "a runner that has an account cannot be invited",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(aliceRunner, `"kind":"invite"`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeInvitationKindMismatch)},
			After:    invitationCount(0),
		},
		{
			Name:     "a runner without account cannot get a password reset",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"reset"`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeInvitationKindMismatch)},
			After:    invitationCount(0),
		},
		{
			Name:     "an unknown kind does not fit any runner",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"other"`),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeInvitationKindMismatch)},
			After:    invitationCount(0),
		},
		{
			Name:     "an unknown runner is not found",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     func(testutil.Fixture) string { return `{"runnerId":"nobody","kind":"invite"}` },
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
			After:    invitationCount(0),
		},
		{
			Name:     "a role that does not exist is refused",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite","role":"superuser"`),
			Status:   http.StatusBadRequest,
			Contains: []string{`"role"`},
			After:    invitationCount(0),
		},
		{
			Name:     "a member cannot create an invitation",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusForbidden,
			Contains: []string{code(apperr.CodeForbidden)},
			After:    invitationCount(0),
		},
		{
			Name:     "a visitor cannot create an invitation",
			Method:   http.MethodPost,
			URL:      path(baseURL),
			Body:     createBody(samRunner, `"kind":"invite"`),
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
			After:    invitationCount(0),
		},
	})
}

func TestInvitations_Revoke(t *testing.T) {
	// The id of the invitation that Before stores, for URL.
	var id string
	revoke := func(testutil.Fixture) string { return baseURL + "/" + id }
	store := func(options ...seedOption) beforeFunc {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			t.Helper()
			id = seed(t, app, fx.SamRunner, invitations.KindInvite, samToken, options...).Id
		}
	}

	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a member cannot revoke an invitation", As: "alice", Before: store(),
			Method: http.MethodDelete, URL: revoke,
			Status:   http.StatusForbidden,
			Contains: []string{code(apperr.CodeForbidden)},
			After:    invitationKept(samToken),
		},
		{
			Name: "a visitor cannot revoke an invitation", Before: store(),
			Method: http.MethodDelete, URL: revoke,
			Status:   http.StatusUnauthorized,
			Contains: []string{`"status":401`},
			After:    invitationKept(samToken),
		},
		{
			Name: "an admin revokes a pending invitation", As: "admin", Before: store(),
			Method: http.MethodDelete, URL: revoke,
			Status: http.StatusNoContent,
			After:  invitationGone(samToken),
		},
		{
			Name: "an unknown invitation is not found", As: "admin", Before: store(),
			Method: http.MethodDelete, URL: path(baseURL + "/nobody"),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
			After:    invitationKept(samToken),
		},
		{
			// It is a trace of what happened, not a link to cancel.
			Name: "a used invitation is not revoked", As: "admin", Before: store(used()),
			Method: http.MethodDelete, URL: revoke,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeNotFound)},
			After:    invitationKept(samToken),
		},
	})
}

// ---------------------------------------------------------------------------
// Show

func TestInvitations_Show(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a valid invitation tells who it is for", Before: inviteSam(),
			Method: http.MethodGet, URL: show(samToken),
			Status:      http.StatusOK,
			Contains:    []string{`"runnerName":"Sam"`, `"kind":"invite"`},
			NotContains: []string{"token_hash", samToken},
		},
		{
			Name: "a valid reset tells who it is for", Before: resetBob(),
			Method: http.MethodGet, URL: show(bobToken),
			Status:   http.StatusOK,
			Contains: []string{`"runnerName":"Bob"`, `"kind":"reset"`},
		},
		{
			Name: "an unknown token is invalid", Before: inviteSam(),
			Method: http.MethodGet, URL: show("unknown-token"),
			Status:      http.StatusNotFound,
			Contains:    []string{code(apperr.CodeInvitationInvalid)},
			NotContains: []string{"Sam"},
		},
		{
			Name: "an expired invitation is invalid", Before: inviteSam(expired()),
			Method: http.MethodGet, URL: show(samToken),
			Status:      http.StatusNotFound,
			Contains:    []string{code(apperr.CodeInvitationInvalid)},
			NotContains: []string{"Sam"},
		},
		{
			Name: "a used invitation is invalid", Before: inviteSam(used()),
			Method: http.MethodGet, URL: show(samToken),
			Status:      http.StatusNotFound,
			Contains:    []string{code(apperr.CodeInvitationInvalid)},
			NotContains: []string{"Sam"},
		},
		{
			Name: "an invitation to a runner that has an account since is invalid",
			Before: before(inviteSam(), func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				linkSamToANewAccount(t, app, fx)
			}),
			Method: http.MethodGet, URL: show(samToken),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
		},
		{
			Name: "a reset of a runner without account is invalid",
			Before: before(resetBob(), func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				runner := stored(t, app, "runners", fx.BobRunner.Id)
				runner.Set("user", "")
				if err := app.Save(runner); err != nil {
					t.Fatal(err)
				}
			}),
			Method: http.MethodGet, URL: show(bobToken),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
		},
	})
}

// linkSamToANewAccount gives Sam an account, as if it came from elsewhere than
// the invitation.
func linkSamToANewAccount(t testing.TB, app core.App, fx testutil.Fixture) {
	t.Helper()
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		t.Fatal(err)
	}
	user := core.NewRecord(users)
	user.SetEmail("carol@example.test")
	user.SetPassword(testutil.Password)
	user.Set("role", "member")
	if err := app.Save(user); err != nil {
		t.Fatal(err)
	}
	runner := stored(t, app, "runners", fx.SamRunner.Id)
	runner.Set("user", user.Id)
	if err := app.Save(runner); err != nil {
		t.Fatal(err)
	}
}

// ---------------------------------------------------------------------------
// Accept an invitation

func TestInvitations_Accept(t *testing.T) {
	const email = "sam@example.test"
	signUp := acceptBody(email, testutil.Password, testutil.Password)

	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a valid invitation creates the account and signs it in", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status:   http.StatusOK,
			Contains: []string{`"token"`, `"email":"` + email + `"`, `"role":"member"`},
			// What PocketBase keeps secret in an account stays so in the response.
			NotContains: []string{"tokenKey", "passwordHash", testutil.Password},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindAuthRecordByEmail("users", email)
				if err != nil {
					t.Fatalf("the account was not created: %v", err)
				}
				if got := user.GetString("role"); got != "member" {
					t.Errorf("role = %q, want member", got)
				}
				if !user.Verified() {
					t.Error("the account is not verified")
				}
				if user.GetBool("disabled") {
					t.Error("the account is disabled")
				}
				if !user.ValidatePassword(testutil.Password) {
					t.Error("the password is not the one that was sent")
				}
				if got := stored(t, app, "runners", fx.SamRunner.Id).GetString("user"); got != user.Id {
					t.Errorf("Sam's runner is linked to %q, want the new account %q", got, user.Id)
				}
				if !isUsed(invitationOf(t, app, samToken)) {
					t.Error("the invitation is not marked as used")
				}
				if got := countUsers(t, app); got != 4 {
					t.Errorf("%d accounts, want 4", got)
				}
			},
		},
		{
			Name: "the account gets the role of the invitation", Before: inviteSam(withRole("admin")),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status:   http.StatusOK,
			Contains: []string{`"token"`, `"role":"admin"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				user, err := app.FindAuthRecordByEmail("users", email)
				if err != nil {
					t.Fatal(err)
				}
				if got := user.GetString("role"); got != "admin" {
					t.Errorf("role = %q, want admin", got)
				}
			},
		},
		{
			Name: "an unknown token is invalid", Before: inviteSam(),
			Method: http.MethodPost, URL: accept("unknown-token"), Body: signUp,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After:    refused(samToken),
		},
		{
			Name: "an expired invitation is invalid", Before: inviteSam(expired()),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After:    refused(samToken),
		},
		{
			Name: "a used invitation is invalid", Before: inviteSam(used()),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After:    noAccountCreated,
		},
		{
			Name: "an invitation to a runner that has an account since is invalid",
			Before: before(inviteSam(), func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				linkSamToANewAccount(t, app, fx)
			}),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := countUsers(t, app); got != 4 {
					t.Errorf("%d accounts, want 4: the one of the fixture and Carol", got)
				}
				stillPending(samToken)(t, app, fx)
			},
		},
		{
			Name: "an email that another account has is refused", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("alice@example.test", testutil.Password, testutil.Password),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailTaken)},
			After:    refused(samToken),
		},
		{
			Name: "the emails are compared without their letter case", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("ALICE@Example.test", testutil.Password, testutil.Password),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailTaken)},
			After:    refused(samToken),
		},
		{
			Name: "a text that is not an email is refused", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("not-an-email", testutil.Password, testutil.Password),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailInvalid)},
			After:    refused(samToken),
		},
		{
			Name: "no email is refused", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("", testutil.Password, testutil.Password),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodeEmailInvalid)},
			After:    refused(samToken),
		},
		{
			Name: "a password of 9 characters is too short", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody(email, "123456789", "123456789"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordTooShort)},
			After:    refused(samToken),
		},
		{
			// 9 characters, 18 bytes.
			Name: "the length of the password counts characters, not bytes", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody(email, "ééééééééé", "ééééééééé"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordTooShort)},
			After:    refused(samToken),
		},
		{
			Name: "a password of 10 characters is long enough", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody(email, "1234567890", "1234567890"),
			Status:   http.StatusOK,
			Contains: []string{`"token"`},
		},
		{
			Name: "a confirmation that differs is refused", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody(email, testutil.Password, testutil.Password+"x"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordMismatch)},
			After:    refused(samToken),
		},

		// The order of the checks: the invitation, the length of the password,
		// the confirmation, the format of the email, then the email taken.
		{
			Name: "the invitation is checked before the password", Before: inviteSam(),
			Method: http.MethodPost, URL: accept("unknown-token"),
			Body:     acceptBody("not-an-email", "short", "other"),
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
		},
		{
			Name: "the length of the password is checked before the confirmation", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("not-an-email", "short", "other"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordTooShort)},
		},
		{
			Name: "the confirmation is checked before the email", Before: inviteSam(),
			Method: http.MethodPost, URL: accept(samToken),
			Body:     acceptBody("not-an-email", testutil.Password, "other-password"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordMismatch)},
		},

		// The accept runs in one transaction: what it wrote before the last write
		// failed is rolled back.
		{
			Name:   "the account and the link are rolled back when the invitation cannot be saved",
			Before: before(inviteSam(), failingUpdates),
			Method: http.MethodPost, URL: accept(samToken), Body: signUp,
			Status: http.StatusInternalServerError,
			After:  refused(samToken),
		},
	})
}

// ---------------------------------------------------------------------------
// Password reset

func TestInvitations_AcceptReset(t *testing.T) {
	const newPassword = "new-password-1"
	reset := acceptBody("", newPassword, newPassword)

	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a reset changes the password and signs in", Before: resetBob(),
			Method: http.MethodPost, URL: accept(bobToken), Body: reset,
			Status:   http.StatusOK,
			Contains: []string{`"token"`, `"email":"bob@example.test"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				bob := stored(t, app, "users", fx.Bob.Id)
				if !bob.ValidatePassword(newPassword) {
					t.Error("the password is not the new one")
				}
				if bob.ValidatePassword(testutil.Password) {
					t.Error("the old password is still valid")
				}
				if bob.TokenKey() == fx.Bob.TokenKey() {
					t.Error("the token key was not renewed")
				}
				if !isUsed(invitationOf(t, app, bobToken)) {
					t.Error("the invitation is not marked as used")
				}
				if got := countUsers(t, app); got != 3 {
					t.Errorf("%d accounts, want 3", got)
				}
				if got := bob.GetString("role"); got != "member" {
					t.Errorf("role = %q, want member", got)
				}
			},
		},
		{
			Name: "a reset never changes the email", Before: resetBob(),
			Method: http.MethodPost, URL: accept(bobToken),
			Body:   acceptBody("other@example.test", newPassword, newPassword),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := stored(t, app, "users", fx.Bob.Id).Email(); got != "bob@example.test" {
					t.Errorf("email = %q, want bob@example.test", got)
				}
			},
		},
		{
			Name: "a reset needs a long enough password", Before: resetBob(),
			Method: http.MethodPost, URL: accept(bobToken),
			Body:     acceptBody("", "123456789", "123456789"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordTooShort)},
			After:    refused(bobToken),
		},
		{
			Name: "a reset needs a confirmation that matches", Before: resetBob(),
			Method: http.MethodPost, URL: accept(bobToken),
			Body:     acceptBody("", newPassword, newPassword+"x"),
			Status:   http.StatusBadRequest,
			Contains: []string{code(apperr.CodePasswordMismatch)},
			After:    refused(bobToken),
		},
		{
			Name: "an expired reset is invalid", Before: resetBob(expired()),
			Method: http.MethodPost, URL: accept(bobToken), Body: reset,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After:    refused(bobToken),
		},
		{
			Name: "a used reset is invalid", Before: resetBob(used()),
			Method: http.MethodPost, URL: accept(bobToken), Body: reset,
			Status:   http.StatusNotFound,
			Contains: []string{code(apperr.CodeInvitationInvalid)},
			After:    bobUntouched,
		},
		{
			// The session of the response would be refused by the sign-in rule: the
			// reset must not consume the link for nothing.
			Name: "a reset does not apply to a disabled account",
			Before: before(resetBob(), func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				bob := stored(t, app, "users", fx.Bob.Id)
				bob.Set("disabled", true)
				if err := app.Save(bob); err != nil {
					t.Fatal(err)
				}
			}),
			Method: http.MethodPost, URL: accept(bobToken), Body: reset,
			Status:   http.StatusForbidden,
			Contains: []string{code(apperr.CodeAccountDisabled)},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				bob := stored(t, app, "users", fx.Bob.Id)
				if !bob.ValidatePassword(testutil.Password) {
					t.Error("the password of the disabled account changed")
				}
				stillPending(bobToken)(t, app, fx)
			},
		},
		{
			Name:   "the password is rolled back when the invitation cannot be saved",
			Before: before(resetBob(), failingUpdates),
			Method: http.MethodPost, URL: accept(bobToken), Body: reset,
			Status: http.StatusInternalServerError,
			After:  refused(bobToken),
		},
	})
}

// ---------------------------------------------------------------------------
// Requests that depend on one another

// urlIn returns the URL of a create response, and the token at its end.
func urlIn(t testing.TB, response string) (url, token string) {
	t.Helper()
	var created struct {
		URL       string `json:"url"`
		ExpiresAt string `json:"expiresAt"`
	}
	if err := json.Unmarshal([]byte(response), &created); err != nil || created.URL == "" {
		t.Fatalf("no url in the response %q (%v)", response, err)
	}
	const prefix = "http://localhost:5173/invitation/"
	if !strings.HasPrefix(created.URL, prefix) {
		t.Fatalf("url = %q, want it to start with %q", created.URL, prefix)
	}
	return created.URL, strings.TrimPrefix(created.URL, prefix)
}

func TestInvitations_CreateReturnsAWorkingLink(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seq := testutil.NewSequence(t, app)

	response := seq.Step("create the invitation", http.MethodPost, baseURL, testutil.Token(t, fx.Admin),
		`{"runnerId":"`+fx.SamRunner.Id+`","kind":"invite"}`, http.StatusOK, `"expiresAt"`)
	_, token := urlIn(t, response)

	if got := len(token); got != 43 {
		t.Errorf("the token of the link has %d characters, want 43", got)
	}
	if stored := invitationOf(t, app, token); stored.GetString("token_hash") != invitations.Hash(token) {
		t.Error("the stored hash is not the one of the token in the link")
	}
	if strings.Contains(response, invitations.Hash(token)) {
		t.Error("the response carries the hash")
	}

	var created struct {
		ExpiresAt string `json:"expiresAt"`
	}
	if err := json.Unmarshal([]byte(response), &created); err != nil {
		t.Fatal(err)
	}
	expiresAt, err := time.Parse(time.RFC3339, created.ExpiresAt)
	if err != nil {
		t.Fatalf("expiresAt = %q is not an RFC 3339 date: %v", created.ExpiresAt, err)
	}
	want := time.Now().Add(7 * 24 * time.Hour)
	if expiresAt.Before(want.Add(-time.Minute)) || expiresAt.After(want.Add(time.Minute)) {
		t.Errorf("expiresAt = %s, want about %s", expiresAt, want)
	}

	seq.Step("the link shows the runner", http.MethodGet, baseURL+"/"+token, "", "", http.StatusOK, `"runnerName":"Sam"`)
}

// Creating the same invitation again replaces the first one, which stops
// working: only the last link is valid.
func TestInvitations_CreateTwice(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seq := testutil.NewSequence(t, app)
	adminToken := testutil.Token(t, fx.Admin)
	body := `{"runnerId":"` + fx.SamRunner.Id + `","kind":"invite"}`

	_, first := urlIn(t, seq.Step("first request", http.MethodPost, baseURL, adminToken, body, http.StatusOK, `"url"`))
	_, second := urlIn(t, seq.Step("second request", http.MethodPost, baseURL, adminToken, body, http.StatusOK, `"url"`))

	if first == second {
		t.Fatal("the two requests gave the same token")
	}
	if got := len(allInvitations(t, app)); got != 1 {
		t.Errorf("%d invitations, want 1 pending for Sam", got)
	}
	seq.Step("the first link no longer works", http.MethodGet, baseURL+"/"+first, "", "", http.StatusNotFound, code(apperr.CodeInvitationInvalid))
	seq.Step("the second link works", http.MethodGet, baseURL+"/"+second, "", "", http.StatusOK, `"runnerName":"Sam"`)
}

func TestInvitations_RevokeStopsTheLink(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seq := testutil.NewSequence(t, app)
	adminToken := testutil.Token(t, fx.Admin)

	_, token := urlIn(t, seq.Step("create", http.MethodPost, baseURL, adminToken,
		`{"runnerId":"`+fx.SamRunner.Id+`","kind":"invite"}`, http.StatusOK, `"url"`))
	id := invitationOf(t, app, token).Id

	seq.Step("the link works", http.MethodGet, baseURL+"/"+token, "", "", http.StatusOK, `"runnerName":"Sam"`)
	seq.Step("revoke", http.MethodDelete, baseURL+"/"+id, adminToken, "", http.StatusNoContent)
	seq.Step("the link no longer works", http.MethodGet, baseURL+"/"+token, "", "", http.StatusNotFound, code(apperr.CodeInvitationInvalid))
	seq.Step("it cannot be accepted either", http.MethodPost, baseURL+"/"+token+"/accept", "",
		`{"email":"sam@example.test","password":"`+testutil.Password+`","passwordConfirm":"`+testutil.Password+`"}`,
		http.StatusNotFound, code(apperr.CodeInvitationInvalid))
	seq.Step("revoking it again finds nothing", http.MethodDelete, baseURL+"/"+id, adminToken, "", http.StatusNotFound, code(apperr.CodeNotFound))
	noAccountCreated(t, app, fx)
}

func TestInvitations_AcceptTwice(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	inviteSam()(t, app, fx)
	seq := testutil.NewSequence(t, app)
	url := baseURL + "/" + samToken + "/accept"
	body := `{"email":"sam@example.test","password":"` + testutil.Password + `","passwordConfirm":"` + testutil.Password + `"}`

	seq.Step("first accept", http.MethodPost, url, "", body, http.StatusOK, `"token"`)
	// Another email, so that the refusal can only be about the token.
	seq.Step("second accept", http.MethodPost, url, "",
		`{"email":"other@example.test","password":"`+testutil.Password+`","passwordConfirm":"`+testutil.Password+`"}`,
		http.StatusNotFound, code(apperr.CodeInvitationInvalid))

	if got := countUsers(t, app); got != 4 {
		t.Errorf("%d accounts, want 4: the second accept created one", got)
	}
	if _, err := app.FindAuthRecordByEmail("users", "other@example.test"); err == nil {
		t.Error("the second accept created an account")
	}
}

// An accept that the email refuses leaves the invitation as it was, so the
// person can try again with another email.
func TestInvitations_AcceptEmailTakenThenRetry(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	inviteSam()(t, app, fx)
	seq := testutil.NewSequence(t, app)
	url := baseURL + "/" + samToken + "/accept"
	body := func(email string) string {
		return `{"email":"` + email + `","password":"` + testutil.Password + `","passwordConfirm":"` + testutil.Password + `"}`
	}

	seq.Step("an email that is taken", http.MethodPost, url, "", body("alice@example.test"), http.StatusBadRequest, code(apperr.CodeEmailTaken))
	noAccountCreated(t, app, fx)
	stillPending(samToken)(t, app, fx)

	seq.Step("another email", http.MethodPost, url, "", body("sam@example.test"), http.StatusOK, `"token"`)
	if got := countUsers(t, app); got != 4 {
		t.Errorf("%d accounts, want 4", got)
	}
	if !isUsed(invitationOf(t, app, samToken)) {
		t.Error("the invitation is not marked as used")
	}
}

// The new account can sign in with what it chose.
func TestInvitations_AcceptThenSignIn(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	inviteSam()(t, app, fx)
	seq := testutil.NewSequence(t, app)

	response := seq.Step("accept", http.MethodPost, baseURL+"/"+samToken+"/accept", "",
		`{"email":"sam@example.test","password":"sam-password-1","passwordConfirm":"sam-password-1"}`,
		http.StatusOK, `"token"`)
	seq.Step("the session of the response refreshes", http.MethodPost, "/api/collections/users/auth-refresh",
		testutil.TokenIn(t, response), "", http.StatusOK, `"email":"sam@example.test"`)
	seq.Step("sign in", http.MethodPost, "/api/collections/users/auth-with-password", "",
		`{"identity":"sam@example.test","password":"sam-password-1"}`, http.StatusOK, `"token"`)
}

// Using a reset ends the sessions of the account and gives it a new one.
func TestInvitations_ResetFlow(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	seq := testutil.NewSequence(t, app)
	oldToken := testutil.Token(t, fx.Bob)
	refresh := "/api/collections/users/auth-refresh"
	login := "/api/collections/users/auth-with-password"
	credentials := func(password string) string {
		return `{"identity":"bob@example.test","password":"` + password + `"}`
	}

	seq.Step("Bob's session works", http.MethodPost, refresh, oldToken, "", http.StatusOK, `"token"`)
	_, token := urlIn(t, seq.Step("the admin creates a reset", http.MethodPost, baseURL, testutil.Token(t, fx.Admin),
		`{"runnerId":"`+fx.BobRunner.Id+`","kind":"reset"}`, http.StatusOK, `"url"`))
	seq.Step("the link tells it is a reset", http.MethodGet, baseURL+"/"+token, "", "", http.StatusOK, `"runnerName":"Bob"`, `"kind":"reset"`)

	response := seq.Step("Bob chooses a password", http.MethodPost, baseURL+"/"+token+"/accept", "",
		`{"password":"new-password-1","passwordConfirm":"new-password-1"}`, http.StatusOK, `"token"`, `"email":"bob@example.test"`)

	seq.Step("the session of before is refused", http.MethodPost, refresh, oldToken, "", http.StatusUnauthorized, `"status":401`)
	seq.Step("the session of the response works", http.MethodPost, refresh, testutil.TokenIn(t, response), "", http.StatusOK, `"token"`)
	seq.Step("the new password signs in", http.MethodPost, login, "", credentials("new-password-1"), http.StatusOK, `"token"`)
	seq.Step("the old password does not", http.MethodPost, login, "", credentials(testutil.Password), http.StatusBadRequest, `"status":400`)
	seq.Step("the link is used up", http.MethodGet, baseURL+"/"+token, "", "", http.StatusNotFound, code(apperr.CodeInvitationInvalid))
	seq.Step("it cannot be used twice", http.MethodPost, baseURL+"/"+token+"/accept", "",
		`{"password":"third-password-1","passwordConfirm":"third-password-1"}`, http.StatusNotFound, code(apperr.CodeInvitationInvalid))
	// Two sign-ins fill what the rate limit allows for a few seconds: look at the
	// database for the password.
	if bob := stored(t, app, "users", fx.Bob.Id); !bob.ValidatePassword("new-password-1") {
		t.Error("the second use of the link changed the password")
	}
}

// ---------------------------------------------------------------------------
// The Go API, as the command line will use it

func apiError(t testing.TB, err error) *router.ApiError {
	t.Helper()
	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) {
		t.Fatalf("err = %v, want an API error", err)
	}
	return apiErr
}

func TestCreate(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	t.Run("without author, as the command line does", func(t *testing.T) {
		token, inv, err := invitations.Create(app, invitations.CreateInput{
			RunnerID: fx.SamRunner.Id, Kind: invitations.KindInvite, Role: "admin",
		})
		if err != nil {
			t.Fatal(err)
		}
		if got := inv.GetString("created_by"); got != "" {
			t.Errorf("created_by = %q, want none", got)
		}
		if got := inv.GetString("role"); got != "admin" {
			t.Errorf("role = %q, want admin", got)
		}
		found, runner, err := invitations.Find(app, token)
		if err != nil {
			t.Fatal(err)
		}
		if found.Id != inv.Id || runner.Id != fx.SamRunner.Id {
			t.Errorf("Find gave the invitation %s of the runner %s", found.Id, runner.Id)
		}
	})

	t.Run("an invitation without role is for a member", func(t *testing.T) {
		_, inv, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.SamRunner.Id, Kind: invitations.KindInvite})
		if err != nil {
			t.Fatal(err)
		}
		if got := inv.GetString("role"); got != "member" {
			t.Errorf("role = %q, want member", got)
		}
	})

	t.Run("a mismatch is a 400 with its code", func(t *testing.T) {
		_, _, err := invitations.Create(app, invitations.CreateInput{RunnerID: fx.AliceRunner.Id, Kind: invitations.KindInvite})
		if got := apiError(t, err); got.Status != http.StatusBadRequest || got.Data["code"] != apperr.CodeInvitationKindMismatch {
			t.Errorf("err = %v, want a 400 %s", err, apperr.CodeInvitationKindMismatch)
		}
	})
}

func TestFind_UnknownToken(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)

	_, _, err := invitations.Find(app, "unknown-token")
	if got := apiError(t, err); got.Status != http.StatusNotFound || got.Data["code"] != apperr.CodeInvitationInvalid {
		t.Errorf("err = %v, want a 404 %s", err, apperr.CodeInvitationInvalid)
	}
}
