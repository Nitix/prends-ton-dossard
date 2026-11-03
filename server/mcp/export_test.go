package mcp

import (
	"context"
	"maps"
	"net/http"
	"slices"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// The tests of the package are external ones (testutil imports the setup of
// the application, which imports this package): this file gives them what they
// need.

// SetNow makes the package read that moment, instead of the real clock, until
// the test ends: "today", the limiter of the tokens.
func SetNow(t testing.TB, at time.Time) {
	t.Helper()
	previous := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = previous })
}

// RoleOf is the role that roleOf gives the account, by its name.
func RoleOf(user *core.Record) string { return roleOf(user).String() }

// The limiter of the tokens.
type TokenLimiter = tokenLimiter

func NewTokenLimiter(now func() time.Time) *TokenLimiter { return newTokenLimiter(now) }
func (l *tokenLimiter) Allow(tokenID string) bool        { return l.allow(tokenID) }

// Len is the number of buckets that the limiter keeps.
func (l *tokenLimiter) Len() int {
	l.mu.Lock()
	defer l.mu.Unlock()
	return len(l.buckets)
}

// The in-process API, and who it acts for.
type (
	InnerAPI = innerAPI
	APIError = apiError
	FormFile = formFile
	Caller   = caller
)

func NewInnerAPI(r *router.Router[*core.RequestEvent]) *InnerAPI { return &innerAPI{router: r} }

func (a *innerAPI) Do(ctx context.Context, method, path string, body any) (int, []byte, error) {
	return a.do(ctx, method, path, body)
}
func (a *innerAPI) Get(ctx context.Context, path string, out any) error { return a.get(ctx, path, out) }
func (a *innerAPI) Send(ctx context.Context, method, path string, body, out any) error {
	return a.send(ctx, method, path, body, out)
}
func (a *innerAPI) SendForm(ctx context.Context, method, path string, fields map[string]string, files []FormFile, out any) error {
	return a.sendForm(ctx, method, path, fields, files, out)
}

// NewCaller is a caller for user, with token (nil for none), from that host
// and address, with these headers of the trusted proxy.
func NewCaller(user, token *core.Record, host, remoteAddr string, forwarded http.Header) *Caller {
	return &caller{user: user, token: token, role: roleOf(user), host: host, remoteAddr: remoteAddr, forwarded: forwarded}
}

func WithCaller(ctx context.Context, c *Caller) context.Context { return withCaller(ctx, c) }

// InnerRequests counts the inner requests by method.
type InnerRequests struct {
	mu       sync.Mutex
	byMethod map[string]int
}

// CountInnerRequests counts the inner requests sent until the test ends: a
// call that must write nothing sends no POST, PATCH or DELETE.
func CountInnerRequests(t testing.TB) *InnerRequests {
	t.Helper()
	counted := &InnerRequests{byMethod: map[string]int{}}
	previous := onInnerRequest
	onInnerRequest = func(method string) {
		counted.mu.Lock()
		defer counted.mu.Unlock()
		counted.byMethod[method]++
	}
	t.Cleanup(func() { onInnerRequest = previous })
	return counted
}

// Of is the number of inner requests of that method.
func (c *InnerRequests) Of(method string) int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.byMethod[method]
}

// Total is the number of inner requests.
func (c *InnerRequests) Total() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	total := 0
	for _, n := range c.byMethod {
		total += n
	}
	return total
}

// The messages of the tools.
func Describe(app core.App, err error, subject func(request int) string) error {
	return describe(app, err, subject)
}

// Messages are the messages of the codes, by code.
func Messages() map[string]string { return maps.Clone(messages) }

// FieldMessages are the messages of the codes that a field says in its own
// words, by field and code.
func FieldMessages() map[string]map[string]string {
	out := map[string]map[string]string{}
	for field, byCode := range fieldMessages {
		out[field] = maps.Clone(byCode)
	}
	return out
}

// RecoverPanics runs handler as the handler of a request of that method,
// within the middleware that recovers a panic, and returns what it answers.
func RecoverPanics(app core.App, method string, handler func()) (mcpsdk.Result, error) {
	next := func(context.Context, string, mcpsdk.Request) (mcpsdk.Result, error) {
		handler()
		return nil, nil
	}
	return recoverPanics(app)(next)(context.Background(), method, nil)
}

// AddMemberTool adds to the member tools, until the test ends, a tool name that
// runs handler and answers an empty object.
func AddMemberTool(t testing.TB, name string, handler func()) {
	t.Helper()
	previous := memberTools
	memberTools = append(slices.Clone(memberTools), func(s *mcpsdk.Server, _ *tools) {
		mcpsdk.AddTool(s, &mcpsdk.Tool{Name: name}, func(context.Context, *mcpsdk.CallToolRequest, struct{}) (*mcpsdk.CallToolResult, struct{}, error) {
			handler()
			return nil, struct{}{}, nil
		})
	})
	t.Cleanup(func() { memberTools = previous })
}

// NoteCalls notes the calls of these tools in a caller, and returns the tools
// that its request log names, and how many more it was called.
func NoteCalls(names ...string) (logged []string, more int) {
	c := &caller{}
	for _, name := range names {
		c.called(name)
	}
	for _, call := range c.loggedCalls() {
		logged = append(logged, call.Tool)
	}
	return logged, c.more
}

// QuoteEscape is how a name is written in the Content-Disposition of a part.
func QuoteEscape(s string) string { return quoteEscaper.Replace(s) }

// InputSchema is inputSchema.
func InputSchema[T any](enums map[string][]string) *jsonschema.Schema { return inputSchema[T](enums) }
