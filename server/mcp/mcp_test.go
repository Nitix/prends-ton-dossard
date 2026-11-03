package mcp_test

import (
	"encoding/json"
	"io"
	"maps"
	"net/http"
	"regexp"
	"strings"
	"testing"

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

// redact cuts the tokens of a text to what a test may print of them.
func redact(text string) string {
	return tokenInText.ReplaceAllStringFunc(text, prefix)
}

// prefix is what a test may print of a token: its first 8 characters.
func prefix(token string) string {
	if len(token) > 8 {
		return token[:8] + "..."
	}
	return token
}
