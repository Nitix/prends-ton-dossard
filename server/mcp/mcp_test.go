package mcp_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcpauth"
)

// endpoint is the path of the MCP server.
const endpoint = "/mcp"

// protocolVersion is the version of the protocol that the requests of the tests
// speak: the one of Claude Code.
const protocolVersion = "2025-06-18"

// newToken makes an MCP token for user, as the settings of the site do, and
// returns it. A test that prints it prints at most its first 8 characters.
func newToken(t testing.TB, app core.App, user *core.Record) string {
	t.Helper()
	token, _, err := mcpauth.Create(app, user.Id, "Claude sur mon PC")
	if err != nil {
		t.Fatalf("making a token: %v", err)
	}
	return token
}

// bearer is the Authorization header that carries token.
func bearer(token string) string {
	return "Bearer " + token
}

// send sends an HTTP request to the MCP server, with the Authorization header
// authorization (none when empty) and the headers of an MCP client, fails the
// test when the status is not the expected one, and returns the headers and the
// body of the answer.
func send(t *testing.T, app *tests.TestApp, method, authorization string, extra map[string]string, body string, status int) (http.Header, string) {
	t.Helper()

	headers := map[string]string{
		"Accept":       "application/json, text/event-stream",
		"Content-Type": "application/json",
	}
	if authorization != "" {
		headers["Authorization"] = authorization
	}
	maps.Copy(headers, extra)

	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	var (
		header http.Header
		text   string
	)
	(&tests.ApiScenario{
		Method:         method,
		URL:            endpoint,
		Body:           reader,
		Headers:        headers,
		ExpectedStatus: status,
		// A text that no answer can contain: the body is read below, and a
		// failed expectation on it would print it.
		NotExpectedContent:    []string{"\x00"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, _ *tests.TestApp, res *http.Response) {
			read, err := io.ReadAll(res.Body)
			if err != nil {
				t.Fatal(err)
			}
			header, text = res.Header, string(read)
		},
	}).Test(t)
	return header, text
}

// serveMux is the router of the app once its OnServe hooks ran, as the program
// serves it. tests.ApiScenario makes one for each request; this one serves
// several at once, as the program does.
func serveMux(t *testing.T, app *tests.TestApp) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	var mux http.Handler
	err = app.OnServe().Trigger(&core.ServeEvent{App: app, Router: router}, func(e *core.ServeEvent) error {
		built, err := e.Router.BuildMux()
		mux = built
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return mux
}

// postTo sends a JSON-RPC request, method with params, to the MCP server of mux,
// with token, as a client of the version of the protocol does, for a request whose
// context is ctx; and returns the answer.
func postTo(ctx context.Context, t testing.TB, mux http.Handler, token, method string, params any) *httptest.ResponseRecorder {
	t.Helper()
	message := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		message["params"] = params
	}
	body, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	request.Header.Set("Accept", "application/json, text/event-stream")
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("MCP-Protocol-Version", protocolVersion)
	request.Header.Set("Authorization", bearer(token))
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	return recorder
}

// rpc sends one JSON-RPC request, method with params (none when nil), as an
// MCP client does, and returns the headers and the body of the answer. A
// request that is not initialize carries the version of the protocol, as a
// client does once it is initialized.
func rpc(t *testing.T, app *tests.TestApp, authorization string, status int, method string, params any) (http.Header, string) {
	t.Helper()

	message := map[string]any{"jsonrpc": "2.0", "id": 1, "method": method}
	if params != nil {
		message["params"] = params
	}
	body, err := json.Marshal(message)
	if err != nil {
		t.Fatal(err)
	}
	extra := map[string]string{}
	if method != "initialize" {
		extra["MCP-Protocol-Version"] = protocolVersion
	}
	return send(t, app, http.MethodPost, authorization, extra, string(body), status)
}

// answer is a JSON-RPC answer: a result, or an error.
type answer struct {
	Result json.RawMessage `json:"result"`
	Error  *struct {
		Code    int    `json:"code"`
		Message string `json:"message"`
	} `json:"error"`
}

// resultOf decodes the result of a JSON-RPC answer into out, and fails the test
// when the answer is an error.
func resultOf(t testing.TB, body string, out any) {
	t.Helper()
	var a answer
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatalf("the answer is not JSON-RPC: %v (%.200s)", err, redact(body))
	}
	if a.Error != nil {
		t.Fatalf("the answer is the error %d %q", a.Error.Code, a.Error.Message)
	}
	if err := json.Unmarshal(a.Result, out); err != nil {
		t.Fatalf("reading the result: %v", err)
	}
}

