package mcpauth_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	"courses/server/mcpauth"
	"courses/server/testutil"
)

// tokenCount is the number of tokens that the account has.
func tokenCount(t testing.TB, app core.App, user *core.Record) int {
	t.Helper()
	n, err := app.CountRecords("mcp_tokens", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

// accepted reports whether the token is still good for the account.
func accepted(app core.App, token string, user *core.Record) bool {
	got, _, err := mcpauth.Authenticate(app, "Bearer "+token)
	return err == nil && got.Id == user.Id
}

// patchAccount sends PATCH /api/collections/users/records/<id> as the given
// account, which the site lets an admin do, and checks the answer.
func patchAccount(t *testing.T, app *tests.TestApp, as *core.Record, id, body string, status int, contains string) {
	t.Helper()
	(&tests.ApiScenario{
		Method: http.MethodPatch,
		URL:    "/api/collections/users/records/" + id,
		Body:   strings.NewReader(body),
		Headers: map[string]string{
			"Authorization": testutil.Token(t, as),
			"Content-Type":  "application/json",
		},
		ExpectedStatus:        status,
		ExpectedContent:       []string{contains},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

// world is the accounts of the fixture with their tokens: Admin has one, Alice
// and Bob have two.
type world struct {
	app *tests.TestApp
	fx  testutil.Fixture
	// The tokens by account.
	admin, alice, bob []string
}

func newWorld(t *testing.T) world {
	t.Helper()
	w := world{app: testutil.NewApp(t)}
	w.fx = testutil.Seed(t, w.app)
	for _, c := range []struct {
		user   *core.Record
		tokens *[]string
		names  []string
	}{
		{w.fx.Admin, &w.admin, []string{"Claude"}},
		{w.fx.Alice, &w.alice, []string{"Claude", "ChatGPT"}},
		{w.fx.Bob, &w.bob, []string{"Claude", "ChatGPT"}},
	} {
		for _, name := range c.names {
			token, _ := mustCreate(t, w.app, c.user, name)
			*c.tokens = append(*c.tokens, token)
		}
	}
	return w
}

// A token is valid as long as the account is: an account that an admin
// disables loses its tokens, and they do not come back with the account.
func TestMCPTokens_DisablingTheAccountDeletesItsTokens(t *testing.T) {
	t.Run("an admin disables a member, who loses the tokens", func(t *testing.T) {
		w := newWorld(t)

		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"disabled":true}`, http.StatusOK, `"disabled":true`)

		if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
			t.Errorf("Bob has %d tokens after being disabled, want none", got)
		}
		for _, token := range w.bob {
			if accepted(w.app, token, w.fx.Bob) {
				t.Errorf("the token %s... of a disabled account is still accepted", first8(token))
			}
		}
		// The others are not touched.
		if got := tokenCount(t, w.app, w.fx.Alice); got != 2 {
			t.Errorf("Alice has %d tokens, want her 2", got)
		}
		if got := tokenCount(t, w.app, w.fx.Admin); got != 1 {
			t.Errorf("the admin has %d tokens, want 1", got)
		}
		if !accepted(w.app, w.alice[0], w.fx.Alice) {
			t.Error("Alice's token is refused after Bob was disabled")
		}

		// Enabling the account again brings nothing back, as for the sessions.
		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"disabled":false}`, http.StatusOK, `"disabled":false`)
		if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
			t.Errorf("Bob has %d tokens after being enabled again, want none", got)
		}
		for _, token := range w.bob {
			if accepted(w.app, token, w.fx.Bob) {
				t.Errorf("the token %s... is accepted again when its account is", first8(token))
			}
		}
		// The person makes new ones.
		token, _ := mustCreate(t, w.app, w.fx.Bob, "Claude")
		if !accepted(w.app, token, w.fx.Bob) {
			t.Error("a new token of an account that was enabled again is refused")
		}
	})

	// A disabled account should have no token, but one can be there: made for
	// the account while it was disabled (Create does not look), or left by a
	// disabling whose deletion failed after the update was committed, or made
	// between the update and the deletion. Enabling the account must not bring
	// it back to life.
	t.Run("a token on a disabled account is gone once it is enabled again", func(t *testing.T) {
		w := newWorld(t)
		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"disabled":true}`, http.StatusOK, `"disabled":true`)
		leftover, _ := mustCreate(t, w.app, w.fx.Bob, "Claude")
		if accepted(w.app, leftover, w.fx.Bob) {
			t.Fatal("the test needs a token that a disabled account does not get through with")
		}

		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"disabled":false}`, http.StatusOK, `"disabled":false`)

		if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
			t.Errorf("Bob has %d tokens after being enabled again, want none", got)
		}
		if accepted(w.app, leftover, w.fx.Bob) {
			t.Errorf("the token %s... that was made for a disabled account works once it is enabled", first8(leftover))
		}
		if got := tokenCount(t, w.app, w.fx.Alice); got != 2 {
			t.Errorf("Alice has %d tokens, want her 2", got)
		}
	})

	t.Run("an update that does not disable keeps the tokens", func(t *testing.T) {
		w := newWorld(t)

		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"role":"admin"}`, http.StatusOK, `"role":"admin"`)
		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"disabled":false}`, http.StatusOK, `"disabled":false`)

		if got := tokenCount(t, w.app, w.fx.Bob); got != 2 {
			t.Errorf("Bob has %d tokens, want his 2: a change of role removes none", got)
		}
		if !accepted(w.app, w.bob[0], w.fx.Bob) {
			t.Error("Bob's token is refused after a change of role")
		}
	})

	t.Run("the last admin cannot disable themself, and keeps their tokens", func(t *testing.T) {
		w := newWorld(t)

		patchAccount(t, w.app, w.fx.Admin, w.fx.Admin.Id, `{"disabled":true}`, http.StatusBadRequest, apperr.CodeLastAdmin)

		if got := tokenCount(t, w.app, w.fx.Admin); got != 1 {
			t.Errorf("the admin has %d tokens after a refused disabling, want 1", got)
		}
		if !accepted(w.app, w.admin[0], w.fx.Admin) {
			t.Error("the token of the admin is refused after a refused disabling")
		}
	})

	t.Run("an admin can disable themself once another admin is active", func(t *testing.T) {
		w := newWorld(t)
		patchAccount(t, w.app, w.fx.Admin, w.fx.Bob.Id, `{"role":"admin"}`, http.StatusOK, `"role":"admin"`)

		patchAccount(t, w.app, w.fx.Admin, w.fx.Admin.Id, `{"disabled":true}`, http.StatusOK, `"disabled":true`)

		if got := tokenCount(t, w.app, w.fx.Admin); got != 0 {
			t.Errorf("the admin has %d tokens after being disabled, want none", got)
		}
		if got := tokenCount(t, w.app, w.fx.Bob); got != 2 {
			t.Errorf("Bob has %d tokens, want his 2", got)
		}
	})

	t.Run("an update that fails leaves the tokens", func(t *testing.T) {
		w := newWorld(t)

		// The account is not disabled, since the save is refused: the tokens
		// are deleted once the update went through, and not before.
		w.fx.Bob.Set("disabled", true)
		w.fx.Bob.Set("email", "not an email")
		if err := w.app.Save(w.fx.Bob); err == nil {
			t.Fatal("an account with an invalid email must be refused")
		}

		if stored, err := w.app.FindRecordById("users", w.fx.Bob.Id); err != nil || stored.GetBool("disabled") {
			t.Fatalf("Bob is disabled after a refused update (error %v)", err)
		}
		if got := tokenCount(t, w.app, w.fx.Bob); got != 2 {
			t.Errorf("Bob has %d tokens after a refused disabling, want his 2", got)
		}
	})

	t.Run("a save from the Go code, as the dashboard does", func(t *testing.T) {
		w := newWorld(t)

		// The fixture record was never reloaded: the hook goes by what is stored.
		w.fx.Bob.Set("disabled", true)
		if err := w.app.Save(w.fx.Bob); err != nil {
			t.Fatal(err)
		}

		if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
			t.Errorf("Bob has %d tokens after being disabled, want none", got)
		}
		if got := tokenCount(t, w.app, w.fx.Alice); got != 2 {
			t.Errorf("Alice has %d tokens, want her 2", got)
		}
	})

	t.Run("the tokens go in the transaction of the update", func(t *testing.T) {
		w := newWorld(t)

		// Rolled back: the account is enabled and has its tokens.
		err := w.app.RunInTransaction(func(tx core.App) error {
			bob, err := tx.FindRecordById("users", w.fx.Bob.Id)
			if err != nil {
				return err
			}
			bob.Set("disabled", true)
			if err := tx.Save(bob); err != nil {
				return err
			}
			if n, err := tx.CountRecords("mcp_tokens", dbx.HashExp{"user": bob.Id}); err != nil || n != 0 {
				t.Errorf("inside the transaction, Bob has %d tokens (error %v), want none", n, err)
			}
			return errors.New("rolled back")
		})
		if err == nil || err.Error() != "rolled back" {
			t.Fatalf("the transaction ended with %v, want the error that rolls it back", err)
		}
		if got := tokenCount(t, w.app, w.fx.Bob); got != 2 {
			t.Errorf("Bob has %d tokens after a rolled back disabling, want his 2", got)
		}
		if stored, err := w.app.FindRecordById("users", w.fx.Bob.Id); err != nil || stored.GetBool("disabled") {
			t.Errorf("Bob is disabled after a rolled back disabling (error %v)", err)
		}

		// Committed: both go.
		err = w.app.RunInTransaction(func(tx core.App) error {
			bob, err := tx.FindRecordById("users", w.fx.Bob.Id)
			if err != nil {
				return err
			}
			bob.Set("disabled", true)
			return tx.Save(bob)
		})
		if err != nil {
			t.Fatal(err)
		}
		if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
			t.Errorf("Bob has %d tokens after a committed disabling, want none", got)
		}
	})
}

