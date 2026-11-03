package mcpauth_test

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
	"courses/server/mcpauth"
	"courses/server/testutil"
)

// shape is the form of a token: the prefix, the id of its record (15 characters
// of a PocketBase id), and the secret (32 random bytes in base64url, unpadded).
var shape = regexp.MustCompile(`^ptd_([a-z0-9]{15})_([A-Za-z0-9_-]{43})$`)

// mustCreate makes a token for the account, and fails the test on an error.
func mustCreate(t testing.TB, app core.App, user *core.Record, name string) (string, *core.Record) {
	t.Helper()
	token, record, err := mcpauth.Create(app, user.Id, name)
	if err != nil {
		t.Fatalf("creating the token %q of %s: %v", name, user.Email(), err)
	}
	return token, record
}

// validationCode returns the code of the validation error of field in err, or
// "" when err is not a validation error on that field.
func validationCode(err error, field string) string {
	var invalid validation.Errors
	if !errors.As(err, &invalid) {
		return ""
	}
	fieldErr, ok := invalid[field].(validation.Error)
	if !ok {
		return ""
	}
	return fieldErr.Code()
}

// idOf and collectionOf are what a test message says of a record: never the
// record itself, whose printout holds its fields (the hash of a token; the
// email, the password hash and the token key of an account).
func idOf(record *core.Record) string {
	if record == nil {
		return "no record"
	}
	return record.Id
}

func collectionOf(record *core.Record) string {
	if record == nil {
		return "no collection"
	}
	return record.Collection().Name
}

// first8 is all that a test may print of a token.
func first8(token string) string {
	if len(token) > 8 {
		return token[:8]
	}
	return token
}

func TestMCPTokens_CreateGivesTheSecretOnce(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	token, record := mustCreate(t, app, fx.Alice, "Claude")

	m := shape.FindStringSubmatch(token)
	if m == nil {
		t.Fatalf("the token %q... does not have the shape ptd_<id>_<secret>", first8(token))
	}
	id, secret := m[1], m[2]
	if !strings.HasPrefix(token, mcpauth.Prefix) {
		t.Errorf("the token %q... does not start with %q", first8(token), mcpauth.Prefix)
	}
	if id != record.Id {
		t.Errorf("the id in the token is %q, the record is %q: the token must name its record", id, record.Id)
	}

	sum := sha256.Sum256([]byte(secret))
	wantHash := hex.EncodeToString(sum[:])
	if got := record.GetString("token_hash"); got != wantHash {
		t.Errorf("the token_hash of the returned record is not the SHA-256 of the secret")
	}
	if record.GetString("user") != fx.Alice.Id || record.GetString("name") != "Claude" {
		t.Errorf("the record is for user %q named %q, want Alice and Claude", record.GetString("user"), record.GetString("name"))
	}
	if !record.GetDateTime("last_used_at").IsZero() {
		t.Errorf("a new token has last_used_at %v, want it empty", record.GetDateTime("last_used_at"))
	}

	// What is stored is the record that Create returned, and no field of it,
	// whatever the way it is read, holds the token or the secret.
	stored, err := app.FindRecordById("mcp_tokens", record.Id)
	if err != nil {
		t.Fatal(err)
	}
	if got := stored.GetString("token_hash"); got != wantHash {
		t.Errorf("the token_hash of the stored record is not the SHA-256 of the secret")
	}
	for _, r := range map[string]*core.Record{"returned": record, "stored": stored} {
		fields, err := json.Marshal(r.FieldsData())
		if err != nil {
			t.Fatal(err)
		}
		public, err := json.Marshal(r)
		if err != nil {
			t.Fatal(err)
		}
		for what, text := range map[string]string{"fields": string(fields), "JSON": string(public)} {
			if strings.Contains(text, token) || strings.Contains(text, secret) {
				t.Errorf("the %s of the record hold the token or its secret", what)
			}
		}
		if strings.Contains(string(public), "token_hash") {
			t.Error("the JSON of the record shows the hash: the field must be hidden")
		}
	}

	// Another token of the same account is another id and another secret.
	other, _ := mustCreate(t, app, fx.Alice, "Claude")
	m2 := shape.FindStringSubmatch(other)
	if m2 == nil || m2[1] == id || m2[2] == secret {
		t.Error("a second token must have its own id and its own secret")
	}
}

