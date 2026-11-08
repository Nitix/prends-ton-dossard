package passkeys_test

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"github.com/descope/virtualwebauthn"
	"github.com/go-webauthn/webauthn/webauthn"

	"courses/server/apperr"
	"courses/server/config"
	"courses/server/passkeys"
	"courses/server/testutil"
)

const (
	registerBegin  = "/api/app/passkeys/register/begin"
	registerFinish = "/api/app/passkeys/register/finish"
	loginBegin     = "/api/app/passkeys/login/begin"
	loginFinish    = "/api/app/passkeys/login/finish"

	refresh = "/api/collections/users/auth-refresh"
)

// rp is the site as the browser of the tests sees it: testutil.NewApp sets
// APP_URL to http://localhost:5173.
var rp = virtualwebauthn.RelyingParty{ID: "localhost", Name: "Prends ton dossard", Origin: "http://localhost:5173"}

// code is how the API reports a refused request: data.code.
func code(c string) string { return `"code":"` + c + `"` }

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// start returns a seeded application and a sequence of requests on it.
func start(t *testing.T) (*tests.TestApp, testutil.Fixture, testutil.Sequence) {
	t.Helper()
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	return app, fx, testutil.NewSequence(t, app)
}

// begun is the answer of a begin route.
type begun struct {
	SessionID string          `json:"sessionId"`
	PublicKey json.RawMessage `json:"publicKey"`
}

func parseBegun(t testing.TB, response string) begun {
	t.Helper()
	var b begun
	if err := json.Unmarshal([]byte(response), &b); err != nil {
		t.Fatalf("reading the begin response %q: %v", response, err)
	}
	if b.SessionID == "" || len(b.PublicKey) == 0 {
		t.Fatalf("the begin response %q lacks the sessionId or the publicKey", response)
	}
	return b
}

// finishJSON returns the body of a finish request; an empty name is left out,
// as for a login.
func finishJSON(sessionID, name, credential string) string {
	body := map[string]any{"sessionId": sessionID, "credential": json.RawMessage(credential)}
	if name != "" {
		body["name"] = name
	}
	data, err := json.Marshal(body)
	if err != nil {
		panic(err)
	}
	return string(data)
}

// device is a virtual authenticator holding one passkey.
type device struct {
	auth virtualwebauthn.Authenticator
	cred virtualwebauthn.Credential
}

// newDevice returns the passkey manager of a phone: its passkeys can be
// synced (backup eligible), and this one is not yet.
func newDevice() *device {
	return &device{
		auth: virtualwebauthn.NewAuthenticatorWithOptions(virtualwebauthn.AuthenticatorOptions{BackupEligible: true}),
		cred: virtualwebauthn.NewCredential(virtualwebauthn.KeyTypeEC2),
	}
}

// attest begins a registration as the account that token belongs to, and
// returns its session id and the answer of the device to its options, which
// the device keeps the user handle of.
func (d *device) attest(t *testing.T, seq testutil.Sequence, token string) (sessionID, credential string) {
	t.Helper()
	b := parseBegun(t, seq.Step("register: begin", http.MethodPost, registerBegin, token, "", http.StatusOK, `"sessionId"`))
	opts, err := virtualwebauthn.ParseAttestationOptions(string(b.PublicKey))
	if err != nil {
		t.Fatalf("parsing the creation options %s: %v", b.PublicKey, err)
	}
	d.auth.Options.UserHandle = []byte(opts.UserID)
	return b.SessionID, virtualwebauthn.CreateAttestationResponse(rp, d.auth, d.cred, *opts)
}

// register runs a whole registration of the passkey of the device, named
// name, as the account that token belongs to, and returns the answer of the
// finish route.
func (d *device) register(t *testing.T, seq testutil.Sequence, token, name string, status int, contains ...string) string {
	t.Helper()
	sessionID, credential := d.attest(t, seq, token)
	return seq.Step("register: finish", http.MethodPost, registerFinish, token, finishJSON(sessionID, name, credential), status, contains...)
}