// Whatever ends the sessions of an account ends its tokens: a new password (from
// the settings, a reset link, or the Go code as the dashboard does it) or a new
// email renews its token key, and its MCP tokens are deleted with the update. A
// stolen session could otherwise make a token that outlives the remedy for it. An
// update that leaves the key keeps them.
func TestMCPTokens_ANewTokenKeyDeletesThem(t *testing.T) {
	const newPassword = "a-brand-new-password-123"

	// gone checks that the account lost its tokens, and that the others kept theirs.
	gone := func(t *testing.T, w world, user *core.Record, tokens []string) {
		t.Helper()
		if got := tokenCount(t, w.app, user); got != 0 {
			t.Errorf("%s has %d tokens, want none", user.Email(), got)
		}
		for _, token := range tokens {
			if accepted(w.app, token, user) {
				t.Errorf("the token %s... is still accepted", first8(token))
			}
		}
		for _, other := range []struct {
			user   *core.Record
			tokens []string
		}{{w.fx.Admin, w.admin}, {w.fx.Alice, w.alice}, {w.fx.Bob, w.bob}} {
			if other.user.Id == user.Id {
				continue
			}
			if got := tokenCount(t, w.app, other.user); got != len(other.tokens) {
				t.Errorf("%s has %d tokens, want their %d", other.user.Email(), got, len(other.tokens))
			}
		}
	}
	// kept checks that the account has all its tokens, and that they work.
	kept := func(t *testing.T, w world, user *core.Record, tokens []string) {
		t.Helper()
		if got := tokenCount(t, w.app, user); got != len(tokens) {
			t.Errorf("%s has %d tokens, want their %d", user.Email(), got, len(tokens))
		}
		for _, token := range tokens {
			if !accepted(w.app, token, user) {
				t.Errorf("the token %s... is refused", first8(token))
			}
		}
	}

	t.Run("a new password, from the settings", func(t *testing.T) {
		w := newWorld(t)
		patchAccount(t, w.app, w.fx.Alice, w.fx.Alice.Id,
			`{"oldPassword":"`+testutil.Password+`","password":"`+newPassword+`","passwordConfirm":"`+newPassword+`"}`, http.StatusOK, `"id"`)
		gone(t, w, w.fx.Alice, w.alice)
	})

	t.Run("a new password, from a reset link", func(t *testing.T) {
		w := newWorld(t)
		seq := testutil.NewSequence(t, w.app)
		created := seq.Step("the admin makes a reset link", http.MethodPost, "/api/app/invitations", testutil.Token(t, w.fx.Admin),
			`{"runnerId":"`+w.fx.BobRunner.Id+`","kind":"reset"}`, http.StatusOK, `"url"`)
		var link struct {
			URL string `json:"url"`
		}
		if err := json.Unmarshal([]byte(created), &link); err != nil {
			t.Fatal(err)
		}
		_, secret, ok := strings.Cut(link.URL, "#")
		if !ok || secret == "" {
			t.Fatal("the reset link has no token")
		}
		accept, _ := json.Marshal(map[string]string{"token": secret, "password": newPassword, "passwordConfirm": newPassword})
		seq.Step("Bob chooses a password", http.MethodPost, "/api/app/invitations/accept", "", string(accept), http.StatusOK, `"token"`)
		gone(t, w, w.fx.Bob, w.bob)
	})

	t.Run("a new email, from the settings", func(t *testing.T) {
		w := newWorld(t)
		testutil.NewSequence(t, w.app).Step("Alice changes her email", http.MethodPost, "/api/app/me/email", testutil.Token(t, w.fx.Alice),
			`{"email":"alice.new@example.test","password":"`+testutil.Password+`"}`, http.StatusOK, `"token"`)
		gone(t, w, w.fx.Alice, w.alice)
	})

	t.Run("a new password, from the Go code as the dashboard does", func(t *testing.T) {
		w := newWorld(t)
		// The fixture record was never reloaded: the hook goes by what is stored.
		w.fx.Bob.SetPassword(newPassword)
		if err := w.app.Save(w.fx.Bob); err != nil {
			t.Fatal(err)
		}
		gone(t, w, w.fx.Bob, w.bob)
	})

	t.Run("the same email again, a refused password, a theme, a name: the key stays, and the tokens", func(t *testing.T) {
		w := newWorld(t)
		seq := testutil.NewSequence(t, w.app)
		alice := testutil.Token(t, w.fx.Alice)
		seq.Step("the same email", http.MethodPost, "/api/app/me/email", alice,
			`{"email":"`+w.fx.Alice.Email()+`","password":"`+testutil.Password+`"}`, http.StatusOK, `"token"`)
		patchAccount(t, w.app, w.fx.Alice, w.fx.Alice.Id,
			`{"oldPassword":"not-her-password-1","password":"`+newPassword+`","passwordConfirm":"`+newPassword+`"}`, http.StatusBadRequest, `"oldPassword"`)
		patchAccount(t, w.app, w.fx.Alice, w.fx.Alice.Id, `{"skin":"nuit"}`, http.StatusOK, `"skin":"nuit"`)
		seq.Step("a new name", http.MethodPatch, "/api/collections/runners/records/"+w.fx.AliceRunner.Id, alice,
			`{"name":"Alice B."}`, http.StatusOK, `"name":"Alice B."`)
		kept(t, w, w.fx.Alice, w.alice)
		kept(t, w, w.fx.Bob, w.bob)
	})
}

// The tokens of an account are deleted with it, by the cascade of the relation.
func TestMCPTokens_GoWithTheAccount(t *testing.T) {
	w := newWorld(t)

	if err := w.app.Delete(w.fx.Bob); err != nil {
		t.Fatal(err)
	}

	if got := tokenCount(t, w.app, w.fx.Bob); got != 0 {
		t.Errorf("Bob has %d tokens after his account was deleted, want none", got)
	}
	for _, token := range w.bob {
		if _, _, err := mcpauth.Authenticate(w.app, "Bearer "+token); !errors.Is(err, mcpauth.ErrInvalid) {
			t.Errorf("the token %s... of a deleted account: error %v, want ErrInvalid", first8(token), err)
		}
	}
	if got := tokenCount(t, w.app, w.fx.Alice); got != 2 {
		t.Errorf("Alice has %d tokens, want her 2", got)
	}
}
