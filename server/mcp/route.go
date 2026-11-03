// Package mcp is the MCP server of the site, on /mcp: an assistant (an MCP
// client) that has the personal token of a member does on the site what that
// member can do, in their name.
//
// # The same requests as the site
//
// A tool does what the site does: requests to the API of PocketBase, served in
// this process by the router of the site, with a session of the owner of the
// token that lives a minute (inner.go). The rules of the collections, the
// routes of the site, their hooks and the batch decide, as for the browser: the
// package never writes itself (TestPackage_NoDirectWrites), and only refuses
// more or asks for a confirmation.
//
// # A request
//
// Each POST /mcp carries its token (mcpauth), is counted against the limit of
// the token (limit.go), and is served by one of two servers of the official SDK,
// the one of the role of the account, read again at each request: a member's has
// no admin tool at all. The server keeps no session (stateless) and answers in
// JSON: every request stands alone, and holds one message (no JSON-RPC batch,
// which the limit would count once).
//
// # Where the tests live
//
// The tests are external (package mcp_test): the test harness imports the
// wiring of the application, which imports this package. export_test.go gives
// them what they need.
package mcp

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/accounts"
	"courses/server/apperr"
	"courses/server/config"
	"courses/server/mcpauth"
)

// endpoint is the address of the server, on the domain of the site.
const endpoint = "/mcp"

// challenge is the WWW-Authenticate header of a refused token.
const challenge = `Bearer realm="prends-ton-dossard"`

// maxBodyBytes bounds the body of a request: a race of twenty formats is a few
// kilobytes; a big file goes through the upload route. The route reads the body
// under it, to refuse a batch, before the SDK, which is given it too.
const maxBodyBytes = 1 << 20

// now is the clock of the package ("today", the limit of the tokens), which the
// tests replace.
var now = time.Now

// Register adds GET, POST and DELETE /mcp to app; nothing on the demo, whose
// account everybody shares (spec § 8.1).
//
// What must outlive a request is made here, once for the app, and not in the
// OnServe closure: a request of tests.ApiScenario triggers OnServe again, and a
// limiter born there would forget the calls made before it.
func Register(app core.App, cfg config.Config) {
	if cfg.Demo() {
		return
	}
	limiter := newTokenLimiter(func() time.Time { return now() })
	schemas := mcpsdk.NewSchemaCache()

	app.OnServe().BindFunc(func(se *core.ServeEvent) error {
		d := &deps{app: se.App, cfg: cfg, inner: &innerAPI{router: se.Router}, schemas: schemas}
		servers := map[role]*mcpsdk.Server{
			roleMember: newServer(d, roleMember),
			roleAdmin:  newServer(d, roleAdmin),
		}
		handler := mcpsdk.NewStreamableHTTPHandler(
			// For each request, the server of the role of the token's owner.
			func(r *http.Request) *mcpsdk.Server {
				c, err := callerOf(r.Context())
				if err != nil {
					return nil
				}
				return servers[c.role]
			},
			&mcpsdk.StreamableHTTPOptions{
				Stateless:    true,
				JSONResponse: true,
				// The protection against DNS rebinding is for a local server
				// without authentication: every request here carries a token,
				// and behind a proxy on the same host it would refuse all of
				// them (spec § 3.3).
				DisableLocalhostProtection: true,
				MaxRequestBodyBytes:        maxBodyBytes,
			})

		serve := func(e *core.RequestEvent) error {
			user, token, err := mcpauth.Authenticate(e.App, e.Request.Header.Get("Authorization"))
			if errors.Is(err, mcpauth.ErrInvalid) {
				e.Response.Header().Set("WWW-Authenticate", challenge)
				return apperr.New(http.StatusUnauthorized, apperr.CodeTokenInvalid)
			}
			if err != nil {
				// The database failed: not a refusal of the token.
				e.App.Logger().Error("mcp: checking a token", "error", err)
				return e.InternalServerError("", nil)
			}
			if !limiter.allow(token.Id) {
				return e.TooManyRequestsError("", nil)
			}
			if err := mcpauth.Touch(e.App, token); err != nil {
				e.App.Logger().Warn("mcp: recording the use of a token", "token", token.Id, "error", err)
			}
			// The request log gives the request to the account.
			e.Auth = user

			c := &caller{
				user:       user,
				token:      token,
				role:       roleOf(user),
				host:       e.Request.Host,
				remoteAddr: e.Request.RemoteAddr,
				forwarded:  trustedHeaders(e),
			}
			defer func() { e.Set(apis.RequestEventKeyLogMeta, c.logMeta()) }()

			if e.Request.Method == http.MethodPost {
				body, err := io.ReadAll(http.MaxBytesReader(e.Response, e.Request.Body, maxBodyBytes))
				var tooLarge *http.MaxBytesError
				switch {
				case errors.As(err, &tooLarge):
					return e.Error(http.StatusRequestEntityTooLarge, "", nil)
				case err != nil:
					return e.BadRequestError("", nil)
				case isBatch(body):
					return e.JSON(http.StatusBadRequest, batchRefusal)
				}
				e.Request.Body = io.NopCloser(bytes.NewReader(body))
			}
			handler.ServeHTTP(e.Response, e.Request.WithContext(withCaller(e.Request.Context(), c)))
			return nil
		}
		// GET and DELETE are declared too: the SDK answers them 405, where the
		// route of the app would answer index.html.
		for _, method := range []string{http.MethodGet, http.MethodPost, http.MethodDelete} {
			se.Router.Route(method, endpoint, serve)
		}
		return se.Next()
	})
}

