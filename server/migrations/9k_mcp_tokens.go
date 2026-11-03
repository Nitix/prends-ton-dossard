package migrations

import (
	"database/sql"
	"errors"
	"fmt"
	"slices"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
)

// mcpRateLimitRule limits /mcp per address. It is a backstop for the requests
// that carry no valid token, and so have no token to be counted by: the limit
// of a token (300 a minute) is held by the mcp package, which can tell the
// tokens apart where PocketBase only knows addresses. It is well above that
// limit, so that two assistants behind one box do not share one.
//
// A label without a trailing slash is matched by equality with the path, so
// its place among the rules does not matter, unlike the prefix rules of
// ourRateLimitRules, which must come before the "/api/" one.
var mcpRateLimitRule = core.RateLimitRule{Label: "/mcp", MaxRequests: 1500, Duration: 60}

func init() {
	pbmigrations.Register(upMCPTokens, downMCPTokens)
}

// upMCPTokens creates the personal tokens of the accounts, with which an
// assistant (an MCP client) acts on the site as the owner of the token, and adds
// the rate limit rule of /mcp.
//
//   - A token goes with its account (cascade). An account has up to five, a limit
//     that the model hook of the mcpauth package holds.
//   - Only the SHA-256 of the secret is kept, as for the invitations, and the field
//     is hidden: a copy of the database gives no working token. Unlike the calendar
//     link, the token itself is not kept: it is shown once, when it is made.
//   - The name is how the owner tells their tokens apart in their settings (« Claude
//     sur mon PC »). The mcpauth package removes the spaces around it.
//   - last_used_at is empty for a token that was never used.
//   - All the rules are null (the collection is created with them): only the mcpauth
//     package reads and writes the table, so that no API response shows the hash of
//     a token (a superuser sees the hidden fields).
//   - The rule of /mcp goes first among the rate limit rules, as the ones of
//     3_settings.go do.
func upMCPTokens(app core.App) error {
	users, err := app.FindCollectionByNameOrId("users")
	if err != nil {
		return err
	}

	c := core.NewBaseCollection("mcp_tokens")
	c.Fields.Add(
		cascade(required(relation("user", users))),
		&core.TextField{Name: "name", Required: true, Min: 1, Max: 50},
		&core.TextField{Name: "token_hash", Required: true, Hidden: true},
		&core.DateField{Name: "last_used_at"},
	)
	c.Indexes = types.JSONArray[string]{
		"CREATE INDEX idx_mcp_tokens_user ON mcp_tokens (user)",
	}
	if _, err := saveCollection(app, withTimestamps(c)); err != nil {
		return err
	}

	settings := app.Settings()
	settings.RateLimits.Rules = append([]core.RateLimitRule{mcpRateLimitRule}, settings.RateLimits.Rules...)
	return app.Save(settings)
}

// downMCPTokens drops the table, and the tokens in it: the assistants that hold
// one get a 401. It takes the rule of /mcp away too. What is already gone is not
// an error.
func downMCPTokens(app core.App) error {
	c, err := app.FindCollectionByNameOrId("mcp_tokens")
	switch {
	case errors.Is(err, sql.ErrNoRows):
		// already gone
	case err != nil:
		return err
	default:
		if err := app.Delete(c); err != nil {
			return fmt.Errorf("%s: %w", c.Name, err)
		}
	}

	settings := app.Settings()
	settings.RateLimits.Rules = slices.DeleteFunc(settings.RateLimits.Rules, func(r core.RateLimitRule) bool {
		return r.Label == mcpRateLimitRule.Label
	})
	return app.Save(settings)
}
