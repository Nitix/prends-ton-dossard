package mcpauth_test

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/invitations"
	"courses/server/mcpauth"
	"courses/server/testutil"
)

// dateTime is how PocketBase writes a date-time: the form that the front reads.
var dateTime = regexp.MustCompile(`^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}Z$`)

const (
	tokensURL = "/api/app/mcp-tokens"
	// serverURL is the address of the MCP server of the test application: its
	// APP_URL (testutil.NewApp) and /mcp.
	serverURL = "http://localhost:5173/mcp"
)

func at(path string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return path }
}

func name(value string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return `{"name":` + quote(value) + `}` }
}

func quote(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return `"` + field + `":{"code":"` + code + `"`
}

// tokensOf returns the tokens that the database stores for the account.
func tokensOf(t testing.TB, app core.App, user *core.Record) []*core.Record {
	t.Helper()
	records, err := app.FindAllRecords("mcp_tokens", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	return records
}

// request calls the API as the user (anonymous when nil), fails the test when the
// status is not the expected one, and returns the headers and the body.
func request(t *testing.T, app *tests.TestApp, method, url string, user *core.Record, payload string, status int) (http.Header, string) {
	t.Helper()
	authorization := ""
	if user != nil {
		authorization = testutil.Token(t, user)
	}
	return requestWith(t, app, method, url, authorization, payload, status)
}

// requestWith is request with the value of the Authorization header, as it is
// sent: empty for none.
func requestWith(t *testing.T, app *tests.TestApp, method, url, authorization, payload string, status int) (http.Header, string) {
	t.Helper()

	headers := map[string]string{}
	if authorization != "" {
		headers["Authorization"] = authorization
	}
	var body io.Reader
	if payload != "" {
		body = strings.NewReader(payload)
	}
	var (
		header http.Header
		text   string
	)
	(&tests.ApiScenario{
		Method:         method,
		URL:            url,
		Body:           body,
		Headers:        headers,
		ExpectedStatus: status,
		// A text that no response can contain: the body is read below.
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

// object decodes the JSON object that is the body of an answer.
func object(t testing.TB, body string) map[string]any {
	t.Helper()
	var decoded map[string]any
	if err := json.Unmarshal([]byte(body), &decoded); err != nil {
		// Not the body: of a token's creation it holds the token.
		t.Fatalf("the response is not a JSON object: %v", err)
	}
	return decoded
}

// keysOf lists the keys of an object, sorted.
func keysOf(object map[string]any) []string {
	keys := make([]string, 0, len(object))
	for key := range object {
		keys = append(keys, key)
	}
	slices.Sort(keys)
	return keys
}

func TestMCPTokenRoutes(t *testing.T) {
	// The id of the token that the Before of a row made, for its URL.
	var aliceToken, bobToken string
	revokeAlices := func(testutil.Fixture) string { return tokensURL + "/" + aliceToken }
	revokeBobs := func(testutil.Fixture) string { return tokensURL + "/" + bobToken }

	makeTokens := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		_, alices := mustCreate(t, app, fx.Alice, "Claude sur mon PC")
		_, bobs := mustCreate(t, app, fx.Bob, "Claude de Bob")
		aliceToken, bobToken = alices.Id, bobs.Id
	}
	// Five tokens: the most that an account has.
	makeFive := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		for _, n := range []string{"Un", "Deux", "Trois", "Quatre", "Cinq"} {
			mustCreate(t, app, fx.Alice, n)
		}
	}
	stillThere := func(want int, who func(testutil.Fixture) *core.Record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			if got := len(tokensOf(t, app, who(fx))); got != want {
				t.Errorf("%d tokens stored, want %d", got, want)
			}
		}
	}
	alice := func(fx testutil.Fixture) *core.Record { return fx.Alice }
	bob := func(fx testutil.Fixture) *core.Record { return fx.Bob }

	testutil.RunRows(t, []testutil.Row{
		// Nobody that is not signed in to the site has a thing to do here.
		{
			Name: "anon cannot list", As: "anon", Method: http.MethodGet, URL: at(tokensURL),
			Before: makeTokens, Status: http.StatusUnauthorized, NotContains: []string{"Claude", "ptd_"},
		},
		{
			Name: "anon cannot create", As: "anon", Method: http.MethodPost, URL: at(tokensURL), Body: name("Claude"),
			Status: http.StatusUnauthorized, NotContains: []string{"ptd_"}, After: stillThere(0, alice),
		},
		{
			Name: "anon cannot revoke", As: "anon", Method: http.MethodDelete, URL: revokeAlices,
			Before: makeTokens, Status: http.StatusUnauthorized, After: stillThere(1, alice),
		},

		{
			Name: "alice has no token to begin with", As: "alice", Method: http.MethodGet, URL: at(tokensURL),
			Status: http.StatusOK, Contains: []string{`"tokens":[]`, `"url":"` + serverURL + `"`, `"max":5`},
		},
		{
			Name: "alice creates a token, which is shown", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name("Claude"),
			// What the answer says is checked by TestMCPTokenRoutes_Create, which does not print it.
			Status: http.StatusOK, Contains: []string{`"token":"ptd_`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				stored := tokensOf(t, app, fx.Alice)
				if len(stored) != 1 || stored[0].GetString("name") != "Claude" {
					t.Fatalf("%d tokens stored for Alice, want 1 named Claude", len(stored))
				}
				if got := len(tokensOf(t, app, fx.Bob)); got != 0 {
					t.Errorf("Bob has %d tokens, want none", got)
				}
			},
		},
		{
			Name: "then the list names it, and never shows it", As: "alice", Method: http.MethodGet, URL: at(tokensURL),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { mustCreate(t, app, fx.Alice, "Claude") },
			Status: http.StatusOK, Contains: []string{`"name":"Claude"`, `"lastUsedAt":""`},
			NotContains: []string{`"token"`, "ptd_", "token_hash"},
		},

		{
			Name: "a name is needed", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name(""),
			Status: http.StatusBadRequest, Contains: []string{fieldError("name", "validation_required")}, After: stillThere(0, alice),
		},
		{
			Name: "a name of spaces is not one", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name(" \t "),
			Status: http.StatusBadRequest, Contains: []string{fieldError("name", "validation_required")}, After: stillThere(0, alice),
		},
		{
			Name: "no body is no name", As: "alice", Method: http.MethodPost, URL: at(tokensURL),
			Status: http.StatusBadRequest, Contains: []string{fieldError("name", "validation_required")}, After: stillThere(0, alice),
		},
		{
			Name: "a name has 50 characters at most", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name(strings.Repeat("é", 51)),
			Status: http.StatusBadRequest, Contains: []string{fieldError("name", "validation_max_text_constraint")}, After: stillThere(0, alice),
		},
		{
			Name: "a sixth token is refused", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name("Six"),
			Before: makeFive, Status: http.StatusBadRequest, Contains: []string{`"code":"token_limit"`},
			NotContains: []string{"ptd_"}, After: stillThere(5, alice),
		},
		{
			Name: "the limit is Alice's own: Bob can still make one", As: "bob", Method: http.MethodPost, URL: at(tokensURL), Body: name("Claude"),
			Before: makeFive, Status: http.StatusOK, Contains: []string{`"token":"ptd_`}, After: stillThere(5, alice),
		},
		{
			Name: "a token that is revoked leaves room for another", As: "alice", Method: http.MethodPost, URL: at(tokensURL), Body: name("Six"),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				makeFive(t, app, fx)
				if err := app.Delete(tokensOf(t, app, fx.Alice)[0]); err != nil {
					t.Fatal(err)
				}
			},
			Status: http.StatusOK, Contains: []string{`"token":"ptd_`}, After: stillThere(5, alice),
		},

		{
			Name: "alice revokes hers", As: "alice", Method: http.MethodDelete, URL: revokeAlices,
			Before: makeTokens, Status: http.StatusNoContent,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				stillThere(0, alice)(t, app, fx)
				stillThere(1, bob)(t, app, fx)
			},
		},
		{
			Name: "alice cannot revoke Bob's: it is not there for her", As: "alice", Method: http.MethodDelete, URL: revokeBobs,
			Before: makeTokens, Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				stillThere(1, bob)(t, app, fx)
				stillThere(1, alice)(t, app, fx)
			},
		},
		{
			Name: "a token that is not there is not found", As: "alice", Method: http.MethodDelete, URL: at(tokensURL + "/abcdefghij12345"),
			Before: makeTokens, Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`}, After: stillThere(1, alice),
		},
		{
			Name: "an id that is not an id is not found either", As: "alice", Method: http.MethodDelete, URL: at(tokensURL + "/%25"),
			Before: makeTokens, Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`}, After: stillThere(1, alice),
		},
		{
			Name: "the list is the caller's: Bob does not see Alice's", As: "bob", Method: http.MethodGet, URL: at(tokensURL),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) { makeTokens(t, app, fx) },
			Status: http.StatusOK, Contains: []string{`"name":"Claude de Bob"`}, NotContains: []string{"Claude sur mon PC"},
		},

		{
			Name: "the table is not open through the collection API", As: "alice", Method: http.MethodGet, URL: at("/api/collections/mcp_tokens/records"),
			Before: makeTokens, Status: http.StatusForbidden, NotContains: []string{"token_hash", "Claude"},
		},
	})
}

