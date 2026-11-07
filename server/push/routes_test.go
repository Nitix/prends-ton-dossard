package push_test

import (
	"crypto/rand"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/push"
	"courses/server/testutil"
)

func at(p string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string { return p }
}

const (
	subscriptionsURL = push.Path + "/subscriptions"
)

func field(name, code string) string {
	return `"` + name + `":{"code":"` + code + `"`
}

func TestPushRoutes_Subscribe(t *testing.T) {
	r := newRecipient(t, fcm+"/fcm/send/one")
	offCurve := append([]byte{4}, make([]byte, 64)...)
	for i := 1; i < len(offCurve); i++ {
		offCurve[i] = 1
	}
	shortKey := r.sub.P256dh[:64]
	shortAuth := r.sub.Auth[:15]
	// What the browser writes: base64url, no padding. A key written with
	// another alphabet or with spaces is not one.
	rawBody := func(p256dh, auth string) func(testutil.Fixture) string {
		return func(testutil.Fixture) string {
			return jsonOf(map[string]any{
				"endpoint": r.sub.Endpoint, "keys": map[string]string{"p256dh": p256dh, "auth": auth}, "lang": "fr", "label": "x",
			})
		}
	}
	nothingStored := func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		if got := count(t, app); got != 0 {
			t.Errorf("%d subscriptions stored, want none", got)
		}
	}
	existing := func(owner func(testutil.Fixture) *core.Record) func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			record := core.NewRecord(mustCollection(t, app))
			record.Set("user", owner(fx).Id)
			record.Set("endpoint", r.sub.Endpoint)
			record.Set("p256dh", enc(shortKey))
			record.Set("auth", enc(shortAuth))
			record.Set("lang", "en")
			record.Set("label", "Old")
			record.Set("failures", 4)
			if err := app.Save(record); err != nil {
				t.Fatal(err)
			}
		}
	}
	only := func(t testing.TB, app *tests.TestApp, owner *core.Record) *core.Record {
		t.Helper()
		if got := count(t, app); got != 1 {
			t.Fatalf("%d subscriptions stored, want 1", got)
		}
		all, _ := app.FindAllRecords("push_subscriptions")
		if got := all[0].GetString("user"); got != owner.Id {
			t.Errorf("the device belongs to %s, want %s", got, owner.Id)
		}
		return all[0]
	}

	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a session is needed", As: "anon", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "Firefox"), Status: http.StatusUnauthorized,
			After: nothingStored,
		},
		{
			Name: "a good subscription is stored in the name of the caller", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "  Firefox sur Windows "), Status: http.StatusOK,
			Contains: []string{`{"id":"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				d := only(t, app, fx.Alice)
				if d.GetString("endpoint") != r.sub.Endpoint || d.GetString("p256dh") != enc(r.sub.P256dh) || d.GetString("auth") != enc(r.sub.Auth) ||
					d.GetString("lang") != "fr" || d.GetString("label") != "Firefox sur Windows" || d.GetInt("failures") != 0 {
					t.Errorf("stored %v, want the subscription of the body, the label trimmed", d.FieldsData())
				}
			},
		},
		{
			Name: "the same endpoint again updates it", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Before: existing(func(fx testutil.Fixture) *core.Record { return fx.Alice }),
			Body:   body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "Firefox"), Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				d := only(t, app, fx.Alice)
				if d.GetString("p256dh") != enc(r.sub.P256dh) || d.GetString("lang") != "fr" || d.GetString("label") != "Firefox" || d.GetInt("failures") != 0 {
					t.Errorf("stored %v, want the new keys, language and label, and no failure", d.FieldsData())
				}
			},
		},
		{
			Name: "the same endpoint by Bob moves it to Bob", As: "bob", Method: http.MethodPost, URL: at(subscriptionsURL),
			Before: existing(func(fx testutil.Fixture) *core.Record { return fx.Alice }),
			Body:   body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "en", "Firefox"), Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				only(t, app, fx.Bob)
				if got := len(devicesOf(t, app, fx.Alice)); got != 0 {
					t.Errorf("Alice keeps %d devices, want none", got)
				}
			},
		},
		{
			Name: "a key that is not base64url", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: rawBody("***not base64***", enc(r.sub.Auth)), Status: http.StatusBadRequest,
			Contains: []string{field("p256dh", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "a p256dh of 64 bytes", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, shortKey, r.sub.Auth, "fr", ""), Status: http.StatusBadRequest,
			Contains: []string{field("p256dh", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "a point that is not on the curve", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, offCurve, r.sub.Auth, "fr", ""), Status: http.StatusBadRequest,
			Contains: []string{field("p256dh", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "an auth of 15 bytes", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, shortAuth, "fr", ""), Status: http.StatusBadRequest,
			Contains: []string{field("auth", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "no keys at all", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: func(testutil.Fixture) string { return jsonOf(map[string]any{"endpoint": r.sub.Endpoint, "lang": "fr"}) }, Status: http.StatusBadRequest,
			Contains: []string{field("p256dh", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "a language that is not fr or en", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "de", ""), Status: http.StatusBadRequest,
			Contains: []string{field("lang", "validation_invalid_value")}, After: nothingStored,
		},
		{
			Name: "no language", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "", ""), Status: http.StatusBadRequest,
			Contains: []string{field("lang", "validation_required")}, After: nothingStored,
		},
		{
			Name: "a label over 60 characters", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", strings.Repeat("é", 61)), Status: http.StatusBadRequest,
			Contains: []string{field("label", "validation_max_text_constraint")}, After: nothingStored,
		},
		{
			Name: "a body that is not JSON", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body: func(testutil.Fixture) string { return "not json" }, Status: http.StatusBadRequest, After: nothingStored,
		},
	})
}

func mustCollection(t testing.TB, app core.App) *core.Collection {
	t.Helper()
	c, err := app.FindCollectionByNameOrId("push_subscriptions")
	if err != nil {
		t.Fatal(err)
	}
	return c
}

// The server never posts to an address that somebody chose: the routes refuse
// it, and keep nothing.
func TestPushRoutes_RefuseOtherEndpoints(t *testing.T) {
	r := newRecipient(t, fcm+"/fcm/send/one")
	var rows []testutil.Row
	for i, endpoint := range refusedEndpoints {
		rows = append(rows, testutil.Row{
			Name: "subscribe " + strconv.Itoa(i) + " " + strings.NewReplacer("/", "_", ":", "_", "\x00", "NUL", "\n", "LF", "\r", "CR").Replace(endpoint),
			As:   "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
			Body:     body(endpoint, r.sub.P256dh, r.sub.Auth, "fr", ""),
			Status:   http.StatusBadRequest,
			Contains: []string{`"code":"push_endpoint_invalid"`},
			After: func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
				if got := count(t, app); got != 0 {
					t.Errorf("%d subscriptions stored, want none", got)
				}
			},
		})
	}
	rows = append(rows, testutil.Row{
		Name: "an endpoint over 1000 characters", As: "alice", Method: http.MethodPost, URL: at(subscriptionsURL),
		Body:     body(fcm+"/"+strings.Repeat("x", 1000), r.sub.P256dh, r.sub.Auth, "fr", ""),
		Status:   http.StatusBadRequest,
		Contains: []string{`"code":"push_endpoint_invalid"`},
	})
	testutil.RunRows(t, rows)
}

func TestPushRoutes_ListHoldsNoSecret(t *testing.T) {
	r := newRecipient(t, fcm+"/fcm/send/SECRET-ENDPOINT-PATH")
	other := newRecipient(t, fcm+"/fcm/send/BOBS-ENDPOINT")
	secrets := []string{"SECRET-ENDPOINT-PATH", "fcm.googleapis.com", enc(r.sub.P256dh), enc(r.sub.Auth)}
	seed := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		for _, d := range []struct {
			owner *core.Record
			r     recipient
			label string
		}{{fx.Alice, r, "Firefox sur Windows"}, {fx.Bob, other, "Chez Bob"}} {
			record := core.NewRecord(mustCollection(t, app))
			record.Set("user", d.owner.Id)
			record.Set("endpoint", d.r.sub.Endpoint)
			record.Set("p256dh", enc(d.r.sub.P256dh))
			record.Set("auth", enc(d.r.sub.Auth))
			record.Set("lang", "fr")
			record.Set("label", d.label)
			record.Set("last_success_at", "2026-11-06 08:00:00.000Z")
			if err := app.Save(record); err != nil {
				t.Fatal(err)
			}
		}
	}
	testutil.RunRows(t, []testutil.Row{
		{Name: "a session is needed", As: "anon", Method: http.MethodGet, URL: at(push.Path), Status: http.StatusUnauthorized},
		{
			Name: "the devices of the caller, and the public key", As: "alice", Method: http.MethodGet, URL: at(push.Path), Before: seed,
			Status:      http.StatusOK,
			Contains:    []string{`"available":true`, `"publicKey":"`, `"label":"Firefox sur Windows"`, `"created":"`, `"lastSuccessAt":"2026-11-06 08:00:00.000Z"`, `"id":"`},
			NotContains: append([]string{"Chez Bob", "BOBS-ENDPOINT", `"endpoint"`, `"auth"`, `"p256dh"`, "privateKey"}, secrets...),
		},
		{
			Name: "a device that never received has no date of its own", As: "bob", Method: http.MethodGet, URL: at(push.Path), Before: seed,
			Status: http.StatusOK, Contains: []string{`"label":"Chez Bob"`}, NotContains: []string{"Firefox"},
		},
		{
			Name: "the collection itself is not readable through the API", As: "alice", Method: http.MethodGet,
			URL: at("/api/collections/push_subscriptions/records"), Before: seed, Status: http.StatusForbidden,
		},
		{
			Name: "nor one of its records", As: "alice", Method: http.MethodGet,
			URL: func(testutil.Fixture) string { return "/api/collections/push_subscriptions/records/anything" }, Before: seed,
			Status: http.StatusForbidden,
		},
		{
			Name: "nor can the API write in it", As: "alice", Method: http.MethodPost,
			URL: at("/api/collections/push_subscriptions/records"), Status: http.StatusForbidden,
			Body: body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", ""),
		},
	})
}