// isBatch reports whether body is a JSON-RPC batch: an array, after the blanks
// that JSON allows. The SDK serves one when the version of the protocol is
// missing or older than 2025-06-18, which removed them: one request for the
// limit of the token, and as many tool calls as fit in the body, all at once.
// No client of today sends one.
func isBatch(body []byte) bool {
	rest := bytes.TrimLeft(body, " \t\r\n")
	return len(rest) > 0 && rest[0] == '['
}

// batchRefusal is the answer to a batch: the JSON-RPC error of an invalid
// request, which has no id to answer.
var batchRefusal = map[string]any{
	"jsonrpc": "2.0",
	"id":      nil,
	"error": map[string]any{
		"code":    -32600,
		"message": "batches are not supported: send one JSON-RPC message per request",
	},
}

// trustedHeaders are the headers of the request that the site reads the
// address of the client from (Settings.TrustedProxy.Headers): an inner request
// carries them, so that the limits and the log see the client.
func trustedHeaders(e *core.RequestEvent) http.Header {
	h := http.Header{}
	for _, name := range e.App.Settings().TrustedProxy.Headers {
		for _, value := range e.Request.Header.Values(name) {
			h.Add(name, value)
		}
	}
	return h
}

// role is the set of tools a token sees (spec § 6.3).
type role int

const (
	roleMember role = iota // the member tools
	roleAdmin              // the member tools and the admin tools
)

// String is the name of the role, as whoami gives it.
func (r role) String() string {
	if r == roleAdmin {
		return "admin"
	}
	return "member"
}

// roleOf reads the role on the account, at each request: "admin" and not
// disabled (accounts.IsActiveAdmin, the test of accounts.RequireAdmin), else
// member.
func roleOf(user *core.Record) role {
	if accounts.IsActiveAdmin(user) {
		return roleAdmin
	}
	return roleMember
}

// caller is who the tools act for, and where the request came from.
type caller struct {
	user, token      *core.Record
	role             role
	host, remoteAddr string
	// forwarded are the headers of Settings.TrustedProxy.Headers.
	forwarded http.Header

	mu sync.Mutex
	// calls are the tools called, for the request log: maxLoggedCalls at most,
	// and how many more.
	calls []toolCall
	more  int
}

// toolCall is a tool that a request called, as the request log names it.
type toolCall struct {
	Tool string `json:"tool"`
}

// The names of the tools in the request log. The name is what the assistant
// sent, before the SDK knows whether such a tool exists: the log keeps it only
// when it has the shape of the name of a tool, and a few of them, so that an
// assistant cannot fill the log with what it sends.
var toolName = regexp.MustCompile(`^[a-z_]{1,64}$`)

const (
	invalidToolName = "(invalid)"
	maxLoggedCalls  = 16
)

// called notes a call of the tool.
func (c *caller) called(tool string) {
	if !toolName.MatchString(tool) {
		tool = invalidToolName
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.calls) >= maxLoggedCalls {
		c.more++
		return
	}
	c.calls = append(c.calls, toolCall{Tool: tool})
}

// loggedCalls are the tools called, for the meta of the request log.
func (c *caller) loggedCalls() []toolCall {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.calls == nil {
		return []toolCall{}
	}
	return slices.Clone(c.calls)
}

// logMeta is the meta of the request log: the token, its account, and the
// tools called.
func (c *caller) logMeta() map[string]any {
	meta := map[string]any{
		"mcpToken": c.token.Id,
		"mcpUser":  c.user.Id,
		"mcpTools": c.loggedCalls(),
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.more > 0 {
		meta["mcpToolsMore"] = c.more
	}
	return meta
}

// callerKey is the key of the caller in the context of a request.
type callerKey struct{}

// errNoCaller is a call without a caller: a mistake of the code, since the
// route puts one in every request.
var errNoCaller = errors.New("mcp: no caller in the context")

// withCaller returns ctx with c, for the tools of the request.
func withCaller(ctx context.Context, c *caller) context.Context {
	return context.WithValue(ctx, callerKey{}, c)
}

// callerOf is the caller that the route put in ctx.
func callerOf(ctx context.Context) (*caller, error) {
	c, ok := ctx.Value(callerKey{}).(*caller)
	if !ok || c == nil {
		return nil, errNoCaller
	}
	return c, nil
}