// A token that is revoked stops working at once: the next request of the
// assistant that holds it is refused.
func TestMCPTokenRoutes_RevokingStopsTheToken(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token, record := mustCreate(t, app, fx.Alice, "Claude")
	if _, _, err := mcpauth.Authenticate(app, "Bearer "+token); err != nil {
		t.Fatalf("the token %s… is refused before it is revoked: %v", first8(token), err)
	}

	request(t, app, http.MethodDelete, tokensURL+"/"+record.Id, fx.Alice, "", http.StatusNoContent)

	if _, _, err := mcpauth.Authenticate(app, "Bearer "+token); !errors.Is(err, mcpauth.ErrInvalid) {
		t.Errorf("the token %s… that was revoked gives %v, want ErrInvalid", first8(token), err)
	}
	// A second revocation is the one of a token that is not there.
	request(t, app, http.MethodDelete, tokensURL+"/"+record.Id, fx.Alice, "", http.StatusNotFound)
}

// A token of the assistant is not a session of the site: it opens none of these
// routes, so a token cannot make another one, whose secret would go through the
// assistant, nor revoke the others.
func TestMCPTokenRoutes_ATokenOfTheAssistantIsNotASession(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token, record := mustCreate(t, app, fx.Alice, "Claude")

	for _, authorization := range []string{token, "Bearer " + token} {
		for _, tc := range []struct{ method, url, body string }{
			{http.MethodGet, tokensURL, ""},
			{http.MethodPost, tokensURL, `{"name":"Un autre"}`},
			{http.MethodDelete, tokensURL + "/" + record.Id, ""},
		} {
			_, body := requestWith(t, app, tc.method, tc.url, authorization, tc.body, http.StatusUnauthorized)
			if strings.Contains(body, "ptd_") {
				t.Errorf("the refusal of %s %s holds a token", tc.method, tc.url)
			}
		}
	}
	if got := len(tokensOf(t, app, fx.Alice)); got != 1 {
		t.Errorf("Alice has %d tokens, want the one that was there", got)
	}
}

