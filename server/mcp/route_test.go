package mcp_test

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/logger"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"

	"courses/server/invitations"
	"courses/server/mcp"
	"courses/server/mcpauth"
	"courses/server/testutil"
)

// The tools of each server. Each task that adds tools adds them here, and their
// row to wantHints.
var (
	// wantMemberTools are the tools that every token sees.
	wantMemberTools = []string{"whoami"}
	// wantAdminTools are the tools that only the token of an admin sees, besides
	// the member tools.
	wantAdminTools = []string{}
)

// hints are the annotations of a tool (spec § 6.1).
type hints struct {
	// readOnly for a read.
	readOnly bool
	// destructive for a tool that can answer done: false with a confirmation.
	destructive bool
	// idempotent for the tools that spec § 6.1 names.
	idempotent bool
}

// wantHints has a row for every tool.
var wantHints = map[string]hints{
	"whoami": {readOnly: true},
}

// realm is the challenge of a refused token.
const realm = `Bearer realm="prends-ton-dossard"`

func TestMCP_Unauthorized(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	good := newToken(t, app, fx.Alice)

	revoked := newToken(t, app, fx.Alice)
	revokedRecord, err := app.FindRecordById("mcp_tokens", strings.Split(revoked, "_")[1])
	if err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(revokedRecord); err != nil {
		t.Fatal(err)
	}

	// Disabling an account deletes its tokens: a token made while it is
	// disabled is the one that only the check of the account refuses.
	fx.Bob.Set("disabled", true)
	if err := app.Save(fx.Bob); err != nil {
		t.Fatal(err)
	}
	disabled := newToken(t, app, fx.Bob)

	for _, row := range []struct {
		name          string
		authorization string
	}{
		{"no header", ""},
		{"a token that is no token", "Bearer nope"},
		{"a session of the site", testutil.Token(t, fx.Alice)},
		{"a session of the site, as a bearer", bearer(testutil.Token(t, fx.Alice))},
		{"a good token without its scheme", good},
		{"a revoked token", bearer(revoked)},
		{"a token of a disabled account", bearer(disabled)},
	} {
		t.Run(row.name, func(t *testing.T) {
			header, body := rpc(t, app, row.authorization, http.StatusUnauthorized, "tools/list", nil)
			if got := header.Get("WWW-Authenticate"); got != realm {
				t.Errorf("WWW-Authenticate = %q, want %q", got, realm)
			}
			if !strings.Contains(body, `"code":"token_invalid"`) {
				t.Errorf("the answer is %.200s, want the code token_invalid", body)
			}
		})
	}

	t.Run("a good token", func(t *testing.T) {
		header, _ := rpc(t, app, bearer(good), http.StatusOK, "tools/list", nil)
		if got := header.Get("WWW-Authenticate"); got != "" {
			t.Errorf("WWW-Authenticate = %q on an accepted request", got)
		}
	})
}

// 300 requests a minute per token, whatever the address: two assistants of two
// people behind the same box do not share a limit.
func TestMCP_RateLimitPerToken(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	start := time.Date(2026, 6, 1, 10, 0, 0, 0, time.UTC)
	mcp.SetNow(t, start)

	alice := newToken(t, app, fx.Alice)
	aliceAgain := newToken(t, app, fx.Alice)
	bob := newToken(t, app, fx.Bob)

	// Every request of the test comes from one address: the rule of 1,500 a
	// minute per address is far away, and the 429 is the one of the token.
	for range 300 {
		rpc(t, app, bearer(alice), http.StatusOK, "ping", nil)
	}
	rpc(t, app, bearer(alice), http.StatusTooManyRequests, "ping", nil)
	rpc(t, app, bearer(aliceAgain), http.StatusOK, "ping", nil)
	rpc(t, app, bearer(bob), http.StatusOK, "ping", nil)

	// The bucket fills again by 5 a second.
	mcp.SetNow(t, start.Add(time.Second))
	for range 5 {
		rpc(t, app, bearer(alice), http.StatusOK, "ping", nil)
	}
	rpc(t, app, bearer(alice), http.StatusTooManyRequests, "ping", nil)
}