func TestMCPTokens_Authenticate(t *testing.T) {
	type given struct {
		alice, bob      string // the tokens
		aliceID, bobID  string // the ids of their records
		aliceSession    string // a session token of the site
		unknownIDToken  string // a good shape, an id that no record has
		wrongSecretOfID string // the id of Alice's token, another secret
	}
	rows := []struct {
		name string
		// before changes the database before the tokens are made.
		before func(testing.TB, core.App, testutil.Fixture)
		header func(given) string
		// wantUser is "alice" or "bob", or "" for a refusal.
		wantUser string
	}{
		{name: "a good token", header: func(w given) string { return "Bearer " + w.alice }, wantUser: "alice"},
		{name: "the scheme in lower case", header: func(w given) string { return "bearer " + w.alice }, wantUser: "alice"},
		{name: "the scheme in upper case", header: func(w given) string { return "BEARER " + w.alice }, wantUser: "alice"},
		{name: "the token of another account", header: func(w given) string { return "Bearer " + w.bob }, wantUser: "bob"},

		{name: "no header", header: func(given) string { return "" }},
		{name: "another scheme", header: func(w given) string { return "Basic " + w.alice }},
		{name: "no scheme", header: func(w given) string { return w.alice }},
		{name: "the scheme alone", header: func(given) string { return "Bearer" }},
		{name: "the scheme and a space", header: func(given) string { return "Bearer " }},
		{name: "two spaces after the scheme", header: func(w given) string { return "Bearer  " + w.alice }},
		{name: "a space after the token", header: func(w given) string { return "Bearer " + w.alice + " " }},
		{name: "a line break after the token", header: func(w given) string { return "Bearer " + w.alice + "\n" }},
		{name: "no ptd_ prefix", header: func(w given) string { return "Bearer " + strings.TrimPrefix(w.alice, mcpauth.Prefix) }},
		{name: "another prefix", header: func(w given) string { return "Bearer xyz_" + strings.TrimPrefix(w.alice, mcpauth.Prefix) }},
		{name: "a token one character short", header: func(w given) string { return "Bearer " + w.alice[:len(w.alice)-1] }},
		{name: "a token one character long", header: func(w given) string { return "Bearer " + w.alice + "A" }},
		{name: "a character that is not base64url", header: func(w given) string { return "Bearer " + w.alice[:len(w.alice)-1] + "+" }},
		{name: "an id in upper case", header: func(w given) string {
			return "Bearer " + mcpauth.Prefix + strings.ToUpper(w.aliceID) + w.alice[len(mcpauth.Prefix)+len(w.aliceID):]
		}},
		{name: "an unknown id", header: func(w given) string { return "Bearer " + w.unknownIDToken }},
		{name: "the right id with a wrong secret", header: func(w given) string { return "Bearer " + w.wrongSecretOfID }},
		{name: "the id of Alice with the secret of Bob", header: func(w given) string {
			return "Bearer " + mcpauth.Prefix + w.aliceID + w.bob[len(mcpauth.Prefix)+len(w.bobID):]
		}},
		{name: "a session token of the site", header: func(w given) string { return "Bearer " + w.aliceSession }},
		{
			name: "an account that is disabled",
			// Disabled before the token exists: disabling it afterwards would
			// delete the token (hooks_test.go), and the refusal would be the
			// one of an unknown id.
			before: func(t testing.TB, app core.App, fx testutil.Fixture) {
				fx.Alice.Set("disabled", true)
				if err := app.Save(fx.Alice); err != nil {
					t.Fatal(err)
				}
			},
			header: func(w given) string { return "Bearer " + w.alice },
		},
	}

	for _, row := range rows {
		t.Run(row.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			if row.before != nil {
				row.before(t, app, fx)
			}

			w := given{aliceSession: testutil.Token(t, fx.Alice)}
			var aliceRecord, bobRecord *core.Record
			w.alice, aliceRecord = mustCreate(t, app, fx.Alice, "Claude")
			w.bob, bobRecord = mustCreate(t, app, fx.Bob, "ChatGPT")
			w.aliceID, w.bobID = aliceRecord.Id, bobRecord.Id

			// A token of the right shape for an id that does not exist, and one
			// for the id of Alice's token with another secret.
			bobSecret := shape.FindStringSubmatch(w.bob)[2]
			w.unknownIDToken = mcpauth.Prefix + "aaaaaaaaaaaaaaa_" + bobSecret
			if _, err := app.FindRecordById("mcp_tokens", "aaaaaaaaaaaaaaa"); err == nil {
				t.Fatal("the test needs an id that no record has")
			}
			w.wrongSecretOfID = mcpauth.Prefix + w.aliceID + "_" + bobSecret

			user, token, err := mcpauth.Authenticate(app, row.header(w))

			if row.wantUser == "" {
				if !errors.Is(err, mcpauth.ErrInvalid) {
					t.Errorf("error = %v, want ErrInvalid", err)
				}
				if user != nil || token != nil {
					t.Error("a refused header must give neither an account nor a token")
				}
				return
			}
			if err != nil {
				t.Fatalf("a good header is refused: %v", err)
			}
			wantUser, wantToken := fx.Alice, aliceRecord
			if row.wantUser == "bob" {
				wantUser, wantToken = fx.Bob, bobRecord
			}
			if user == nil || user.Id != wantUser.Id || user.Collection().Name != "users" {
				t.Errorf("the account is %s (%s), want %s (%s)", idOf(user), collectionOf(user), row.wantUser, wantUser.Id)
			}
			if token == nil || token.Id != wantToken.Id || token.Collection().Name != "mcp_tokens" {
				t.Errorf("the token is the record %s (%s), want %s", idOf(token), collectionOf(token), wantToken.Id)
			}
			// Checking a token records nothing: that is Touch.
			stored, err := app.FindRecordById("mcp_tokens", wantToken.Id)
			if err != nil {
				t.Fatal(err)
			}
			if !stored.GetDateTime("last_used_at").IsZero() {
				t.Errorf("Authenticate must not write, but last_used_at is %v", stored.GetDateTime("last_used_at"))
			}
		})
	}
}