// The list says what a person needs to tell the tokens apart: the name, the day
// of creation and the last use, newest first. A token that was never used has an
// empty last use, not a date of the year one.
func TestMCPTokenRoutes_List(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// Made in this order, but created on other days: the list goes by creation.
	created := map[string]string{
		"Le plus ancien":  "2026-11-01 08:00:00.000Z",
		"Le plus récent":  "2026-11-03 09:30:00.000Z",
		"Celui du milieu": "2026-11-02 12:00:00.000Z",
	}
	ids := map[string]string{}
	for _, n := range []string{"Le plus ancien", "Le plus récent", "Celui du milieu"} {
		_, record := mustCreate(t, app, fx.Alice, n)
		_, err := app.DB().NewQuery("UPDATE mcp_tokens SET created = {:created} WHERE id = {:id}").
			Bind(dbx.Params{"created": created[n], "id": record.Id}).Execute()
		if err != nil {
			t.Fatal(err)
		}
		ids[n] = record.Id
	}
	mustCreate(t, app, fx.Bob, "Celui de Bob")

	// The one in the middle was used, on the 3rd at 13:05 UTC.
	mcpauth.SetNow(t, time.Date(2026, time.November, 3, 13, 5, 0, 0, time.UTC))
	used, err := app.FindRecordById("mcp_tokens", ids["Celui du milieu"])
	if err != nil {
		t.Fatal(err)
	}
	if err := mcpauth.Touch(app, used); err != nil {
		t.Fatal(err)
	}

	_, body := request(t, app, http.MethodGet, tokensURL, fx.Alice, "", http.StatusOK)

	answer := object(t, body)
	if got, want := keysOf(answer), []string{"max", "tokens", "url"}; !slices.Equal(got, want) {
		t.Errorf("the answer has the keys %v, want %v", got, want)
	}
	if answer["url"] != serverURL || answer["max"] != float64(mcpauth.MaxPerAccount) {
		t.Errorf("url, max = %v, %v, want %s, %d", answer["url"], answer["max"], serverURL, mcpauth.MaxPerAccount)
	}
	list, _ := answer["tokens"].([]any)
	type row struct{ id, name, created, lastUsedAt string }
	var got []row
	for _, item := range list {
		token, _ := item.(map[string]any)
		if keys, want := keysOf(token), []string{"created", "id", "lastUsedAt", "name"}; !slices.Equal(keys, want) {
			t.Errorf("a token has the keys %v, want %v", keys, want)
		}
		id, _ := token["id"].(string)
		n, _ := token["name"].(string)
		c, _ := token["created"].(string)
		l, _ := token["lastUsedAt"].(string)
		got = append(got, row{id, n, c, l})
	}
	want := []row{
		{ids["Le plus récent"], "Le plus récent", "2026-11-03 09:30:00.000Z", ""},
		{ids["Celui du milieu"], "Celui du milieu", "2026-11-02 12:00:00.000Z", "2026-11-03 13:05:00.000Z"},
		{ids["Le plus ancien"], "Le plus ancien", "2026-11-01 08:00:00.000Z", ""},
	}
	if !slices.Equal(got, want) {
		t.Errorf("the list is\n  %v\nwant, newest first\n  %v", got, want)
	}
}