// The server opens no stream: GET and DELETE answer 405, once the token is
// checked.
func TestMCP_GetAndDeleteAre405(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := newToken(t, app, fx.Alice)

	for _, method := range []string{http.MethodGet, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			send(t, app, method, bearer(token), nil, "", http.StatusMethodNotAllowed)
			header, _ := send(t, app, method, "", nil, "", http.StatusUnauthorized)
			if got := header.Get("WWW-Authenticate"); got != realm {
				t.Errorf("without a token, WWW-Authenticate = %q, want %q", got, realm)
			}
		})
	}
}

func TestMCP_Initialize(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	member, admin := specInstructions(t)

	initialize := map[string]any{
		"protocolVersion": protocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": "test", "version": "0"},
	}
	for _, row := range []struct {
		name string
		user *core.Record
		want string
	}{
		{"a member", fx.Alice, member},
		{"an admin", fx.Admin, member + "\n" + admin},
	} {
		t.Run(row.name, func(t *testing.T) {
			header, body := rpc(t, app, bearer(newToken(t, app, row.user)), http.StatusOK, "initialize", initialize)
			if got := header.Get("Content-Type"); !strings.HasPrefix(got, "application/json") {
				t.Errorf("Content-Type = %q, want application/json", got)
			}

			var result struct {
				ProtocolVersion string `json:"protocolVersion"`
				ServerInfo      struct {
					Name string `json:"name"`
				} `json:"serverInfo"`
				Instructions string `json:"instructions"`
			}
			resultOf(t, body, &result)
			if result.ServerInfo.Name != "prends-ton-dossard" {
				t.Errorf("serverInfo.name = %q, want prends-ton-dossard", result.ServerInfo.Name)
			}
			if result.ProtocolVersion != protocolVersion {
				t.Errorf("protocolVersion = %q, want %q", result.ProtocolVersion, protocolVersion)
			}
			if !strings.HasPrefix(result.Instructions, "Prends ton dossard est le site privé") {
				t.Errorf("the instructions start with %.60q", result.Instructions)
			}
			if hasAdmin := strings.Contains(result.Instructions, "admin_"); hasAdmin != (row.user == fx.Admin) {
				t.Errorf("the instructions of %s name the admin tools: %v", row.name, hasAdmin)
			}
			if result.Instructions != row.want {
				t.Errorf("the instructions are not the text of spec § 6.2:\n got %q\nwant %q", result.Instructions, row.want)
			}
		})
	}
}

// specInstructions reads the instructions of the server in spec § 6.2: the
// lines quoted for every token, then the line of an admin.
func specInstructions(t *testing.T) (member, admin string) {
	t.Helper()
	_, here, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("cannot tell where this test file is")
	}
	spec, err := os.ReadFile(filepath.Join(filepath.Dir(here), "..", "..", "docs", "superpowers", "specs", "2026-11-03-courses-mcp-design.md"))
	if err != nil {
		t.Fatal(err)
	}
	_, section, ok := strings.Cut(string(spec), "### 6.2 Instructions du serveur")
	if !ok {
		t.Fatal("no § 6.2 in the spec")
	}
	section, _, _ = strings.Cut(section, "\n### ")

	// Two quotes: the one of every token, then the line of an admin.
	var quotes [][]string
	quoted := false
	for line := range strings.Lines(section) {
		line = strings.TrimRight(line, "\n")
		text, isQuote := strings.CutPrefix(line, "> ")
		if isQuote && !quoted {
			quotes = append(quotes, nil)
		}
		if isQuote {
			quotes[len(quotes)-1] = append(quotes[len(quotes)-1], text)
		}
		quoted = isQuote
	}
	if len(quotes) != 2 {
		t.Fatalf("§ 6.2 has %d quotes, want the instructions and the admin line", len(quotes))
	}
	return strings.Join(quotes[0], "\n"), strings.Join(quotes[1], "\n")
}

