package passkeys

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
	"github.com/go-webauthn/webauthn/protocol"
	"github.com/go-webauthn/webauthn/webauthn"

	"courses/server/apperr"
	"courses/server/config"
)

// authMethod is the auth method of a passkey login, as the auth hooks of
// PocketBase see it. Its MFA would count it as a method of its own, and its
// new-device alert would fire for it, but both are disabled on "users".
const authMethod = "passkey"

// Register adds the passkey routes to app, whose challenges last five minutes.
// Registering a passkey is for a signed-in account; signing in with one is
// public, under the rate limit rule of the settings that covers every path
// under /api/app/passkeys/login/.
//
// It fails when cfg cannot be a WebAuthn relying party: see NewWebAuthn.
func Register(app core.App, cfg config.Config) error {
	wa, err := NewWebAuthn(cfg)
	if err != nil {
		return fmt.Errorf("passkeys: APP_URL %s: %w", cfg.Origin, err)
	}
	// The store outlives the routers that OnServe builds: it is made once here.
	h := &handlers{wa: wa, sessions: NewSessions(ceremonyTTL, time.Now)}

	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		e.Router.POST("/api/app/passkeys/register/begin", h.registerBegin).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/app/passkeys/register/finish", h.registerFinish).Bind(apis.RequireAuth("users"))
		e.Router.POST("/api/app/passkeys/login/begin", h.loginBegin)
		e.Router.POST("/api/app/passkeys/login/finish", h.loginFinish)
		return e.Next()
	})
	return nil
}

type handlers struct {
	wa       *webauthn.WebAuthn
	sessions *Sessions
}

// begun answers a begin route: the id of the session kept for the finish
// route, and the options for the browser.
func (h *handlers) begun(e *core.RequestEvent, session *webauthn.SessionData, options any) error {
	// The options are serialized by encoding/json, which go-webauthn writes
	// them for. PocketBase answers with encoding/json/v2, whose defaults differ
	// (omitempty, nil slices); it copies a json.RawMessage as it is.
	publicKey, err := json.Marshal(options)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, map[string]any{
		"sessionId": h.sessions.Put(*session),
		"publicKey": json.RawMessage(publicKey),
	})
}

// registerBegin answers the options to create a passkey for the caller, which
// exclude the passkeys the caller already has.
func (h *handlers) registerBegin(e *core.RequestEvent) error {
	acc, err := loadAccount(e.App, e.Auth)
	if err != nil {
		return e.InternalServerError("", err)
	}
	creation, session, err := h.wa.BeginRegistration(acc,
		webauthn.WithExclusions(webauthn.Credentials(acc.credentials).CredentialDescriptors()),
	)
	if err != nil {
		return e.InternalServerError("", err)
	}
	return h.begun(e, session, creation.Response)
}

// registerFinish verifies the new credential and stores it as a passkey of the
// caller, under the name the caller gave it.
func (h *handlers) registerFinish(e *core.RequestEvent) error {
	var body struct {
		SessionID  string          `json:"sessionId"`
		Name       string          `json:"name"`
		Credential json.RawMessage `json:"credential"`
	}
	// A body that cannot be read leaves what is missing empty, which is refused
	// below (first of all the session id, which no session has empty).
	_ = e.BindBody(&body)

	// Checked before the session is taken: the page can send the same
	// credential again, with a name.
	name := strings.TrimSpace(body.Name)
	if name == "" {
		return apperr.Field("name", validation.ErrRequired.Code())
	}

	session, ok := h.sessions.Take(body.SessionID)
	if !ok {
		return apperr.New(http.StatusBadRequest, apperr.CodePasskeySessionExpired)
	}
	parsed, err := protocol.ParseCredentialCreationResponseBytes(body.Credential)
	if err != nil {
		return failed(err)
	}

	acc, err := loadAccount(e.App, e.Auth)
	if err != nil {
		return e.InternalServerError("", err)
	}
	// It also checks that the session was begun by the caller, for a
	// registration: its user handle is the one of the caller.
	credential, err := h.wa.CreateCredential(acc, session, parsed)
	if err != nil {
		return failed(err)
	}

	// A passkey belongs to one account, once. The unique index on credential_id
	// would refuse it too, but as a field error.
	id := credentialID(credential)
	_, err = e.App.FindFirstRecordByData("passkeys", "credential_id", id)
	if err == nil {
		return failed(errors.New("the credential is already registered"))
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return e.InternalServerError("", err)
	}

	collection, err := e.App.FindCollectionByNameOrId("passkeys")
	if err != nil {
		return e.InternalServerError("", err)
	}
	passkey := core.NewRecord(collection)
	passkey.Set("user", e.Auth.Id)
	passkey.Set("name", name)
	passkey.Set("credential_id", id)
	if err := setCredential(passkey, credential); err != nil {
		return e.InternalServerError("", err)
	}
	if err := e.App.Save(passkey); err != nil {
		return fail(e, err)
	}

	return e.JSON(http.StatusOK, map[string]any{
		"id":   passkey.Id,
		"name": passkey.GetString("name"),
	})
}