// assert begins a login and returns its session id and the assertion of the
// device, signed over its challenge.
func (d *device) assert(t *testing.T, seq testutil.Sequence) (sessionID, credential string) {
	t.Helper()
	b := parseBegun(t, seq.Step("login: begin", http.MethodPost, loginBegin, "", "", http.StatusOK, `"sessionId"`))
	opts, err := virtualwebauthn.ParseAssertionOptions(string(b.PublicKey))
	if err != nil {
		t.Fatalf("parsing the request options %s: %v", b.PublicKey, err)
	}
	return b.SessionID, virtualwebauthn.CreateAssertionResponse(rp, d.auth, d.cred, *opts)
}

// login runs a whole login with the passkey of the device and returns the
// answer of the finish route.
func (d *device) login(t *testing.T, seq testutil.Sequence, status int, contains ...string) string {
	t.Helper()
	sessionID, credential := d.assert(t, seq)
	return seq.Step("login: finish", http.MethodPost, loginFinish, "", finishJSON(sessionID, "", credential), status, contains...)
}

// passkeysOf returns the passkeys stored for user.
func passkeysOf(t testing.TB, app core.App, user *core.Record) []*core.Record {
	t.Helper()
	records, err := app.FindAllRecords("passkeys", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatalf("finding the passkeys: %v", err)
	}
	return records
}

// allPasskeys returns the number of passkeys stored.
func allPasskeys(t testing.TB, app core.App) int {
	t.Helper()
	n, err := app.CountRecords("passkeys")
	if err != nil {
		t.Fatalf("counting the passkeys: %v", err)
	}
	return int(n)
}

// credentialOf returns the WebAuthn credential stored in a passkey.
func credentialOf(t testing.TB, passkey *core.Record) webauthn.Credential {
	t.Helper()
	var c webauthn.Credential
	if err := json.Unmarshal([]byte(passkey.GetString("credential")), &c); err != nil {
		t.Fatalf("reading the stored credential: %v", err)
	}
	return c
}

// WebAuthn accepts a domain as RP ID, never an IP address: an APP_URL on an IP
// address stops the server at its start rather than at the first passkey.
func TestNewWebAuthn(t *testing.T) {
	for appURL, wantErr := range map[string]bool{
		"http://localhost:5173":      false,
		"https://courses.example.fr": false,
		"http://127.0.0.1:8090":      true,
		"http://[::1]:8090":          true,
	} {
		cfg, err := config.Load(func(key string) string {
			if key == "APP_URL" {
				return appURL
			}
			return ""
		})
		if err != nil {
			t.Fatalf("config.Load(%q): %v", appURL, err)
		}
		if _, err := passkeys.NewWebAuthn(cfg); (err != nil) != wantErr {
			t.Errorf("NewWebAuthn(%q) error = %v, want an error: %t", appURL, err, wantErr)
		}
	}
}