// toolResult is what a tool answers: a result, or a tool error (IsError) whose
// text is the French message.
type toolResult struct {
	IsError bool
	// Text is the first text of the content: the JSON of Structured, or the
	// message of an error.
	Text       string
	Structured map[string]any
}

// callTool calls the tool name with args, with token, and returns its answer.
// The call itself must succeed: a tool error is an answer, a JSON-RPC error
// fails the test.
func callTool(t *testing.T, app *tests.TestApp, token, name string, args any) toolResult {
	t.Helper()
	if args == nil {
		args = map[string]any{}
	}
	_, body := rpc(t, app, bearer(token), http.StatusOK, "tools/call", map[string]any{"name": name, "arguments": args})

	var result struct {
		IsError bool `json:"isError"`
		Content []struct {
			Type string `json:"type"`
			Text string `json:"text"`
		} `json:"content"`
		StructuredContent map[string]any `json:"structuredContent"`
	}
	resultOf(t, body, &result)
	out := toolResult{IsError: result.IsError, Structured: result.StructuredContent}
	if len(result.Content) > 0 {
		out.Text = result.Content[0].Text
	}
	return out
}

// confirmAndCall calls a tool that asks for a confirmation: the first call must
// do nothing and answer one, and the second, with the same arguments and the
// confirmation, must be done. It returns the answer of the second call.
func confirmAndCall(t *testing.T, app *tests.TestApp, token, name string, args map[string]any) toolResult {
	t.Helper()

	first := callTool(t, app, token, name, args)
	if first.IsError {
		t.Fatalf("%s: the first call is the error %q", name, first.Text)
	}
	if done, _ := first.Structured["done"].(bool); done {
		t.Fatalf("%s: the first call was done, want a confirmation first", name)
	}
	confirmation, _ := first.Structured["confirmation"].(map[string]any)
	given, _ := confirmation["token"].(string)
	if given == "" {
		t.Fatalf("%s: the first call gave no confirmation", name)
	}

	again := maps.Clone(args)
	again["confirmation"] = given
	second := callTool(t, app, token, name, again)
	if second.IsError {
		t.Fatalf("%s: the confirmed call is the error %q", name, second.Text)
	}
	if done, _ := second.Structured["done"].(bool); !done {
		t.Fatalf("%s: the confirmed call was not done: %.300s", name, redact(second.Text))
	}
	return second
}

// tokenInText is an MCP token, a confirmation token or the secret of an upload
// slot in a text.
var tokenInText = regexp.MustCompile(`\b(ptd|cfm|ptu)_[A-Za-z0-9_-]+`)

// secretOfLink is the secret of a link in a text: the token of the feed of a
// calendar (/api/app/calendar/<token>.ics), or of an invitation (/invitation#<token>).
var secretOfLink = regexp.MustCompile(`(/api/app/calendar/|/invitation#)([A-Za-z0-9_-]+)`)

// redact cuts the tokens of a text, and the secrets of its links, to what a test
// may print of them.
func redact(text string) string {
	text = tokenInText.ReplaceAllStringFunc(text, prefix)
	return secretOfLink.ReplaceAllStringFunc(text, func(link string) string {
		m := secretOfLink.FindStringSubmatch(link)
		return m[1] + prefix(m[2])
	})
}

// What a test prints of a secret: at most its first 8 characters.
func TestRedact(t *testing.T) {
	for _, row := range []struct{ text, want string }{
		{"jeton ptd_abcdefghijk_secretsecret", "jeton ptd_abcd..."},
		{"cfm_ABCDEFGHIJKLMNOPQRSTUVWXYZ.", "cfm_ABCD...."},
		{"http://localhost:5173/api/app/calendar/0123456789abcdefghij.ics", "http://localhost:5173/api/app/calendar/01234567....ics"},
		{"http://localhost:5173/invitation#AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_xyz", "http://localhost:5173/invitation#AbCdEfGh..."},
		{"rien de secret", "rien de secret"},
	} {
		if got := redact(row.text); got != row.want {
			t.Errorf("redact(%q) = %q, want %q", row.text, got, row.want)
		}
	}
}

// prefix is what a test may print of a token: its first 8 characters.
func prefix(token string) string {
	if len(token) > 8 {
		return token[:8] + "..."
	}
	return token
}
