package push_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/push"
	"courses/server/testutil"
)

func TestPush_TenDevices(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	addDevice(t, app, fx.Bob, "/fcm/send/bob", "fr")

	var ids []string
	for i := range 10 {
		_, d := addDevice(t, app, fx.Alice, "/fcm/send/alice-"+string(rune('a'+i)), "fr")
		ids = append(ids, d.Id)
		time.Sleep(3 * time.Millisecond) // distinct dates of update
	}
	if got := len(devicesOf(t, app, fx.Alice)); got != 10 {
		t.Fatalf("%d devices, want 10", got)
	}

	// The eleventh replaces the oldest.
	_, eleventh := addDevice(t, app, fx.Alice, "/fcm/send/alice-k", "fr")
	got := devicesOf(t, app, fx.Alice)
	if len(got) != 10 {
		t.Fatalf("%d devices after the eleventh, want 10", len(got))
	}
	have := map[string]bool{}
	for _, d := range got {
		have[d.Id] = true
	}
	if have[ids[0]] {
		t.Error("the oldest device is still there")
	}
	for _, id := range append(ids[1:], eleventh.Id) {
		if !have[id] {
			t.Errorf("device %s was removed, only the oldest should be", id)
		}
	}
	if got := len(devicesOf(t, app, fx.Bob)); got != 1 {
		t.Errorf("Bob has %d devices, want 1: the limit is per account", got)
	}

	// The oldest is the one that was updated least recently, not the first made.
	time.Sleep(3 * time.Millisecond)
	touched := mustFind(t, app, ids[1])
	touched.Set("label", "used again")
	if err := app.Save(touched); err != nil {
		t.Fatal(err)
	}
	time.Sleep(3 * time.Millisecond)
	addDevice(t, app, fx.Alice, "/fcm/send/alice-l", "fr")
	left := map[string]bool{}
	for _, d := range devicesOf(t, app, fx.Alice) {
		left[d.Id] = true
	}
	if left[ids[2]] || !left[ids[1]] {
		t.Errorf("after an update of the second and a new one: the third is %v, the second %v; want the third gone and the second kept", left[ids[2]], left[ids[1]])
	}

	// A device that moves to an account that is full counts too.
	for i := range 9 {
		addDevice(t, app, fx.Bob, "/fcm/send/bob-"+string(rune('a'+i)), "fr")
		time.Sleep(3 * time.Millisecond)
	}
	if got := len(devicesOf(t, app, fx.Bob)); got != 10 {
		t.Fatalf("Bob has %d devices, want 10", got)
	}
	moved := devicesOf(t, app, fx.Alice)[0]
	moved.Set("user", fx.Bob.Id)
	if err := app.Save(moved); err != nil {
		t.Fatal(err)
	}
	if got := len(devicesOf(t, app, fx.Bob)); got != 10 {
		t.Errorf("Bob has %d devices after one moved to him, want 10", got)
	}
	if got := mustFind2(app, moved.Id); got == nil {
		t.Error("the device that moved was the one removed")
	}
}