func TestPushRoutes_Remove(t *testing.T) {
	var aliceID, bobID string
	seed := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		_, a := addDevice(t, app, fx.Alice, "/fcm/send/alice", "fr")
		_, b := addDevice(t, app, fx.Bob, "/fcm/send/bob", "fr")
		aliceID, bobID = a.Id, b.Id
	}
	remaining := func(want int) func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
			if got := count(t, app); got != want {
				t.Errorf("%d subscriptions left, want %d", got, want)
			}
		}
	}
	endpoint := func(p string) func(testutil.Fixture) string {
		return func(testutil.Fixture) string { return jsonOf(map[string]string{"endpoint": fcm + p}) }
	}
	byID := func(id *string) func(testutil.Fixture) string {
		return func(testutil.Fixture) string { return subscriptionsURL + "/" + *id }
	}
	testutil.RunRows(t, []testutil.Row{
		{Name: "a session is needed", As: "anon", Method: http.MethodDelete, URL: at(subscriptionsURL), Before: seed,
			Body: endpoint("/fcm/send/alice"), Status: http.StatusUnauthorized, After: remaining(2)},
		{Name: "by endpoint", As: "alice", Method: http.MethodDelete, URL: at(subscriptionsURL), Before: seed,
			Body: endpoint("/fcm/send/alice"), Status: http.StatusNoContent, After: remaining(1)},
		{Name: "by endpoint, when there is nothing", As: "alice", Method: http.MethodDelete, URL: at(subscriptionsURL), Before: seed,
			Body: endpoint("/fcm/send/nobody"), Status: http.StatusNoContent, After: remaining(2)},
		{Name: "by endpoint, the one of another account stays", As: "alice", Method: http.MethodDelete, URL: at(subscriptionsURL), Before: seed,
			Body: endpoint("/fcm/send/bob"), Status: http.StatusNoContent, After: remaining(2)},
		{Name: "by id", As: "alice", Method: http.MethodDelete, URL: byID(&aliceID), Before: seed,
			Status: http.StatusNoContent, After: remaining(1)},
		{Name: "by id, Bob's is not found", As: "alice", Method: http.MethodDelete, URL: byID(&bobID), Before: seed,
			Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`}, After: remaining(2)},
		{Name: "by id, one that does not exist", As: "alice", Method: http.MethodDelete, URL: at(subscriptionsURL + "/nosuchid000000"), Before: seed,
			Status: http.StatusNotFound, After: remaining(2)},
		{Name: "by id, a session is needed", As: "anon", Method: http.MethodDelete, URL: byID(&aliceID), Before: seed,
			Status: http.StatusUnauthorized, After: remaining(2)},
	})
}

func TestPushRoutes_Renew(t *testing.T) {
	old := newRecipient(t, fcm+"/fcm/send/old")
	fresh := newRecipient(t, fcm+"/fcm/send/new")
	seed := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		record := core.NewRecord(mustCollection(t, app))
		record.Set("user", fx.Alice.Id)
		record.Set("endpoint", old.sub.Endpoint)
		record.Set("p256dh", enc(old.sub.P256dh))
		record.Set("auth", enc(old.sub.Auth))
		record.Set("lang", "en")
		record.Set("label", "Firefox")
		record.Set("failures", 3)
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
	wrongAuth := make([]byte, 16)
	rand.Read(wrongAuth)
	renew := func(oldEndpoint string, oldAuth []byte, endpoint string, p256dh, auth []byte) func(testutil.Fixture) string {
		return func(testutil.Fixture) string {
			return jsonOf(map[string]any{
				"oldEndpoint": oldEndpoint, "oldAuth": enc(oldAuth),
				"endpoint": endpoint, "keys": map[string]string{"p256dh": enc(p256dh), "auth": enc(auth)},
			})
		}
	}
	unchanged := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		d := devicesOf(t, app, fx.Alice)
		if len(d) != 1 || d[0].GetString("endpoint") != old.sub.Endpoint || d[0].GetString("auth") != enc(old.sub.Auth) ||
			d[0].GetString("p256dh") != enc(old.sub.P256dh) || d[0].GetInt("failures") != 3 {
			t.Errorf("the device changed: %d of them", len(d))
		}
	}
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "the right old secret replaces the subscription, with no session", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"),
			Before: seed, Body: renew(old.sub.Endpoint, old.sub.Auth, fresh.sub.Endpoint, fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusOK, Contains: []string{`{"id":"`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				d := devicesOf(t, app, fx.Alice)
				if len(d) != 1 {
					t.Fatalf("%d devices, want 1", len(d))
				}
				if d[0].GetString("endpoint") != fresh.sub.Endpoint || d[0].GetString("p256dh") != enc(fresh.sub.P256dh) ||
					d[0].GetString("auth") != enc(fresh.sub.Auth) || d[0].GetInt("failures") != 0 {
					t.Errorf("the device was not replaced: %v", d[0].FieldsData())
				}
				if d[0].GetString("lang") != "en" || d[0].GetString("label") != "Firefox" {
					t.Error("the language and the label must stay")
				}
			},
		},
		{
			Name: "a wrong secret is a not found", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"), Before: seed,
			Body:   renew(old.sub.Endpoint, wrongAuth, fresh.sub.Endpoint, fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`}, After: unchanged,
		},
		{
			Name: "an empty secret is a not found", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"), Before: seed,
			Body:   renew(old.sub.Endpoint, nil, fresh.sub.Endpoint, fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusNotFound, After: unchanged,
		},
		{
			Name: "an unknown old endpoint is the same not found", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"), Before: seed,
			Body:   renew(fcm+"/fcm/send/unknown", old.sub.Auth, fresh.sub.Endpoint, fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusNotFound, Contains: []string{`"code":"not_found"`}, After: unchanged,
		},
		{
			Name: "a new endpoint outside the allow-list", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"), Before: seed,
			Body:   renew(old.sub.Endpoint, old.sub.Auth, "https://evil.test/x", fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusBadRequest, Contains: []string{`"code":"push_endpoint_invalid"`}, After: unchanged,
		},
		{
			Name: "new keys that are not keys", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"), Before: seed,
			Body:   renew(old.sub.Endpoint, old.sub.Auth, fresh.sub.Endpoint, fresh.sub.P256dh[:64], fresh.sub.Auth),
			Status: http.StatusBadRequest, Contains: []string{field("p256dh", "validation_invalid_value")}, After: unchanged,
		},
		{
			Name: "the new endpoint of another device is refused, and nothing moves", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/renew"),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				seed(t, app, fx)
				other := record2(t, app, fx.Bob, fresh)
				_ = other
			},
			Body:   renew(old.sub.Endpoint, old.sub.Auth, fresh.sub.Endpoint, fresh.sub.P256dh, fresh.sub.Auth),
			Status: http.StatusBadRequest, After: unchanged,
		},
	})
}

// record2 stores a device of the account for the recipient.
func record2(t testing.TB, app *tests.TestApp, user *core.Record, r recipient) *core.Record {
	t.Helper()
	record := core.NewRecord(mustCollection(t, app))
	record.Set("user", user.Id)
	record.Set("endpoint", r.sub.Endpoint)
	record.Set("p256dh", enc(r.sub.P256dh))
	record.Set("auth", enc(r.sub.Auth))
	record.Set("lang", "fr")
	if err := app.Save(record); err != nil {
		t.Fatal(err)
	}
	return record
}

func TestPushRoutes_Test(t *testing.T) {
	var fake *fakePush
	var fr, en recipient
	seed := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		fake = useFake(t, app)
		fr, _ = addDevice(t, app, fx.Alice, "/fcm/send/fr", "fr")
		en, _ = addDevice(t, app, fx.Alice, "/fcm/send/en", "en")
		addDevice(t, app, fx.Bob, "/fcm/send/bob", "fr")
	}
	testutil.RunRows(t, []testutil.Row{
		{Name: "a session is needed", As: "anon", Method: http.MethodPost, URL: at(push.Path + "/test"), Before: seed, Status: http.StatusUnauthorized},
		{
			Name: "it sends to the devices of the caller, each in its language", As: "alice", Method: http.MethodPost, URL: at(push.Path + "/test"),
			Before: seed, Status: http.StatusOK, Contains: []string{`{"sent":2,"failed":0}`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := fake.total(); got != 2 {
					t.Errorf("the push service got %d messages, want 2 (Bob's device must not)", got)
				}
				for _, c := range []struct {
					path string
					r    recipient
					want string
				}{
					{"/fcm/send/fr", fr, "Ceci est un essai : tes rappels arriveront ainsi."},
					{"/fcm/send/en", en, "This is a test: your reminders will arrive like this."},
				} {
					got := fake.received(c.path)
					if len(got) != 1 {
						t.Fatalf("%s: %d messages", c.path, len(got))
					}
					text := string(decrypt(t, c.r.private, c.r.sub.Auth, got[0].Body))
					if !strings.Contains(text, c.want) || !strings.Contains(text, `"title":"Prends ton dossard"`) {
						t.Errorf("%s: the message is %s, want %q", c.path, text, c.want)
					}
				}
			},
		},
		{
			Name: "a device that is gone is counted as failed, and removed", As: "alice", Method: http.MethodPost, URL: at(push.Path + "/test"),
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				seed(t, app, fx)
				fake.answer("/fcm/send/en", http.StatusGone)
			},
			Status: http.StatusOK, Contains: []string{`{"sent":1,"failed":1}`},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				if got := len(devicesOf(t, app, fx.Alice)); got != 1 {
					t.Errorf("%d devices left, want 1", got)
				}
			},
		},
		{
			Name: "without a device nothing is sent", As: "admin", Method: http.MethodPost, URL: at(push.Path + "/test"),
			Before: seed, Status: http.StatusOK, Contains: []string{`{"sent":0,"failed":0}`},
		},
	})
}

func TestPushRoutes_TestOncePer30Seconds(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	fake := useFake(t, app)
	addDevice(t, app, fx.Alice, "/fcm/send/fr", "fr")
	clock := time.Date(2026, 11, 7, 12, 0, 0, 0, time.UTC)
	push.ServiceOf(app).TestClock(func() time.Time { return clock })

	call := func(name string, user *core.Record, status int) {
		t.Helper()
		s := apiScenario(t, app, http.MethodPost, push.Path+"/test", testutil.Token(t, user), "", status)
		s.Name = name
		s.Test(t)
	}
	call("first", fx.Alice, http.StatusOK)
	call("a second one at once", fx.Alice, http.StatusTooManyRequests)
	call("another account is not held back", fx.Bob, http.StatusOK)
	clock = clock.Add(29 * time.Second)
	call("29 seconds later", fx.Alice, http.StatusTooManyRequests)
	clock = clock.Add(2 * time.Second)
	call("31 seconds later", fx.Alice, http.StatusOK)
	if got := fake.total(); got != 2 {
		t.Errorf("the push service got %d messages, want 2: a refused test sends nothing", got)
	}
}

func TestPushRoutes_AbsentOnTheDemo(t *testing.T) {
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)
	token := testutil.Token(t, fx.Alice)
	for _, route := range []struct{ method, path string }{
		{http.MethodGet, push.Path},
		{http.MethodPost, subscriptionsURL},
		{http.MethodDelete, subscriptionsURL},
		{http.MethodDelete, subscriptionsURL + "/someid"},
		{http.MethodPost, push.Path + "/renew"},
		{http.MethodPost, push.Path + "/test"},
	} {
		s := apiScenario(t, app, route.method, route.path, token, "{}", http.StatusNotFound)
		s.Name = route.method + " " + route.path
		s.Test(t)
	}
	if push.ServiceOf(app).Available() {
		t.Error("the demo has notifications")
	}
	if _, err := os.Stat(filepath.Join(app.DataDir(), "push_vapid.json")); err == nil {
		t.Error("the demo made a key file")
	}
}

// A file that is there and cannot be read is not replaced: the notifications
// are unavailable until somebody repairs it.
func TestPushRoutes_BrokenKeysFile(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	file := filepath.Join(app.DataDir(), "push_vapid.json")
	const garbage = "this is not the file of the keys\n"
	if err := os.WriteFile(file, []byte(garbage), 0o600); err != nil {
		t.Fatal(err)
	}
	token := testutil.Token(t, fx.Alice)
	r := newRecipient(t, fcm+"/fcm/send/one")

	list := apiScenario(t, app, http.MethodGet, push.Path, token, "", http.StatusOK, `"available":false`, `"devices":[]`)
	list.NotExpectedContent = []string{"publicKey"}
	list.Name = "the list"
	list.Test(t)

	for _, route := range []struct {
		name, path, payload string
	}{
		{"subscribing", subscriptionsURL, body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "")(testutil.Fixture{})},
		{"the test", push.Path + "/test", ""},
	} {
		s := apiScenario(t, app, http.MethodPost, route.path, token, route.payload, http.StatusServiceUnavailable, `"code":"push_unavailable"`)
		s.Name = route.name
		s.Test(t)
	}

	got, err := os.ReadFile(file)
	if err != nil || string(got) != garbage {
		t.Errorf("the file was touched: %q (%v)", got, err)
	}
	if count(t, app) != 0 {
		t.Error("a subscription was stored without keys")
	}
	if push.ServiceOf(app).Available() {
		t.Error("the service is available with a broken file")
	}
}

// The keys are made at the first start, and kept.
func TestPushRoutes_KeysAreMadeOnce(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := testutil.Token(t, fx.Alice)
	file := filepath.Join(app.DataDir(), "push_vapid.json")
	if _, err := os.Stat(file); err == nil {
		t.Fatal("the keys exist before the first start")
	}
	first := apiScenario(t, app, http.MethodGet, push.Path, token, "", http.StatusOK, `"available":true`)
	first.Test(t)
	made, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("no key file after the first start: %v", err)
	}
	second := apiScenario(t, app, http.MethodGet, push.Path, token, "", http.StatusOK, `"available":true`)
	second.Test(t)
	if again, _ := os.ReadFile(file); string(again) != string(made) {
		t.Error("the key file changed")
	}
	if !push.ServiceOf(app).Available() {
		t.Error("the service is not available")
	}
}