func TestMCPTokens_Name(t *testing.T) {
	t.Run("spaces around the name are removed", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		_, record := mustCreate(t, app, fx.Alice, "  Claude sur mon PC  ")
		if got := record.GetString("name"); got != "Claude sur mon PC" {
			t.Errorf("name = %q, want %q", got, "Claude sur mon PC")
		}
		stored, err := app.FindRecordById("mcp_tokens", record.Id)
		if err != nil {
			t.Fatal(err)
		}
		if got := stored.GetString("name"); got != "Claude sur mon PC" {
			t.Errorf("the stored name = %q, want %q", got, "Claude sur mon PC")
		}
	})

	for _, c := range []struct {
		name string
		text string
		code string // "" when accepted
	}{
		{name: "empty", text: "", code: "validation_required"},
		{name: "only spaces", text: "   ", code: "validation_required"},
		{name: "only tabs and line breaks", text: "\t\n ", code: "validation_required"},
		{name: "one character", text: "C"},
		{name: "50 characters", text: strings.Repeat("é", 50)},
		{name: "50 characters between spaces", text: "  " + strings.Repeat("é", 50) + "  "},
		{name: "51 characters", text: strings.Repeat("é", 51), code: "validation_max_text_constraint"},
	} {
		t.Run(c.name, func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			_, _, err := mcpauth.Create(app, fx.Alice.Id, c.text)
			if c.code == "" {
				if err != nil {
					t.Errorf("a token named %q is refused: %v", c.text, err)
				}
				return
			}
			if err == nil {
				t.Fatalf("a token named %q must be refused", c.text)
			}
			if got := validationCode(err, "name"); got != c.code {
				t.Errorf("error = %v; code on name %q, want %q", err, got, c.code)
			}
			if n, _ := app.CountRecords("mcp_tokens"); n != 0 {
				t.Errorf("%d tokens after a refused creation, want none", n)
			}
		})
	}
}