func TestMCP_ToolsList(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// A tool is in one list only, and the admin tools are named so.
	for _, name := range wantMemberTools {
		if strings.HasPrefix(name, "admin_") || slices.Contains(wantAdminTools, name) {
			t.Errorf("the member tool %s is named or listed as an admin tool", name)
		}
	}
	for _, name := range wantAdminTools {
		if !strings.HasPrefix(name, "admin_") {
			t.Errorf("the admin tool %s does not start with admin_", name)
		}
	}
	if len(wantHints) != len(wantMemberTools)+len(wantAdminTools) {
		t.Errorf("wantHints has %d rows for %d tools", len(wantHints), len(wantMemberTools)+len(wantAdminTools))
	}

	for _, row := range []struct {
		name string
		user *core.Record
		want []string
	}{
		{"a member", fx.Alice, wantMemberTools},
		{"an admin", fx.Admin, append(slices.Clone(wantMemberTools), wantAdminTools...)},
	} {
		t.Run(row.name, func(t *testing.T) {
			_, body := rpc(t, app, bearer(newToken(t, app, row.user)), http.StatusOK, "tools/list", nil)
			var result struct {
				Tools []struct {
					Name        string `json:"name"`
					Title       string `json:"title"`
					Description string `json:"description"`
					Annotations *struct {
						ReadOnlyHint    bool  `json:"readOnlyHint"`
						DestructiveHint *bool `json:"destructiveHint"`
						IdempotentHint  bool  `json:"idempotentHint"`
						OpenWorldHint   *bool `json:"openWorldHint"`
					} `json:"annotations"`
				} `json:"tools"`
			}
			resultOf(t, body, &result)

			var names []string
			for _, tool := range result.Tools {
				names = append(names, tool.Name)

				if tool.Title == "" || tool.Title == tool.Name {
					t.Errorf("%s: the title is %q, want a French one", tool.Name, tool.Title)
				}
				if len(tool.Description) < 20 {
					t.Errorf("%s: the description is %q, want a French one", tool.Name, tool.Description)
				}
				want, ok := wantHints[tool.Name]
				if !ok {
					t.Errorf("%s: no row in wantHints", tool.Name)
					continue
				}
				a := tool.Annotations
				if a == nil {
					t.Errorf("%s: no annotations", tool.Name)
					continue
				}
				if a.OpenWorldHint == nil || *a.OpenWorldHint {
					t.Errorf("%s: openWorldHint is not false", tool.Name)
				}
				if a.ReadOnlyHint != want.readOnly {
					t.Errorf("%s: readOnlyHint = %v, want %v", tool.Name, a.ReadOnlyHint, want.readOnly)
				}
				if a.IdempotentHint != want.idempotent {
					t.Errorf("%s: idempotentHint = %v, want %v", tool.Name, a.IdempotentHint, want.idempotent)
				}
				// A client takes an absent destructiveHint for true: a tool
				// that writes says it, either way. A read has none to say.
				switch {
				case want.readOnly && a.DestructiveHint != nil && *a.DestructiveHint:
					t.Errorf("%s: a read with destructiveHint", tool.Name)
				case !want.readOnly && (a.DestructiveHint == nil || *a.DestructiveHint != want.destructive):
					t.Errorf("%s: destructiveHint is %v, want %v", tool.Name, a.DestructiveHint, want.destructive)
				}
			}
			slices.Sort(names)
			if want := slices.Sorted(slices.Values(row.want)); !slices.Equal(names, want) {
				t.Errorf("the tools of %s are %v, want %v", row.name, names, want)
			}
		})
	}
}

// The role is the one of the account, read at each request: an active admin is
// an admin, anybody else a member.
func TestMCP_RoleOf(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	disabledAdmin := fx.Admin.Fresh()
	disabledAdmin.Set("disabled", true)

	for _, row := range []struct {
		name string
		user *core.Record
		want string
	}{
		{"a member", fx.Alice, "member"},
		{"an admin", fx.Admin, "admin"},
		{"a disabled admin", disabledAdmin, "member"},
	} {
		if got := mcp.RoleOf(row.user); got != row.want {
			t.Errorf("%s: role %q, want %q", row.name, got, row.want)
		}
	}
}

