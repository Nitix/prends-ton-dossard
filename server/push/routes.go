package push

import (
	"crypto/ecdh"
	"crypto/subtle"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"sync"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/router"

	"courses/server/apperr"
	"courses/server/config"
)

// path is the collection of the routes.
const path = "/api/app/push"

// testEvery is the least time between two test messages of an account.
const testEvery = 30 * time.Second

// Register makes the service of the notifications and attaches what it needs
// to app: the hooks of the subscriptions, and, outside the demo, the routes
// of the devices. The keys are loaded, or made, at the first OnServe.
//
// It returns a service on the demo too, which is not available and has no
// route (its account is shared by everybody: a visitor's devices would receive
// the warnings of strangers), so that what is wired is the same everywhere.
func Register(app core.App, cfg config.Config) *Service {
	s := &Service{
		cfg:       cfg,
		newSender: func(keys *Keys) *Sender { return NewSender(keys, cfg.PushContact) },
		// Made here and not in the OnServe closure: the closure runs again for
		// each router that is built, and the limit must outlive them.
		tests: &testLimiter{last: map[string]time.Time{}},
	}
	registerHooks(app)
	if afterRegister != nil {
		afterRegister(app, s)
	}
	if cfg.Demo() {
		return s
	}
	app.OnServe().BindFunc(func(e *core.ServeEvent) error {
		s.load(e.App)
		e.Router.GET(path, s.listRoute).Bind(apis.RequireAuth("users"))
		e.Router.POST(path+"/subscriptions", s.subscribeRoute).Bind(apis.RequireAuth("users"))
		e.Router.DELETE(path+"/subscriptions", removeByEndpointRoute).Bind(apis.RequireAuth("users"))
		e.Router.DELETE(path+"/subscriptions/{id}", removeByIDRoute).Bind(apis.RequireAuth("users"))
		// No session: the service worker has none. The old endpoint and its
		// secret are the proof.
		e.Router.POST(path+"/renew", renewRoute)
		e.Router.POST(path+"/test", s.testRoute).Bind(apis.RequireAuth("users"))
		return e.Next()
	})
	return s
}

// afterRegister lets the tests find the service of an application.
var afterRegister func(core.App, *Service)

// testLimiter holds when each account last asked for a test message, in memory.
type testLimiter struct {
	mu   sync.Mutex
	last map[string]time.Time
	now  func() time.Time
}

// allow says whether the account may ask now, and counts the ask when it may.
func (l *testLimiter) allow(userID string) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := time.Now()
	if l.now != nil {
		now = l.now()
	}
	for id, at := range l.last {
		if now.Sub(at) >= testEvery {
			delete(l.last, id)
		}
	}
	if _, waiting := l.last[userID]; waiting {
		return false
	}
	l.last[userID] = now
	return true
}

// fail returns err as the response: a refused value is the caller's (a 400 with
// its code), anything else is the server's.
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

// device is what the list says of a device. It has no field for the endpoint
// or the keys: they cannot be in an answer by a slip.
type device struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	Created       string `json:"created"`
	LastSuccessAt string `json:"lastSuccessAt"`
}

// listRoute lists the devices of the caller, the newest first, with the public
// key to subscribe with. Without keys (a file that cannot be read) the site is
// told that the notifications are not available.
func (s *Service) listRoute(e *core.RequestEvent) error {
	var records []*core.Record
	err := e.App.RecordQuery("push_subscriptions").
		AndWhere(dbx.HashExp{"user": e.Auth.Id}).
		OrderBy("created DESC", "id DESC").
		All(&records)
	if err != nil {
		return e.InternalServerError("", err)
	}
	devices := make([]device, 0, len(records))
	for _, record := range records {
		d := device{
			ID:      record.Id,
			Label:   record.GetString("label"),
			Created: record.GetDateTime("created").String(),
		}
		if last := record.GetDateTime("last_success_at"); !last.IsZero() {
			d.LastSuccessAt = last.String()
		}
		devices = append(devices, d)
	}
	answer := struct {
		Available bool     `json:"available"`
		PublicKey string   `json:"publicKey,omitempty"`
		Devices   []device `json:"devices"`
	}{Available: s.Available(), PublicKey: s.publicKey(), Devices: devices}
	return e.JSON(http.StatusOK, answer)
}

// subscription is the body of a subscription, as the browser's own
// PushSubscription.toJSON() writes it, with the language and the label.
type subscription struct {
	Endpoint string `json:"endpoint"`
	Keys     struct {
		P256dh string `json:"p256dh"`
		Auth   string `json:"auth"`
	} `json:"keys"`
	Lang  string `json:"lang"`
	Label string `json:"label"`
}

// checked returns the error to answer, or nil: the endpoint is one of the push
// services, the p256dh is a point of the curve (65 bytes, uncompressed) and the
// auth is 16 bytes, both base64url.
func (b subscription) checked() error {
	if len(b.Endpoint) > 1000 || !EndpointAllowed(b.Endpoint) { // the empty one too
		return apperr.New(http.StatusBadRequest, apperr.CodePushEndpointInvalid)
	}
	p256dh, auth := b.keysOf()
	point, err := b64url.DecodeString(p256dh)
	if err != nil || len(point) != 65 || !onCurve(point) {
		return apperr.Field("p256dh", "validation_invalid_value")
	}
	secret, err := b64url.DecodeString(auth)
	if err != nil || len(secret) != 16 {
		return apperr.Field("auth", "validation_invalid_value")
	}
	return nil
}