func TestMCPTokens_LimitOfFive(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	if mcpauth.MaxPerAccount != 5 {
		t.Fatalf("MaxPerAccount = %d, want 5", mcpauth.MaxPerAccount)
	}
	var records []*core.Record
	for i := range mcpauth.MaxPerAccount {
		_, record := mustCreate(t, app, fx.Alice, "Machine "+string(rune('A'+i)))
		records = append(records, record)
	}

	_, record, err := mcpauth.Create(app, fx.Alice.Id, "Une de trop")
	var apiErr *router.ApiError
	if !errors.As(err, &apiErr) {
		t.Fatalf("the sixth token: error %v, want an API error", err)
	}
	if apiErr.Status != http.StatusBadRequest || apiErr.Data["code"] != apperr.CodeTokenLimit {
		t.Errorf("the sixth token: status %d, data %v; want 400 and the code %s", apiErr.Status, apiErr.Data, apperr.CodeTokenLimit)
	}
	if record != nil {
		t.Error("a refused token must give no record")
	}
	if n, _ := app.CountRecords("mcp_tokens"); n != 5 {
		t.Errorf("%d tokens, want the 5 that were made", n)
	}

	// The limit is the one of an account.
	if _, _, err := mcpauth.Create(app, fx.Bob.Id, "Claude"); err != nil {
		t.Errorf("Bob is refused his first token: %v", err)
	}
	// And it counts the tokens that exist: a revoked one leaves room.
	if err := app.Delete(records[0]); err != nil {
		t.Fatal(err)
	}
	if _, _, err := mcpauth.Create(app, fx.Alice.Id, "Une de plus"); err != nil {
		t.Errorf("Alice is refused a token after revoking one: %v", err)
	}
	if _, _, err := mcpauth.Create(app, fx.Alice.Id, "Encore une"); err == nil {
		t.Error("Alice has made six tokens")
	}
}

func TestMCPTokens_TouchAtMostOncePerMinute(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token, record := mustCreate(t, app, fx.Alice, "Claude")

	lastUsed := func() time.Time {
		t.Helper()
		stored, err := app.FindRecordById("mcp_tokens", record.Id)
		if err != nil {
			t.Fatal(err)
		}
		return stored.GetDateTime("last_used_at").Time()
	}
	// use is a request: the token is checked, then the use is recorded.
	use := func(at time.Time) {
		t.Helper()
		mcpauth.SetNow(t, at)
		_, tok, err := mcpauth.Authenticate(app, "Bearer "+token)
		if err != nil {
			t.Fatal(err)
		}
		if err := mcpauth.Touch(app, tok); err != nil {
			t.Fatalf("Touch: %v", err)
		}
	}

	if got := lastUsed(); !got.IsZero() {
		t.Fatalf("a new token was used at %v", got)
	}

	start := time.Date(2026, time.November, 3, 10, 0, 0, 0, time.UTC)
	use(start)
	if got := lastUsed(); !got.Equal(start) {
		t.Errorf("after the first use: %v, want %v", got, start)
	}

	use(start.Add(30 * time.Second))
	if got := lastUsed(); !got.Equal(start) {
		t.Errorf("30 s later: %v, want it unchanged, %v", got, start)
	}

	later := start.Add(61 * time.Second)
	use(later)
	if got := lastUsed(); !got.Equal(later) {
		t.Errorf("61 s later: %v, want the new time, %v", got, later)
	}

	// The minute counts from the last write, not from the first use.
	use(later.Add(59 * time.Second))
	if got := lastUsed(); !got.Equal(later) {
		t.Errorf("59 s after that: %v, want it unchanged, %v", got, later)
	}
	again := later.Add(60 * time.Second)
	use(again)
	if got := lastUsed(); !got.Equal(again) {
		t.Errorf("a minute after that: %v, want the new time, %v", got, again)
	}

	// A clock that goes back is not a recent use.
	back := again.Add(-time.Hour)
	use(back)
	if got := lastUsed(); !got.Equal(back) {
		t.Errorf("an hour before the last use: %v, want the new time, %v", got, back)
	}
}