func TestMCP_Whoami(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	// 1:30 on the 14th in Paris, still the 13th in UTC.
	mcp.SetNow(t, time.Date(2026, 6, 13, 23, 30, 0, 0, time.UTC))

	t.Run("a member", func(t *testing.T) {
		token, record, err := createToken(app, fx.Alice)
		if err != nil {
			t.Fatal(err)
		}
		result := callTool(t, app, token, "whoami", nil)
		if result.IsError {
			t.Fatalf("whoami is the error %q", result.Text)
		}
		want := map[string]any{
			"runner": map[string]any{
				"id":   fx.AliceRunner.Id,
				"name": "Alice",
				"url":  "http://localhost:5173/coureurs/" + fx.AliceRunner.Id,
			},
			"role":  "member",
			"token": map[string]any{"id": record.Id, "name": "Claude sur mon PC"},
			"site":  "http://localhost:5173",
			"today": "2026-06-14",
		}
		assertJSON(t, result.Structured, want)

		// The text is the same object, for the clients that read only the text.
		var text map[string]any
		if err := json.Unmarshal([]byte(result.Text), &text); err != nil {
			t.Fatalf("the text is not the JSON of the answer: %v", err)
		}
		assertJSON(t, text, want)
	})

	t.Run("an admin", func(t *testing.T) {
		result := callTool(t, app, newToken(t, app, fx.Admin), "whoami", nil)
		if result.IsError || result.Structured["role"] != "admin" {
			t.Errorf("whoami of the admin: role %v (%q)", result.Structured["role"], result.Text)
		}
	})

	t.Run("an account without a runner", func(t *testing.T) {
		users, err := app.FindCollectionByNameOrId("users")
		if err != nil {
			t.Fatal(err)
		}
		lone := core.NewRecord(users)
		lone.Set("email", "lone@example.test")
		lone.Set("password", testutil.Password)
		lone.Set("role", "member")
		if err := app.Save(lone); err != nil {
			t.Fatal(err)
		}
		result := callTool(t, app, newToken(t, app, lone), "whoami", nil)
		const want = "Ton compte n'a pas de coureur : demande à un admin."
		if !result.IsError || result.Text != want {
			t.Errorf("whoami of an account without a runner: error %v, %q; want the error %q", result.IsError, result.Text, want)
		}
	})
}

// createToken makes a token for user, as newToken, and returns its record too.
func createToken(app core.App, user *core.Record) (string, *core.Record, error) {
	return mcpauth.Create(app, user.Id, "Claude sur mon PC")
}

// assertJSON compares a decoded JSON value with want, through their JSON.
func assertJSON(t *testing.T, got, want any) {
	t.Helper()
	g, err := json.Marshal(got)
	if err != nil {
		t.Fatal(err)
	}
	w, err := json.Marshal(want)
	if err != nil {
		t.Fatal(err)
	}
	if string(g) != string(w) {
		t.Errorf("got  %s\nwant %s", g, w)
	}
}