// loginBegin answers the options of a discoverable login: they name no
// account, the browser offers the passkeys it has for the site.
func (h *handlers) loginBegin(e *core.RequestEvent) error {
	assertion, session, err := h.wa.BeginDiscoverableLogin()
	if err != nil {
		return e.InternalServerError("", err)
	}
	return h.begun(e, session, assertion.Response)
}

// loginFinish verifies the assertion and answers a session of its account, as
// a password login does.
func (h *handlers) loginFinish(e *core.RequestEvent) error {
	var body struct {
		SessionID  string          `json:"sessionId"`
		Credential json.RawMessage `json:"credential"`
	}
	// A body that cannot be read leaves the session id empty, which no session
	// has.
	_ = e.BindBody(&body)

	session, ok := h.sessions.Take(body.SessionID)
	if !ok {
		return apperr.New(http.StatusBadRequest, apperr.CodePasskeySessionExpired)
	}
	parsed, err := protocol.ParseCredentialRequestResponseBytes(body.Credential)
	if err != nil {
		return failed(err)
	}

	// The user handle that the authenticator gives back is the id of the
	// account; go-webauthn then checks that the credential is one of its
	// passkeys, and the signature with the public key stored for it.
	findAccount := func(_, userHandle []byte) (webauthn.User, error) {
		record, err := e.App.FindRecordById("users", string(userHandle))
		if err != nil {
			return nil, err
		}
		acc, err := loadAccount(e.App, record)
		if err != nil {
			return nil, err
		}
		return acc, nil
	}
	user, credential, err := h.wa.ValidatePasskeyLogin(findAccount, session, parsed)
	if err != nil {
		return failed(err)
	}
	acc := user.(*account)

	// Told only to the holder of a passkey of the account, once verified.
	if acc.record.GetBool("disabled") {
		return apperr.New(http.StatusBadRequest, apperr.CodeAccountDisabled)
	}

	if err := recordUse(e.App, acc, credential); err != nil {
		return e.InternalServerError("", err)
	}
	return apis.RecordAuthResponse(e, acc.record, authMethod, nil)
}

// recordUse stores what a login changed in the credential (its signature
// counter and flags) and when the passkey was last used.
func recordUse(app core.App, acc *account, credential *webauthn.Credential) error {
	passkey, before, ok := acc.passkeyOf(credential.ID)
	if !ok {
		return fmt.Errorf("no passkey of %s has the credential that was verified", acc.record.Id)
	}

	// A counter that does not grow hints at a cloned authenticator. The login
	// stands, as WebAuthn leaves it to the site: the log keeps the signal.
	if credential.Authenticator.CloneWarning && !before.Authenticator.CloneWarning {
		app.Logger().Warn("passkey signature counter did not increase: the authenticator may be cloned",
			"passkey", passkey.Id, "user", acc.record.Id)
	}

	if err := setCredential(passkey, credential); err != nil {
		return err
	}
	passkey.Set("last_used_at", types.NowDateTime())
	return app.Save(passkey)
}

// failed is the answer to a ceremony that does not verify. It carries the code
// alone, while the request log keeps its cause: PocketBase logs the whole
// message of an error that wraps the error of the API.
func failed(cause error) error {
	reason := cause.Error()
	var detailed *protocol.Error
	if errors.As(cause, &detailed) && detailed.DevInfo != "" {
		reason += " (" + detailed.DevInfo + ")"
	}
	return fmt.Errorf("%w: %s", apperr.New(http.StatusBadRequest, apperr.CodePasskeyFailed), reason)
}

// fail returns err as the response: the errors that carry a code or a field are
// the ones of the caller, and any other one is the server's.
func fail(e *core.RequestEvent, err error) error {
	var apiErr *router.ApiError
	var invalid validation.Errors
	if errors.As(err, &apiErr) || errors.As(err, &invalid) {
		return err
	}
	return e.InternalServerError("", err)
}
