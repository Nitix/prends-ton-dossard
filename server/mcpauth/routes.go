package mcpauth

import (
	"database/sql"
	"errors"
	"net/http"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
	"courses/server/config"
)

// tokensPath is the collection of the routes of the tokens.
const tokensPath = "/api/app/mcp-tokens"

// registerRoutes adds the routes with which a member lists, makes and revokes
// their own tokens: the settings page uses them, and the tool mcp_tokens lists
// and revokes through them (it makes none).
//
// All of them want a session of the site (RequireAuth), which a token of an
// assistant is not: a token cannot make another one, whose secret would pass
// through the assistant. They only know the tokens of the caller.
func registerRoutes(app core.App, cfg config.Config) {
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.GET(tokensPath, listRoute(cfg)).Bind(apis.RequireAuth("users"))
		e.Router.POST(tokensPath, createRoute(cfg)).Bind(apis.RequireAuth("users"))
		e.Router.DELETE(tokensPath+"/{id}", revokeRoute).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
}

// serverURL is the address of the MCP server, which the person puts in the
// command of their assistant.
func serverURL(cfg config.Config) string {
	return cfg.AppURL + "/mcp"
}

// fail returns err as the response: a refused value or the limit is the caller's
// (a 400 with its code), and any other error is the server's.
func fail(e *core.RequestEvent, err error) error {
	var apiErr *router.ApiError
	if errors.As(err, &apiErr) {
		return apiErr
	}
	var invalid validation.Errors
	if errors.As(err, &invalid) {
		return invalid
	}
	return e.InternalServerError("", err)
}

// listedToken is what the list says of a token. It has no field for the secret
// or for its hash: they cannot be in an answer by a slip.
type listedToken struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Created string `json:"created"`
	// LastUsedAt is empty for a token that was never used.
	LastUsedAt string `json:"lastUsedAt"`
}

// listedTokenOf describes a token record. The dates are written as PocketBase
// writes them (YYYY-MM-DD HH:MM:SS.sssZ, in UTC), as the records of the site are.
func listedTokenOf(record *core.Record) listedToken {
	token := listedToken{
		ID:      record.Id,
		Name:    record.GetString("name"),
		Created: record.GetDateTime("created").String(),
	}
	if last := record.GetDateTime("last_used_at"); !last.IsZero() {
		token.LastUsedAt = last.String()
	}
	return token
}

// listRoute lists the tokens of the caller, the newest first, with the address
// of the server and how many tokens an account may have. Never a secret: the
// table keeps only a hash, and this does not read it.
func listRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var records []*core.Record
		err := e.App.RecordQuery("mcp_tokens").
			AndWhere(dbx.HashExp{"user": e.Auth.Id}).
			// Two tokens made in the same millisecond keep their order from a request to the next.
			OrderBy("created DESC", "id DESC").
			All(&records)
		if err != nil {
			return e.InternalServerError("", err)
		}
		tokens := make([]listedToken, 0, len(records))
		for _, record := range records {
			tokens = append(tokens, listedTokenOf(record))
		}
		return e.JSON(http.StatusOK, map[string]any{
			"url":    serverURL(cfg),
			"max":    MaxPerAccount,
			"tokens": tokens,
		})
	}
}

// createRoute makes a token for the caller. Its answer is the only place where
// the token is: the site keeps a hash, and cannot show it again.
func createRoute(cfg config.Config) func(*core.RequestEvent) error {
	return func(e *core.RequestEvent) error {
		var body struct {
			Name string `json:"name"`
		}
		// A body that cannot be read leaves the name empty, which the validation
		// of the record refuses.
		_ = e.BindBody(&body)

		token, record, err := Create(e.App, e.Auth.Id, body.Name)
		if err != nil {
			return fail(e, err)
		}
		// A secret is not kept by a cache.
		e.Response.Header().Set("Cache-Control", "no-store")
		made := listedTokenOf(record)
		return e.JSON(http.StatusOK, map[string]any{
			"id":      made.ID,
			"name":    made.Name,
			"created": made.Created,
			"token":   token,
			"url":     serverURL(cfg),
		})
	}
}

// revokeRoute deletes a token of the caller: the assistant that holds it is
// refused from its next request. A token that is not there, and the token of
// somebody else, are the same not found: the answer does not tell which ids
// exist.
func revokeRoute(e *core.RequestEvent) error {
	notFound := apperr.New(http.StatusNotFound, apperr.CodeNotFound)

	record, err := e.App.FindRecordById("mcp_tokens", e.Request.PathValue("id"))
	if errors.Is(err, sql.ErrNoRows) {
		return notFound
	}
	if err != nil {
		return e.InternalServerError("", err)
	}
	if record.GetString("user") != e.Auth.Id {
		return notFound
	}
	if err := e.App.Delete(record); err != nil {
		return e.InternalServerError("", err)
	}
	return e.NoContent(http.StatusNoContent)
}