// The token is in the answer that creates it, and in no other: it is shown once.
func TestMCPTokenRoutes_Create(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	header, body := request(t, app, http.MethodPost, tokensURL, fx.Alice, `{"name":"  Claude sur mon PC  "}`, http.StatusOK)

	answer := object(t, body)
	if got, want := keysOf(answer), []string{"created", "id", "name", "token", "url"}; !slices.Equal(got, want) {
		t.Errorf("the answer has the keys %v, want %v", got, want)
	}
	token, _ := answer["token"].(string)
	m := shape.FindStringSubmatch(token)
	if m == nil {
		t.Fatalf("the token %s… does not have the shape of a token", first8(token))
	}
	if answer["id"] != m[1] {
		t.Errorf("id = %v, want the id that the token names, %s", answer["id"], m[1])
	}
	if answer["name"] != "Claude sur mon PC" || answer["url"] != serverURL {
		t.Errorf("name, url = %v, %v, want the trimmed name and %s", answer["name"], answer["url"], serverURL)
	}
	if created, _ := answer["created"].(string); !dateTime.MatchString(created) {
		t.Errorf("created = %q, want a date-time as PocketBase writes it", created)
	}
	// A secret in an answer is not kept by a cache.
	if got := header.Get("Cache-Control"); got != "no-store" {
		t.Errorf("Cache-Control = %q, want no-store", got)
	}

	// The token works, for Alice, and is the one of the record that is stored.
	user, record, err := mcpauth.Authenticate(app, "Bearer "+token)
	if err != nil {
		t.Fatalf("the token %s… that was made is refused: %v", first8(token), err)
	}
	if user.Id != fx.Alice.Id || record.Id != m[1] {
		t.Errorf("the token is Alice's %s: it is %s and %s", record.Id, user.Id, record.Id)
	}

	// And now it is only a name and two dates.
	_, list := request(t, app, http.MethodGet, tokensURL, fx.Alice, "", http.StatusOK)
	if !strings.Contains(list, `"id":"`+m[1]+`"`) || strings.Contains(list, m[2]) || strings.Contains(list, "ptd_") {
		t.Errorf("the list holds the id of the token and no part of its secret, and it is %d characters long", len(list))
	}
}

