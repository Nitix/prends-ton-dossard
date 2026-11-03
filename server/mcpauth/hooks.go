package mcpauth

import (
	"net/http"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/apperr"
	"courses/server/config"
)

// Register attaches the hooks of the tokens to app, whatever the site is. The
// routes that make and revoke tokens (outside the demo, which has no tokens)
// are what cfg is for.
//
// The hooks keep invariants of the data, so they are model hooks: they also
// protect the writes that do not come from the API (the Go code, the
// commands, the dashboard).
func Register(app core.App, cfg config.Config) {
	// An account has at most MaxPerAccount tokens.
	app.OnRecordCreate("mcp_tokens").BindFunc(func(e *core.RecordEvent) error {
		count, err := e.App.CountRecords("mcp_tokens", dbx.HashExp{"user": e.Record.GetString("user")})
		if err != nil {
			return err
		}
		if count >= MaxPerAccount {
			return apperr.New(http.StatusBadRequest, apperr.CodeTokenLimit)
		}
		return e.Next()
	})

	// A disabled account has no token: they are deleted with the update that
	// disables it, and do not come back when the account is enabled again, as
	// the sessions that the disabling closes do not.
	//
	// They are deleted when the account is enabled again too. None should be
	// there then, and one can be: a deletion that failed after the update was
	// committed (a request has no transaction around its update), a token made
	// between the update and the deletion, or one made for the account while it
	// was disabled. Without this, that token would work again, which is what the
	// deletion is for.
	app.OnRecordUpdate("users").BindFunc(func(e *core.RecordEvent) error {
		// The account as it is stored, as the guards of the accounts package do:
		// not Record.Original, which is stale for a record that was changed and
		// saved again by the same code.
		before, err := e.App.FindRecordById("users", e.Record.Id)
		if err != nil {
			return err
		}

		// Only once the update went through: another hook may refuse it (the
		// last admin cannot be disabled), and the tokens stay then. e.App is the
		// transaction of the update, if there is one, so that the tokens come
		// back if the update is rolled back.
		if err := e.Next(); err != nil {
			return err
		}
		if before.GetBool("disabled") == e.Record.GetBool("disabled") {
			return nil
		}
		return deleteTokensOf(e.App, e.Record.Id)
	})
}

// deleteTokensOf deletes the tokens of the account.
func deleteTokensOf(app core.App, userID string) error {
	tokens, err := app.FindAllRecords("mcp_tokens", dbx.HashExp{"user": userID})
	if err != nil {
		return err
	}
	for _, token := range tokens {
		if err := app.Delete(token); err != nil {
			return err
		}
	}
	return nil
}