// keysOf returns the keys as they are stored: base64url, without padding.
func (b subscription) keysOf() (p256dh, auth string) {
	return strings.TrimRight(b.Keys.P256dh, "="), strings.TrimRight(b.Keys.Auth, "=")
}

// subscribeRoute makes or updates the subscription of an endpoint, in the name
// of the caller: a device that changes account changes owner.
func (s *Service) subscribeRoute(e *core.RequestEvent) error {
	if !s.Available() {
		return apperr.New(http.StatusServiceUnavailable, apperr.CodePushUnavailable)
	}
	var body subscription
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	if err := body.checked(); err != nil {
		return fail(e, err)
	}
	record, err := e.App.FindFirstRecordByData("push_subscriptions", "endpoint", body.Endpoint)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		collection, cerr := e.App.FindCollectionByNameOrId("push_subscriptions")
		if cerr != nil {
			return e.InternalServerError("", cerr)
		}
		record = core.NewRecord(collection)
		record.Set("endpoint", body.Endpoint)
	case err != nil:
		return e.InternalServerError("", err)
	}
	p256dh, auth := body.keysOf()
	record.Set("user", e.Auth.Id)
	record.Set("p256dh", p256dh)
	record.Set("auth", auth)
	record.Set("lang", body.Lang)
	record.Set("label", strings.TrimSpace(body.Label))
	record.Set("failures", 0)
	if err := e.App.Save(record); err != nil {
		return fail(e, err)
	}
	return e.JSON(http.StatusOK, map[string]string{"id": record.Id})
}

// removeByEndpointRoute removes the subscription of this device. A device that
// has none, or whose endpoint is another account's, gets the same 204.
func removeByEndpointRoute(e *core.RequestEvent) error {
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	records, err := e.App.FindAllRecords("push_subscriptions", dbx.HashExp{"user": e.Auth.Id, "endpoint": body.Endpoint})
	if err != nil {
		return e.InternalServerError("", err)
	}
	for _, record := range records {
		if err := e.App.Delete(record); err != nil {
			return e.InternalServerError("", err)
		}
	}
	return e.NoContent(http.StatusNoContent)
}

// removeByIDRoute removes one of the caller's devices. One that is not there,
// and one of somebody else, are the same not found.
func removeByIDRoute(e *core.RequestEvent) error {
	notFound := apperr.New(http.StatusNotFound, apperr.CodeNotFound)
	record, err := e.App.FindRecordById("push_subscriptions", e.Request.PathValue("id"))
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

// renewRoute replaces the subscription that a browser changed, for the service
// worker, which has no session. Whoever knows the old endpoint and its secret
// (compared in constant time) is the device; anybody else gets a not found, the
// same one whether the endpoint exists or not.
func renewRoute(e *core.RequestEvent) error {
	notFound := apperr.New(http.StatusNotFound, apperr.CodeNotFound)
	var body struct {
		OldEndpoint string `json:"oldEndpoint"`
		OldAuth     string `json:"oldAuth"`
		subscription
	}
	if err := e.BindBody(&body); err != nil {
		return e.BadRequestError("", err)
	}
	record, err := e.App.FindFirstRecordByData("push_subscriptions", "endpoint", body.OldEndpoint)
	if errors.Is(err, sql.ErrNoRows) {
		return notFound
	}
	if err != nil {
		return e.InternalServerError("", err)
	}
	stored := []byte(record.GetString("auth"))
	if subtle.ConstantTimeCompare(stored, []byte(strings.TrimRight(body.OldAuth, "="))) != 1 {
		return notFound
	}
	if err := body.subscription.checked(); err != nil {
		return fail(e, err)
	}
	p256dh, auth := body.keysOf()
	record.Set("endpoint", body.Endpoint)
	record.Set("p256dh", p256dh)
	record.Set("auth", auth)
	record.Set("failures", 0)
	if err := e.App.Save(record); err != nil {
		return fail(e, err)
	}
	return e.JSON(http.StatusOK, map[string]string{"id": record.Id})
}

// testMessage is what the test sends, in the language of each device.
func testMessage(lang string) Message {
	m := Message{
		Title: "Prends ton dossard",
		Body:  "Ceci est un essai : tes rappels arriveront ainsi.",
		URL:   "/profil/reglages",
		Tag:   "test",
	}
	if lang == "en" {
		m.Body = "This is a test: your reminders will arrive like this."
	}
	return m
}

// testRoute sends a test message to every device of the caller, at most once
// every 30 seconds per account.
func (s *Service) testRoute(e *core.RequestEvent) error {
	if !s.Available() {
		return apperr.New(http.StatusServiceUnavailable, apperr.CodePushUnavailable)
	}
	if !s.tests.allow(e.Auth.Id) {
		return e.TooManyRequestsError("", nil)
	}
	delivery, err := s.SendToUser(e.Request.Context(), e.App, e.Auth.Id, testMessage,
		Options{TTL: time.Minute, Urgency: "high"})
	if err != nil {
		return e.InternalServerError("", err)
	}
	return e.JSON(http.StatusOK, struct {
		Sent   int `json:"sent"`
		Failed int `json:"failed"`
	}{delivery.Sent, delivery.Failed})
}

// onCurve says whether point is an uncompressed point of P-256.
func onCurve(point []byte) bool {
	_, err := ecdh.P256().NewPublicKey(point)
	return err == nil
}