// No answer of the site but the one that makes a token holds it: not the list,
// for the caller, nor for anybody, and no part of the secret or of its hash.
func TestMCPTokenRoutes_ListNeverShowsTheSecret(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	type secret struct{ what, text string }
	var secrets []secret
	note := func(whose string, token string, record *core.Record) {
		m := shape.FindStringSubmatch(token)
		if m == nil {
			t.Fatalf("%s: the token %s… does not have the shape of a token", whose, first8(token))
		}
		hash := record.GetString("token_hash")
		if hash != invitations.Hash(m[2]) {
			t.Fatalf("%s: the hash that is stored is not the one of the secret", whose)
		}
		secrets = append(secrets,
			secret{whose + " token", token},
			secret{whose + " secret", m[2]},
			secret{whose + " hash", hash},
		)
	}
	token, record := mustCreate(t, app, fx.Alice, "Premier")
	note("Alice's first", token, record)
	token, record = mustCreate(t, app, fx.Alice, "Second")
	note("Alice's second", token, record)
	token, record = mustCreate(t, app, fx.Bob, "De Bob")
	note("Bob's", token, record)

	// One more, made by the route: the answer that shows it is not the list.
	_, made := request(t, app, http.MethodPost, tokensURL, fx.Alice, `{"name":"Troisième"}`, http.StatusOK)
	madeToken, _ := object(t, made)["token"].(string)
	m := shape.FindStringSubmatch(madeToken)
	if m == nil {
		t.Fatalf("the token %s… that was made does not have the shape of a token", first8(madeToken))
	}
	secrets = append(secrets, secret{"the new token", madeToken}, secret{"the new secret", m[2]}, secret{"the new hash", invitations.Hash(m[2])})

	for _, who := range []*core.Record{fx.Alice, fx.Bob} {
		_, list := request(t, app, http.MethodGet, tokensURL, who, "", http.StatusOK)
		for _, s := range secrets {
			if strings.Contains(list, s.text) {
				t.Errorf("the list of %s holds %s", who.Id, s.what)
			}
		}
		for _, text := range []string{`"token"`, "token_hash", "ptd_"} {
			if strings.Contains(list, text) {
				t.Errorf("the list of %s holds %s", who.Id, text)
			}
		}
	}

	// The table is closed to the API: not the list, not a record.
	for _, url := range []string{"/api/collections/mcp_tokens/records", "/api/collections/mcp_tokens/records/" + record.Id} {
		_, body := request(t, app, http.MethodGet, url, fx.Alice, "", http.StatusForbidden)
		if strings.Contains(body, "token_hash") {
			t.Errorf("%s names token_hash", url)
		}
	}
}

// The demo has no tokens: its account is shared by everybody, and a token would
// give a lasting access to it. The routes are not there, and PocketBase says it
// is not found, as it does for any route that does not exist. The hooks of the
// table are (they cost nothing), so the limit is still held.
func TestMCPTokenRoutes_AbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)
	_, existing := mustCreate(t, app, fx.Alice, "Claude")

	for _, tc := range []struct {
		method, url, body string
	}{
		{http.MethodGet, tokensURL, ""},
		{http.MethodPost, tokensURL, `{"name":"Claude"}`},
		{http.MethodDelete, tokensURL + "/" + existing.Id, ""},
	} {
		t.Run(tc.method, func(t *testing.T) {
			_, body := request(t, app, tc.method, tc.url, fx.Alice, tc.body, http.StatusNotFound)
			if strings.Contains(body, "ptd_") || strings.Contains(body, existing.Id) {
				t.Errorf("the answer of %s %s says something of the token", tc.method, tc.url)
			}
		})
	}
	if got := len(tokensOf(t, app, fx.Alice)); got != 1 {
		t.Errorf("Alice has %d tokens, want the one that was there", got)
	}

	for _, n := range []string{"Deux", "Trois", "Quatre", "Cinq"} {
		mustCreate(t, app, fx.Alice, n)
	}
	if _, _, err := mcpauth.Create(app, fx.Alice.Id, "Six"); err == nil {
		t.Error("a sixth token is made on the demo, want the limit held there too")
	}
}