func TestPasskeys(t *testing.T) {
	t.Run("anon cannot register", func(t *testing.T) {
		_, _, seq := start(t)
		seq.Step("register: begin", http.MethodPost, registerBegin, "", "", http.StatusUnauthorized, `"status":401`)
		seq.Step("register: finish", http.MethodPost, registerFinish, "", `{}`, http.StatusUnauthorized, `"status":401`)
	})

	t.Run("alice registers a passkey, then signs in with it", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		response := d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone", http.StatusOK, `"name":"iPhone"`)

		stored := passkeysOf(t, app, fx.Alice)
		if len(stored) != 1 {
			t.Fatalf("alice has %d passkeys, want 1", len(stored))
		}
		passkey := stored[0]
		if !strings.Contains(response, `"id":"`+passkey.Id+`"`) {
			t.Errorf("the answer %s is not the id of the stored passkey %s", response, passkey.Id)
		}
		if got := passkey.GetString("name"); got != "iPhone" {
			t.Errorf("name = %q, want iPhone", got)
		}
		if got, want := passkey.GetString("credential_id"), b64url(d.cred.ID); got != want {
			t.Errorf("credential_id = %q, want %q (the base64url of the credential id)", got, want)
		}
		if !passkey.GetDateTime("last_used_at").IsZero() {
			t.Error("last_used_at is set before any login")
		}
		if got := credentialOf(t, passkey); b64url(got.ID) != b64url(d.cred.ID) || len(got.PublicKey) == 0 {
			t.Errorf("the stored credential %+v is not the one of the device", got)
		}

		// The device counts its signatures, and the passkey got synced since.
		d.cred.Counter = 7
		d.auth.Options.BackupState = true

		response = d.login(t, seq, http.StatusOK, `"token"`, `"id":"`+fx.Alice.Id+`"`)
		seq.Step("the token is a session of alice", http.MethodPost, refresh, testutil.TokenIn(t, response), "", http.StatusOK, `"id":"`+fx.Alice.Id+`"`)

		passkey, err := app.FindRecordById("passkeys", passkey.Id)
		if err != nil {
			t.Fatal(err)
		}
		if passkey.GetDateTime("last_used_at").IsZero() {
			t.Error("last_used_at is not set after the login")
		}
		credential := credentialOf(t, passkey)
		if credential.Authenticator.SignCount != 7 {
			t.Errorf("stored sign count = %d, want 7", credential.Authenticator.SignCount)
		}
		if !credential.Flags.BackupState {
			t.Error("the stored backup state flag is not updated")
		}
	})

	t.Run("the creation options", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		response := seq.Step("register: begin", http.MethodPost, registerBegin, token, "", http.StatusOK,
			`"residentKey":"required"`, `"requireResidentKey":true`, `"userVerification":"preferred"`, `"challenge":"`)
		opts, err := virtualwebauthn.ParseAttestationOptions(string(parseBegun(t, response).PublicKey))
		if err != nil {
			t.Fatal(err)
		}
		if opts.RelyingPartyID != "localhost" || opts.RelyingPartyName != "Prends ton dossard" {
			t.Errorf("rp = %q %q, want localhost Prends ton dossard", opts.RelyingPartyID, opts.RelyingPartyName)
		}
		if opts.UserID != fx.Alice.Id {
			t.Errorf("user.id decodes to %q, want the id of alice %q", opts.UserID, fx.Alice.Id)
		}
		if opts.UserName != fx.Alice.Email() || opts.UserDisplayName != "Alice" {
			t.Errorf("user = %q %q, want the email and the runner name of alice", opts.UserName, opts.UserDisplayName)
		}
		if len(opts.ExcludeCredentials) != 0 {
			t.Errorf("excludeCredentials = %v, want none", opts.ExcludeCredentials)
		}

		d.register(t, seq, token, "iPhone", http.StatusOK, `"name":"iPhone"`)

		response = seq.Step("register: begin again", http.MethodPost, registerBegin, token, "", http.StatusOK, `"excludeCredentials"`)
		opts, err = virtualwebauthn.ParseAttestationOptions(string(parseBegun(t, response).PublicKey))
		if err != nil {
			t.Fatal(err)
		}
		if len(opts.ExcludeCredentials) != 1 || opts.ExcludeCredentials[0] != b64url(d.cred.ID) {
			t.Errorf("excludeCredentials = %v, want the passkey of alice %s", opts.ExcludeCredentials, b64url(d.cred.ID))
		}
	})

	t.Run("the request options", func(t *testing.T) {
		_, _, seq := start(t)

		response := seq.Step("login: begin", http.MethodPost, loginBegin, "", "", http.StatusOK,
			`"rpId":"localhost"`, `"userVerification":"preferred"`, `"challenge":"`)
		if strings.Contains(response, "allowCredentials") {
			t.Errorf("the options %s list credentials: the login must be discoverable", response)
		}
		first := parseBegun(t, response)
		second := parseBegun(t, seq.Step("login: begin again", http.MethodPost, loginBegin, "", "", http.StatusOK, `"sessionId"`))
		if first.SessionID == second.SessionID || string(first.PublicKey) == string(second.PublicKey) {
			t.Error("two logins got the same session or the same challenge")
		}
	})

	t.Run("a disabled account cannot sign in", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		d.register(t, seq, testutil.Token(t, fx.Bob), "Phone", http.StatusOK, `"name":"Phone"`)
		seq.Step("the admin disables bob", http.MethodPatch, "/api/collections/users/records/"+fx.Bob.Id,
			testutil.Token(t, fx.Admin), `{"disabled":true}`, http.StatusOK, `"disabled":true`)

		d.login(t, seq, http.StatusBadRequest, code(apperr.CodeAccountDisabled))

		if !passkeysOf(t, app, fx.Bob)[0].GetDateTime("last_used_at").IsZero() {
			t.Error("last_used_at is set by a refused login")
		}
	})

	t.Run("an unknown session has expired", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		_, credential := d.attest(t, seq, token)
		seq.Step("register: finish", http.MethodPost, registerFinish, token, finishJSON("unknown", "iPhone", credential),
			http.StatusBadRequest, code(apperr.CodePasskeySessionExpired))
		if n := allPasskeys(t, app); n != 0 {
			t.Errorf("%d passkeys stored, want 0", n)
		}

		d.register(t, seq, token, "iPhone", http.StatusOK, `"name":"iPhone"`)
		_, assertion := d.assert(t, seq)
		seq.Step("login: finish", http.MethodPost, loginFinish, "", finishJSON("unknown", "", assertion),
			http.StatusBadRequest, code(apperr.CodePasskeySessionExpired))
		seq.Step("login: finish without body", http.MethodPost, loginFinish, "", "",
			http.StatusBadRequest, code(apperr.CodePasskeySessionExpired))
	})

	t.Run("a session is used once", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		sessionID, credential := d.attest(t, seq, token)
		body := finishJSON(sessionID, "iPhone", credential)
		seq.Step("register: finish", http.MethodPost, registerFinish, token, body, http.StatusOK, `"name":"iPhone"`)
		seq.Step("register: finish again", http.MethodPost, registerFinish, token, body,
			http.StatusBadRequest, code(apperr.CodePasskeySessionExpired))

		sessionID, assertion := d.assert(t, seq)
		body = finishJSON(sessionID, "", assertion)
		seq.Step("login: finish", http.MethodPost, loginFinish, "", body, http.StatusOK, `"token"`)
		seq.Step("login: finish again", http.MethodPost, loginFinish, "", body,
			http.StatusBadRequest, code(apperr.CodePasskeySessionExpired))
	})

	t.Run("an assertion signed over another challenge fails", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone", http.StatusOK, `"name":"iPhone"`)
		_, assertion := d.assert(t, seq)
		other := parseBegun(t, seq.Step("login: begin another", http.MethodPost, loginBegin, "", "", http.StatusOK, `"sessionId"`))

		seq.Step("login: finish the other with the first assertion", http.MethodPost, loginFinish, "",
			finishJSON(other.SessionID, "", assertion), http.StatusBadRequest, code(apperr.CodePasskeyFailed))
		if !passkeysOf(t, app, fx.Alice)[0].GetDateTime("last_used_at").IsZero() {
			t.Error("last_used_at is set by a failed login")
		}
	})

	t.Run("an unknown user handle fails", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()

		d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone", http.StatusOK, `"name":"iPhone"`)
		d.auth.Options.UserHandle = []byte("nobody000000000")

		d.login(t, seq, http.StatusBadRequest, code(apperr.CodePasskeyFailed))
	})

	t.Run("the passkey of alice does not sign bob in", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()

		d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone", http.StatusOK, `"name":"iPhone"`)
		d.auth.Options.UserHandle = []byte(fx.Bob.Id)

		d.login(t, seq, http.StatusBadRequest, code(apperr.CodePasskeyFailed))
	})

	t.Run("bob cannot finish the registration that alice began", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		sessionID, credential := d.attest(t, seq, testutil.Token(t, fx.Alice))
		seq.Step("register: finish as bob", http.MethodPost, registerFinish, testutil.Token(t, fx.Bob),
			finishJSON(sessionID, "iPhone", credential), http.StatusBadRequest, code(apperr.CodePasskeyFailed))
		if n := allPasskeys(t, app); n != 0 {
			t.Errorf("%d passkeys stored, want 0", n)
		}
	})

	t.Run("a login session does not register a passkey", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		b := parseBegun(t, seq.Step("login: begin", http.MethodPost, loginBegin, "", "", http.StatusOK, `"sessionId"`))
		opts, err := virtualwebauthn.ParseAssertionOptions(string(b.PublicKey))
		if err != nil {
			t.Fatal(err)
		}
		d.auth.Options.UserHandle = []byte(fx.Alice.Id)
		credential := virtualwebauthn.CreateAttestationResponse(rp, d.auth, d.cred,
			virtualwebauthn.AttestationOptions{Challenge: opts.Challenge, RelyingPartyID: rp.ID})

		seq.Step("register: finish with the login session", http.MethodPost, registerFinish, testutil.Token(t, fx.Alice),
			finishJSON(b.SessionID, "iPhone", credential), http.StatusBadRequest, code(apperr.CodePasskeyFailed))
		if n := allPasskeys(t, app); n != 0 {
			t.Errorf("%d passkeys stored, want 0", n)
		}
	})

	t.Run("a registration session does not sign in", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		d.register(t, seq, token, "iPhone", http.StatusOK, `"name":"iPhone"`)
		b := parseBegun(t, seq.Step("register: begin", http.MethodPost, registerBegin, token, "", http.StatusOK, `"sessionId"`))
		opts, err := virtualwebauthn.ParseAttestationOptions(string(b.PublicKey))
		if err != nil {
			t.Fatal(err)
		}
		assertion := virtualwebauthn.CreateAssertionResponse(rp, d.auth, d.cred,
			virtualwebauthn.AssertionOptions{Challenge: opts.Challenge, RelyingPartyID: rp.ID})

		seq.Step("login: finish with the registration session", http.MethodPost, loginFinish, "",
			finishJSON(b.SessionID, "", assertion), http.StatusBadRequest, code(apperr.CodePasskeyFailed))
	})

	t.Run("a passkey is registered once", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()

		d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone", http.StatusOK, `"name":"iPhone"`)
		// A client that ignores excludeCredentials.
		d.register(t, seq, testutil.Token(t, fx.Alice), "iPhone again", http.StatusBadRequest, code(apperr.CodePasskeyFailed))
		d.register(t, seq, testutil.Token(t, fx.Bob), "Stolen", http.StatusBadRequest, code(apperr.CodePasskeyFailed))

		if n := allPasskeys(t, app); n != 1 {
			t.Errorf("%d passkeys stored, want 1", n)
		}
	})

	t.Run("a passkey needs a name", func(t *testing.T) {
		app, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		sessionID, credential := d.attest(t, seq, token)
		seq.Step("register: finish without name", http.MethodPost, registerFinish, token, finishJSON(sessionID, "  ", credential),
			http.StatusBadRequest, `"name":{"code":"validation_required"`)
		// The session is still there: the page asks for a name and sends again.
		seq.Step("register: finish with a name", http.MethodPost, registerFinish, token, finishJSON(sessionID, " iPhone ", credential),
			http.StatusOK, `"name":"iPhone"`)
		if n := allPasskeys(t, app); n != 1 {
			t.Errorf("%d passkeys stored, want 1", n)
		}
	})

	t.Run("a malformed credential fails", func(t *testing.T) {
		_, fx, seq := start(t)
		d := newDevice()
		token := testutil.Token(t, fx.Alice)

		sessionID, _ := d.attest(t, seq, token)
		seq.Step("register: finish", http.MethodPost, registerFinish, token, finishJSON(sessionID, "iPhone", `{"id":"x"}`),
			http.StatusBadRequest, code(apperr.CodePasskeyFailed))

		b := parseBegun(t, seq.Step("login: begin", http.MethodPost, loginBegin, "", "", http.StatusOK, `"sessionId"`))
		seq.Step("login: finish", http.MethodPost, loginFinish, "", finishJSON(b.SessionID, "", `"garbage"`),
			http.StatusBadRequest, code(apperr.CodePasskeyFailed))
	})
}
