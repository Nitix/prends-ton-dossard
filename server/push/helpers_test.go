package push_test

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/push"
	"courses/server/testutil"
)

// The addresses of the tests: real hosts of the allow-list, which the fake push
// service answers whatever the host (see fakePush.client).
const fcm = "https://fcm.googleapis.com"

// seen is what the fake push service received for an address.
type seen struct {
	Body    []byte
	Headers http.Header
}

// fakePush is a push service of the tests. Its client reaches it for any host,
// so that the endpoints can be those of the allow-list.
type fakePush struct {
	mu     sync.Mutex
	status map[string]int
	got    map[string][]seen
	client *http.Client
}

func newFakePush(t testing.TB) *fakePush {
	t.Helper()
	f := &fakePush{status: map[string]int{}, got: map[string][]seen{}}
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		f.mu.Lock()
		f.got[r.URL.Path] = append(f.got[r.URL.Path], seen{Body: body, Headers: r.Header.Clone()})
		code := f.status[r.URL.Path]
		f.mu.Unlock()
		if code == 0 {
			code = http.StatusCreated
		}
		w.WriteHeader(code)
	}))
	t.Cleanup(srv.Close)
	transport := srv.Client().Transport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}
	transport.DialContext = func(ctx context.Context, network, _ string) (net.Conn, error) {
		return (&net.Dialer{}).DialContext(ctx, network, srv.Listener.Addr().String())
	}
	f.client = &http.Client{Transport: transport, Timeout: 10 * time.Second}
	return f
}

// answer makes the fake service answer code for the path.
func (f *fakePush) answer(path string, code int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.status[path] = code
}

// received returns what the path got, in order.
func (f *fakePush) received(path string) []seen {
	f.mu.Lock()
	defer f.mu.Unlock()
	return append([]seen(nil), f.got[path]...)
}

// total is how many requests the service got.
func (f *fakePush) total() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, s := range f.got {
		n += len(s)
	}
	return int(n)
}

// useFake makes the service of app send through a new fake push service.
func useFake(t testing.TB, app core.App) *fakePush {
	t.Helper()
	f := newFakePush(t)
	push.ServiceOf(app).UseClient(f.client, nil)
	return f
}

// addDevice stores a subscription of the account, as the routes do, for a new
// recipient whose address ends with path.
func addDevice(t testing.TB, app core.App, user *core.Record, path, lang string) (recipient, *core.Record) {
	t.Helper()
	r := newRecipient(t, fcm+path)
	collection, err := app.FindCollectionByNameOrId("push_subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	record := core.NewRecord(collection)
	record.Set("user", user.Id)
	record.Set("endpoint", r.sub.Endpoint)
	record.Set("p256dh", enc(r.sub.P256dh))
	record.Set("auth", enc(r.sub.Auth))
	record.Set("lang", lang)
	record.Set("label", "Appareil "+path)
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return r, record
}

func enc(b []byte) string { return push.B64(b) }

// devicesOf returns the subscriptions of the account, the oldest first.
func devicesOf(t testing.TB, app core.App, user *core.Record) []*core.Record {
	t.Helper()
	records, err := app.FindAllRecords("push_subscriptions", dbx.HashExp{"user": user.Id})
	if err != nil {
		t.Fatal(err)
	}
	return records
}

// count is how many subscriptions the table holds.
func count(t testing.TB, app core.App) int {
	t.Helper()
	n, err := app.CountRecords("push_subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

// body writes the JSON of a subscription as a browser sends it.
func body(endpoint string, p256dh, auth []byte, lang, label string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		keys := map[string]string{"p256dh": enc(p256dh), "auth": enc(auth)}
		raw, _ := json.Marshal(map[string]any{"endpoint": endpoint, "keys": keys, "lang": lang, "label": label})
		return string(raw)
	}
}

// jsonOf writes a value as JSON.
func jsonOf(v any) string {
	raw, err := json.Marshal(v)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

// apiScenario is a request of an application that a test keeps for several.
func apiScenario(t testing.TB, app *tests.TestApp, method, url, token, payload string, status int, contains ...string) tests.ApiScenario {
	t.Helper()
	s := tests.ApiScenario{
		Method:                method,
		URL:                   url,
		ExpectedStatus:        status,
		ExpectedContent:       contains,
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		Headers:               map[string]string{},
	}
	if token != "" {
		s.Headers["Authorization"] = token
	}
	if payload != "" {
		s.Body = strings.NewReader(payload)
	}
	if len(contains) == 0 && status != http.StatusNoContent {
		s.NotExpectedContent = []string{"\x00"}
	}
	return s
}