func mustFind(t testing.TB, app core.App, id string) *core.Record {
	t.Helper()
	r, err := app.FindRecordById("push_subscriptions", id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func mustFind2(app core.App, id string) *core.Record {
	r, _ := app.FindRecordById("push_subscriptions", id)
	return r
}

// The eleventh through the route replaces the oldest too.
func TestPush_TenDevicesThroughTheRoute(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	for i := range 10 {
		addDevice(t, app, fx.Alice, "/fcm/send/alice-"+string(rune('a'+i)), "fr")
		time.Sleep(3 * time.Millisecond)
	}
	oldest := devicesOf(t, app, fx.Alice)[0]
	for _, d := range devicesOf(t, app, fx.Alice) {
		if d.GetDateTime("updated").Time().Before(oldest.GetDateTime("updated").Time()) {
			oldest = d
		}
	}
	r := newRecipient(t, fcm+"/fcm/send/the-eleventh")
	s := apiScenario(t, app, http.MethodPost, push.Path+"/subscriptions", testutil.Token(t, fx.Alice),
		body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "")(testutil.Fixture{}), http.StatusOK, `{"id":"`)
	s.Test(t)
	got := devicesOf(t, app, fx.Alice)
	if len(got) != 10 {
		t.Fatalf("%d devices, want 10", len(got))
	}
	if mustFind2(app, oldest.Id) != nil {
		t.Error("the oldest device is still there")
	}
}

func TestPush_DisabledAccountLosesItsDevices(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	addDevice(t, app, fx.Alice, "/fcm/send/a1", "fr")
	addDevice(t, app, fx.Alice, "/fcm/send/a2", "en")
	addDevice(t, app, fx.Bob, "/fcm/send/b1", "fr")

	// An update that does not disable leaves them.
	alice := mustFindUser(t, app, fx.Alice.Id)
	alice.Set("skin", alice.GetString("skin"))
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	if got := len(devicesOf(t, app, fx.Alice)); got != 2 {
		t.Fatalf("%d devices after an update that keeps the account, want 2", got)
	}

	alice.Set("disabled", true)
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	if got := len(devicesOf(t, app, fx.Alice)); got != 0 {
		t.Errorf("a disabled account has %d devices, want none", got)
	}
	if got := len(devicesOf(t, app, fx.Bob)); got != 1 {
		t.Errorf("Bob has %d devices, want 1", got)
	}

	// They do not come back when the account is enabled again.
	alice.Set("disabled", false)
	if err := app.Save(alice); err != nil {
		t.Fatal(err)
	}
	if got := len(devicesOf(t, app, fx.Alice)); got != 0 {
		t.Errorf("an enabled account has %d devices, want none", got)
	}
}

func mustFindUser(t testing.TB, app core.App, id string) *core.Record {
	t.Helper()
	r, err := app.FindRecordById("users", id)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func TestService_SendToUser(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	// The logs are off in a test application, and Debug is not kept: turn both
	// on, as they would be for a person who looks into a problem.
	app.Settings().Logs.MaxDays = 5
	app.Settings().Logs.MinLevel = -4
	if err := app.Save(app.Settings()); err != nil {
		t.Fatal(err)
	}
	fake := useFake(t, app)
	svc := push.ServiceOf(app)
	svc.Load(app)

	if !svc.Available() {
		t.Fatal("the service is not available")
	}
	type device struct {
		path, lang string
		failures   int
		status     int
	}
	devices := []device{
		{"/fcm/send/SECRETPATH-fr", "fr", 4, http.StatusCreated},
		{"/fcm/send/SECRETPATH-en", "en", 0, http.StatusOK},
		{"/fcm/send/SECRETPATH-gone", "fr", 2, http.StatusGone},
		{"/fcm/send/SECRETPATH-notfound", "fr", 0, http.StatusNotFound},
		{"/fcm/send/SECRETPATH-refused", "fr", 3, http.StatusForbidden},
		{"/fcm/send/SECRETPATH-toobig", "en", 0, http.StatusRequestEntityTooLarge},
		{"/fcm/send/SECRETPATH-busy", "fr", 0, http.StatusTooManyRequests},
		{"/fcm/send/SECRETPATH-down", "fr", 5, http.StatusBadGateway},
		{"/fcm/send/SECRETPATH-ninth", "fr", 9, http.StatusServiceUnavailable},
		{"/fcm/send/SECRETPATH-tenth", "en", 8, http.StatusForbidden},
	}
	recipients := map[string]recipient{}
	for _, d := range devices {
		r, record := addDevice(t, app, fx.Alice, d.path, d.lang)
		record.Set("failures", d.failures)
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
		recipients[d.path] = r
		fake.answer(d.path, d.status)
	}
	// Bob's device is not Alice's business.
	addDevice(t, app, fx.Bob, "/fcm/send/SECRETPATH-bob", "fr")

	message := func(lang string) push.Message {
		if lang == "en" {
			return push.Message{Title: "Registration opens", Body: "in one hour", URL: "/evenements/abc", Tag: "opening-abc"}
		}
		return push.Message{Title: "Ouverture", Body: "dans une heure", URL: "/evenements/abc", Tag: "opening-abc"}
	}
	got, err := svc.SendToUser(context.Background(), app, fx.Alice.Id, message,
		push.Options{TTL: time.Hour, Urgency: "high", Topic: "opening-abc"})
	if err != nil {
		t.Fatal(err)
	}
	// Delivered: the two first. The other eight did not take it.
	if want := (push.Delivery{Sent: 2, Failed: 8}); got != want {
		t.Errorf("delivery = %+v, want %+v", got, want)
	}
	if n := fake.total(); n != 10 {
		t.Errorf("the push service got %d messages, want 10 (one per device of Alice)", n)
	}

	stored := map[string]*core.Record{}
	for _, d := range devicesOf(t, app, fx.Alice) {
		stored[strings.TrimPrefix(d.GetString("endpoint"), fcm)] = d
	}
	// Delivered: the date, and no failure.
	for _, path := range []string{"/fcm/send/SECRETPATH-fr", "/fcm/send/SECRETPATH-en"} {
		d := stored[path]
		if d == nil || d.GetInt("failures") != 0 || d.GetDateTime("last_success_at").IsZero() {
			t.Errorf("%s: a delivered device holds %v, want failures 0 and a date", path, d)
		}
	}
	// Gone: deleted at once.
	for _, path := range []string{"/fcm/send/SECRETPATH-gone", "/fcm/send/SECRETPATH-notfound"} {
		if stored[path] != nil {
			t.Errorf("%s: a device that is gone is still there", path)
		}
	}
	// Refused or failed: one more failure, the date untouched.
	for path, want := range map[string]int{
		"/fcm/send/SECRETPATH-refused": 4, "/fcm/send/SECRETPATH-toobig": 1,
		"/fcm/send/SECRETPATH-busy": 1, "/fcm/send/SECRETPATH-down": 6,
	} {
		d := stored[path]
		if d == nil || d.GetInt("failures") != want || !d.GetDateTime("last_success_at").IsZero() {
			t.Errorf("%s: holds %v, want failures %d and no date", path, d, want)
		}
	}
	// Ten failures in a row: deleted. One at 9 that fails again is the tenth.
	if stored["/fcm/send/SECRETPATH-ninth"] != nil {
		t.Error("a device at 9 failures that fails again is still there")
	}
	if d := stored["/fcm/send/SECRETPATH-tenth"]; d == nil || d.GetInt("failures") != 9 {
		t.Errorf("a device at 8 failures that fails again holds %v, want 9", d)
	}
	if n := len(devicesOf(t, app, fx.Bob)); n != 1 {
		t.Errorf("Bob has %d devices, want 1", n)
	}

	// Each device gets its own language, in the encrypted body; the headers ask
	// what the sender is told.
	for path, want := range map[string]string{
		"/fcm/send/SECRETPATH-fr": `"title":"Ouverture"`, "/fcm/send/SECRETPATH-en": `"title":"Registration opens"`,
	} {
		r := recipients[path]
		seen := fake.received(path)
		if len(seen) != 1 {
			t.Fatalf("%s: %d messages", path, len(seen))
		}
		plain := string(decrypt(t, r.private, r.sub.Auth, seen[0].Body))
		var payload map[string]string
		if err := json.Unmarshal([]byte(plain), &payload); err != nil {
			t.Fatalf("%s: the message is not JSON: %v", path, err)
		}
		if !strings.Contains(plain, want) || payload["url"] != "/evenements/abc" || payload["tag"] != "opening-abc" {
			t.Errorf("%s: the message is %s", path, plain)
		}
		h := seen[0].Headers
		if h.Get("Urgency") != "high" || h.Get("Topic") != "opening-abc" || h.Get("TTL") != "3600" {
			t.Errorf("%s: headers Urgency %q, Topic %q, TTL %q", path, h.Get("Urgency"), h.Get("Topic"), h.Get("TTL"))
		}
	}

	// A person without a device: nothing to send, no error.
	if again, err := svc.SendToUser(context.Background(), app, fx.Admin.Id, message, push.Options{TTL: time.Hour}); err != nil || again != (push.Delivery{}) {
		t.Errorf("a person without a device: %+v, %v", again, err)
	}

	// The log, at Debug level, holds no endpoint, no key, no message.
	logs := testutil.RequestLogs(t, app, 1)
	keyFile, err := os.ReadFile(filepath.Join(app.DataDir(), "push_vapid.json"))
	if err != nil {
		t.Fatal(err)
	}
	var keys struct{ PrivateKey, PublicKey string }
	_ = json.Unmarshal(keyFile, &keys)
	secrets := []string{"SECRETPATH", "fcm.googleapis.com", keys.PrivateKey, "dans une heure", "Registration opens"}
	for _, r := range recipients {
		secrets = append(secrets, enc(r.sub.Auth), enc(r.sub.P256dh))
	}
	var reached bool
	for _, entry := range logs {
		data, _ := json.Marshal(entry.Data)
		text := entry.Message + " " + string(data)
		if strings.Contains(entry.Message, "push: devices reached") {
			reached = true
		}
		for _, secret := range secrets {
			if secret != "" && strings.Contains(text, secret) {
				t.Errorf("the log holds %q in %s", secret, text)
			}
		}
	}
	if !reached {
		t.Error("the log has no line for the sending: the check above would pass on nothing")
	}
}

// With no keys, nothing is sent and the caller is told.
func TestService_SendToUser_Unavailable(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	if err := os.WriteFile(filepath.Join(app.DataDir(), "push_vapid.json"), []byte("garbage"), 0o600); err != nil {
		t.Fatal(err)
	}
	fake := useFake(t, app)
	svc := push.ServiceOf(app)
	svc.Load(app)
	addDevice(t, app, fx.Alice, "/fcm/send/a", "fr")

	got, err := svc.SendToUser(context.Background(), app, fx.Alice.Id, func(string) push.Message { return push.Message{} }, push.Options{TTL: time.Hour})
	if !errors.Is(err, push.ErrUnavailable) || got != (push.Delivery{}) {
		t.Errorf("SendToUser = %+v, %v; want nothing and ErrUnavailable", got, err)
	}
	if fake.total() != 0 {
		t.Error("something was sent without keys")
	}
	if len(devicesOf(t, app, fx.Alice)) != 1 {
		t.Error("the device was touched")
	}
}

// A message refused before any request (a bad option, a key that cannot be
// used) is not the device answering: no failure counted, nothing deleted. A key
// that cannot be decoded never will be: that device is deleted.
func TestService_SendToUser_RefusedBeforeTheRequest(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	fake := useFake(t, app)
	svc := push.ServiceOf(app)
	svc.Load(app)
	_, good := addDevice(t, app, fx.Alice, "/fcm/send/good", "fr")
	_, broken := addDevice(t, app, fx.Alice, "/fcm/send/broken", "fr")
	for _, d := range []*core.Record{good, broken} {
		d.Set("failures", 9)
		if d == broken {
			d.Set("p256dh", "***not base64***")
		}
		if err := app.Save(d); err != nil {
			t.Fatal(err)
		}
	}
	message := func(string) push.Message { return push.Message{Title: "x"} }

	got, err := svc.SendToUser(context.Background(), app, fx.Alice.Id, message, push.Options{TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if want := (push.Delivery{Sent: 1, Failed: 1}); got != want {
		t.Errorf("delivery = %+v, want %+v", got, want)
	}
	if fake.total() != 1 {
		t.Errorf("%d requests, want 1: the broken key sends nothing", fake.total())
	}
	if d := mustFind2(app, broken.Id); d != nil {
		t.Errorf("the device with the broken key holds %v, want it deleted", d)
	}

	// A TTL under a minute is refused by the sender for every device.
	got, err = svc.SendToUser(context.Background(), app, fx.Alice.Id, message, push.Options{TTL: time.Second})
	if err != nil {
		t.Fatal(err)
	}
	if want := (push.Delivery{Sent: 0, Failed: 1}); got != want {
		t.Errorf("delivery = %+v, want %+v", got, want)
	}
	if fake.total() != 1 {
		t.Error("a request was made with a bad TTL")
	}
	// The good one was reset by the first delivery and the refused option leaves it.
	if stored := mustFind2(app, good.Id); stored == nil || stored.GetInt("failures") != 0 {
		t.Errorf("the device holds %v after a refused option, want it kept with 0 failures", stored)
	}
}

// A request that our own context ends (the page closed, the time out) says
// nothing about the device: no failure, no deletion, neither sent nor failed.
func TestService_SendToUser_CancelledIsNotAFailure(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	fake := useFake(t, app)
	svc := push.ServiceOf(app)
	svc.Load(app)
	_, device := addDevice(t, app, fx.Alice, "/fcm/send/a", "fr")
	device.Set("failures", 9)
	if err := app.Save(device); err != nil {
		t.Fatal(err)
	}
	message := func(string) push.Message { return push.Message{Title: "x"} }

	ctx, cancel := context.WithCancel(context.Background())
	fake.answer("/fcm/send/a", http.StatusInternalServerError)
	fake.whenReached("/fcm/send/a", cancel)
	got, err := svc.SendToUser(ctx, app, fx.Alice.Id, message, push.Options{TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	if got != (push.Delivery{}) {
		t.Errorf("delivery = %+v, want nothing counted", got)
	}
	if d := mustFind2(app, device.Id); d == nil || d.GetInt("failures") != 9 {
		t.Errorf("the device holds %v after a cancelled sending, want it kept at 9 failures", d)
	}

	// The time out of a context is the same.
	ctx, cancel = context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	fake.answer("/fcm/send/a", http.StatusCreated)
	fake.whenReached("/fcm/send/a", func() { time.Sleep(300 * time.Millisecond) })
	got, err = svc.SendToUser(ctx, app, fx.Alice.Id, message, push.Options{TTL: time.Hour})
	if err != nil || got != (push.Delivery{}) {
		t.Errorf("after a time out: %+v, %v; want nothing counted", got, err)
	}
	if d := mustFind2(app, device.Id); d == nil || d.GetInt("failures") != 9 {
		t.Errorf("the device holds %v after a time out, want it kept at 9 failures", d)
	}
}

// The devices of an account are sent to together: a push service that is slow
// holds the sending for its own time, not for the sum of ten.
func TestService_SendToUser_Together(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	fake := useFake(t, app)
	svc := push.ServiceOf(app)
	svc.Load(app)
	const devices = 8
	for i := range devices {
		path := "/fcm/send/slow" + string(rune('a'+i))
		addDevice(t, app, fx.Alice, path, "fr")
		fake.whenReached(path, func() { time.Sleep(400 * time.Millisecond) })
	}
	start := time.Now()
	got, err := svc.SendToUser(context.Background(), app, fx.Alice.Id,
		func(string) push.Message { return push.Message{Title: "x"} }, push.Options{TTL: time.Hour})
	took := time.Since(start)
	if err != nil || got != (push.Delivery{Sent: devices}) {
		t.Fatalf("SendToUser = %+v, %v", got, err)
	}
	// One after the other it would be 3.2 s.
	if took > 2*time.Second {
		t.Errorf("sending to %d slow devices took %v, want them in parallel", devices, took)
	}
}

// A device that is renewed while a message is on its way keeps its new
// subscription: the outcome of the old one touches neither its values nor its row.
func TestService_SendToUser_RenewedDuringTheSending(t *testing.T) {
	for _, status := range []int{http.StatusGone, http.StatusCreated, http.StatusForbidden} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			app := testutil.NewApp(t)
			fx := testutil.Seed(t, app)
			fake := useFake(t, app)
			svc := push.ServiceOf(app)
			svc.Load(app)
			_, device := addDevice(t, app, fx.Alice, "/fcm/send/old", "fr")
			fake.answer("/fcm/send/old", status)
			fake.whenReached("/fcm/send/old", func() {
				renewed, err := app.FindRecordById("push_subscriptions", device.Id)
				if err != nil {
					t.Error(err)
					return
				}
				renewed.Set("endpoint", fcm+"/fcm/send/new")
				renewed.Set("p256dh", "NEWP256DH")
				if err := app.Save(renewed); err != nil {
					t.Error(err)
				}
			})
			if _, err := svc.SendToUser(context.Background(), app, fx.Alice.Id,
				func(string) push.Message { return push.Message{Title: "x"} }, push.Options{TTL: time.Hour}); err != nil {
				t.Fatal(err)
			}
			d := mustFind2(app, device.Id)
			if d == nil {
				t.Fatal("the renewed device was deleted")
			}
			if d.GetString("endpoint") != fcm+"/fcm/send/new" || d.GetString("p256dh") != "NEWP256DH" {
				t.Errorf("the renewed device was written back with its old values: %q", strings.TrimPrefix(d.GetString("endpoint"), fcm))
			}
			if d.GetInt("failures") != 0 || !d.GetDateTime("last_success_at").IsZero() {
				t.Errorf("the outcome of the old subscription was counted on the new one: failures %d, date %v",
					d.GetInt("failures"), d.GetDateTime("last_success_at"))
			}
		})
	}
}

// The save, the count and the drop of the oldest commit together: if the drop
// fails, the new device is not stored behind an error.
func TestPush_TenDevicesThroughTheRoute_DropFailsRollsBack(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	for i := range 10 {
		addDevice(t, app, fx.Alice, "/fcm/send/alice-"+string(rune('a'+i)), "fr")
	}
	app.OnRecordDelete("push_subscriptions").BindFunc(func(*core.RecordEvent) error {
		return errors.New("the delete is refused")
	})
	r := newRecipient(t, fcm+"/fcm/send/the-eleventh")
	s := apiScenario(t, app, http.MethodPost, push.Path+"/subscriptions", testutil.Token(t, fx.Alice),
		body(r.sub.Endpoint, r.sub.P256dh, r.sub.Auth, "fr", "")(testutil.Fixture{}), http.StatusInternalServerError)
	s.Test(t)
	if got := count(t, app); got != 10 {
		t.Errorf("%d devices after a drop that failed, want the 10 of before: the new one must not stay", got)
	}
	if _, err := app.FindFirstRecordByData("push_subscriptions", "endpoint", r.sub.Endpoint); err == nil {
		t.Error("the new device was stored although the request failed")
	}
}

// The seam that finds the service of an application does not keep the
// application of a test that is over.
func TestServiceOf_ForgetsAnEndedApp(t *testing.T) {
	var app core.App
	t.Run("a test", func(t *testing.T) {
		app = testutil.NewApp(t)
		if push.ServiceOf(app) == nil {
			t.Fatal("no service while the test runs")
		}
	})
	if push.ServiceOf(app) != nil {
		t.Error("the service of an application that was cleaned up is still kept")
	}
}