// last_used_at is written at most once a minute per token. The clock of mcpauth
// is out of reach of this package: the test puts the last use back in the
// database instead (the minute itself is TestMCPTokens_TouchAtMostOncePerMinute).
func TestMCP_LastUse(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token, record, err := createToken(app, fx.Alice)
	if err != nil {
		t.Fatal(err)
	}
	lastUse := func() time.Time {
		t.Helper()
		stored, err := app.FindRecordById("mcp_tokens", record.Id)
		if err != nil {
			t.Fatal(err)
		}
		return stored.GetDateTime("last_used_at").Time()
	}

	if !lastUse().IsZero() {
		t.Fatal("a new token has a last use")
	}
	rpc(t, app, bearer(token), http.StatusOK, "ping", nil)
	first := lastUse()
	if first.IsZero() {
		t.Fatal("the first request did not record the use")
	}

	rpc(t, app, bearer(token), http.StatusOK, "ping", nil)
	if got := lastUse(); !got.Equal(first) {
		t.Errorf("a second request within the minute moved the last use from %v to %v", first, got)
	}

	stored, err := app.FindRecordById("mcp_tokens", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	back := first.Add(-2 * time.Minute)
	stored.Set("last_used_at", back)
	if err := app.Save(stored); err != nil {
		t.Fatal(err)
	}
	rpc(t, app, bearer(token), http.StatusOK, "ping", nil)
	if got := lastUse(); !got.After(back.Add(time.Minute)) {
		t.Errorf("a request two minutes after the last use left it at %v", got)
	}

	// A refused request records nothing.
	stored.Set("last_used_at", back)
	if err := app.Save(stored); err != nil {
		t.Fatal(err)
	}
	flipped := "A"
	if strings.HasSuffix(token, "A") {
		flipped = "B"
	}
	wrong := token[:len(token)-1] + flipped
	rpc(t, app, bearer(wrong), http.StatusUnauthorized, "ping", nil)
	if got := lastUse(); !got.Equal(back) {
		t.Errorf("a refused token moved the last use to %v", got)
	}
}

// Neither the tokens, nor their secrets, nor their hashes, nor the session of
// the inner requests are in the request log, at the Debug level; the log says
// which token and which tools, and the inner requests are told apart.
func TestMCP_TokenIsNotLogged(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	// The test application turns the request log off: on, at the Debug level,
	// the requests below are logged as they would be in production, and more.
	app.Settings().Logs.MaxDays = 5
	app.Settings().Logs.MinLevel = int(slog.LevelDebug)
	handler, ok := app.Logger().Handler().(*logger.BatchHandler)
	if !ok {
		t.Fatalf("the logger is a %T, want PocketBase's batch handler", app.Logger().Handler())
	}
	handler.SetLevel(slog.LevelDebug) // what a reload of the settings does

	token, record, err := createToken(app, fx.Alice)
	if err != nil {
		t.Fatal(err)
	}
	malformed := "ptd_" + record.Id + "_too-short"
	wrongSecret := "ptd_" + record.Id + "_" + strings.Repeat("A", 43)

	// The session of the inner request, as the API receives it.
	var session string
	app.OnRecordsListRequest("runners").BindFunc(func(e *core.RecordsListRequestEvent) error {
		session = e.Request.Header.Get("Authorization")
		return e.Next()
	})

	_, body := rpc(t, app, bearer(token), http.StatusOK, "tools/call", map[string]any{"name": "whoami", "arguments": map[string]any{}})
	rpc(t, app, bearer(malformed), http.StatusUnauthorized, "ping", nil)
	rpc(t, app, bearer(wrongSecret), http.StatusUnauthorized, "ping", nil)
	if session == "" {
		t.Fatal("whoami made no inner request")
	}
	if strings.Contains(body, session) {
		t.Error("the answer of whoami holds the session of its inner request")
	}

	// Four requests: three to /mcp, and the inner one of whoami.
	logs := waitForRequests(t, app, 4)

	secrets := map[string]string{"the session of the inner request": session}
	for name, value := range map[string]string{"token": token, "malformed token": malformed, "token with a wrong secret": wrongSecret} {
		secret := value[strings.LastIndexByte(value, '_')+1:]
		secrets["the "+name] = value
		secrets["the secret of the "+name] = secret
		secrets["the hash of the secret of the "+name] = invitations.Hash(secret)
	}

	var (
		debug, inner bool
		meta         map[string]any
	)
	for _, entry := range logs {
		data, err := json.Marshal(entry.Data)
		if err != nil {
			t.Fatal(err)
		}
		text := entry.Message + " " + string(data)
		for name, secret := range secrets {
			if strings.Contains(text, secret) {
				// Not the entry, which holds it: what it is, and where.
				t.Errorf("the log holds %s (%s) in the entry %q", name, prefix(secret), entry.Message)
			}
		}
		if entry.Level == int(slog.LevelDebug) {
			debug = true
		}
		if strings.HasPrefix(entry.Message, "GET /api/collections/runners/records") && entry.Data["userAgent"] == "prends-ton-dossard-mcp" {
			inner = true
		}
		if entry.Message == "POST /mcp" && entry.Data["status"] == float64(http.StatusOK) {
			meta, _ = entry.Data["meta"].(map[string]any)
		}
	}
	// Without these, the checks above would pass on a log without the entries.
	if !debug {
		t.Error("no Debug entry in the log: the level is not Debug")
	}
	if !inner {
		t.Error("no inner request with the user agent prends-ton-dossard-mcp in the log")
	}
	if meta == nil {
		t.Fatal("no meta in the entry of the accepted POST /mcp")
	}
	if meta["mcpToken"] != record.Id || meta["mcpUser"] != fx.Alice.Id {
		t.Errorf("meta names the token %v and the account %v, want %s and %s", meta["mcpToken"], meta["mcpUser"], record.Id, fx.Alice.Id)
	}
	tools, _ := json.Marshal(meta["mcpTools"])
	if !strings.Contains(string(tools), `"whoami"`) {
		t.Errorf("meta.mcpTools = %s, want whoami named", tools)
	}
}

// waitForRequests returns the log once it has at least want entries of
// requests (or after a few seconds): they are written in the background.
func waitForRequests(t *testing.T, app *tests.TestApp, want int) []*core.Log {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for {
		logs := testutil.RequestLogs(t, app, 0)
		requests := 0
		for _, entry := range logs {
			if entry.Data["type"] == "request" {
				requests++
			}
		}
		if requests >= want {
			return logs
		}
		if time.Now().After(deadline) {
			t.Fatalf("%d requests in the log after 5 seconds, want %d", requests, want)
		}
		time.Sleep(20 * time.Millisecond)
	}
}

// The SDK runs each request in a goroutine of its own, where the recovery of
// PocketBase does not reach: a panic of a tool would stop the program, and the
// site with it. It is logged, and the call fails with the generic message.
func TestMCP_APanicDoesNotStopTheServer(t *testing.T) {
	app := testutil.NewApp(t)
	app.Settings().Logs.MaxDays = 5 // the logs are off in a test application

	result, err := mcp.RecoverPanics(app, "tools/call", func() { panic("a tool that fails") })
	call, ok := result.(*mcpsdk.CallToolResult)
	if err != nil || !ok || !call.IsError || len(call.Content) != 1 {
		t.Fatalf("a tool that panics answers %#v, %v; want a tool error", result, err)
	}
	if text, _ := call.Content[0].(*mcpsdk.TextContent); text == nil || text.Text != "Le site a rencontré une erreur. Réessaie dans un instant." {
		t.Errorf("a tool that panics says %#v", call.Content[0])
	}

	if _, err := mcp.RecoverPanics(app, "tools/list", func() { panic("a list that fails") }); err == nil {
		t.Error("a request that panics answers no error")
	}
	if result, err := mcp.RecoverPanics(app, "tools/call", func() {}); err != nil || result != nil {
		t.Errorf("a request that does not panic answers %v, %v; want what it answers", result, err)
	}

	// The servers have the middleware: a tool that panics, called through /mcp.
	fx := testutil.Seed(t, app)
	mcp.AddMemberTool(t, "panic", func() { panic("a tool that fails") })
	token := newToken(t, app, fx.Alice)
	if got := callTool(t, app, token, "panic", nil); !got.IsError || got.Text != "Le site a rencontré une erreur. Réessaie dans un instant." {
		t.Errorf("a tool that panics, through /mcp: %+v", got)
	}
	if got := callTool(t, app, token, "whoami", nil); got.IsError {
		t.Errorf("the next call is the error %q", got.Text)
	}

	panics := 0
	for _, entry := range testutil.RequestLogs(t, app, 3) {
		if entry.Message == "mcp: a request panicked" {
			panics++
		}
	}
	if panics != 3 {
		t.Errorf("%d panics in the log, want 3", panics)
	}
}

func TestMCP_AbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)
	// The hooks of the tokens stay on the demo: a token can be made there in
	// the database, and must open nothing.
	token := newToken(t, app, fx.Alice)

	for _, method := range []string{http.MethodPost, http.MethodGet, http.MethodDelete} {
		t.Run(method, func(t *testing.T) {
			body := ""
			if method == http.MethodPost {
				body = `{"jsonrpc":"2.0","id":1,"method":"ping"}`
			}
			send(t, app, method, bearer(token), nil, body, http.StatusNotFound)
		})
	}
}
