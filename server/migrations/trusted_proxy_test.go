package migrations_test

import (
	"net/http"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

func TestMigrations_TrustedProxy(t *testing.T) {
	proxy := testutil.NewApp(t).Settings().TrustedProxy

	if !slices.Equal(proxy.Headers, []string{"X-Forwarded-For"}) {
		t.Errorf("trusted proxy headers = %q, want [X-Forwarded-For]", proxy.Headers)
	}
	// The rightmost address is the one the proxy appended: a client cannot
	// pick its own by sending the header along.
	if proxy.UseLeftmostIP {
		t.Error("UseLeftmostIP must stay false")
	}
}

// RealIP is what the rate limiter keys on. Behind the reverse proxy it must be
// the address in X-Forwarded-For, not the one of the connection.
func TestMigrations_TrustedProxyRealIP(t *testing.T) {
	scenarios := []struct {
		name, forwardedFor, want string
	}{
		{"the forwarded address", "203.0.113.7", "203.0.113.7"},
		// A header that the client sent along comes first; the proxy appends.
		{"the rightmost address", "198.51.100.9, 203.0.113.7", "203.0.113.7"},
		// httptest connections come from this address.
		{"no header: the connection", "", "192.0.2.1"},
	}

	for _, s := range scenarios {
		headers := map[string]string{}
		if s.forwardedFor != "" {
			headers["X-Forwarded-For"] = s.forwardedFor
		}
		(&tests.ApiScenario{
			Name:            s.name,
			Method:          http.MethodGet,
			URL:             "/test/real-ip",
			Headers:         headers,
			ExpectedStatus:  http.StatusOK,
			ExpectedContent: []string{"ip=" + s.want + ";"},
			TestAppFactory:  func(tb testing.TB) *tests.TestApp { return testutil.NewApp(tb) },
			BeforeTestFunc: func(_ testing.TB, _ *tests.TestApp, e *core.ServeEvent) {
				e.Router.GET("/test/real-ip", func(re *core.RequestEvent) error {
					return re.String(http.StatusOK, "ip="+re.RealIP()+";")
				})
			},
		}).Test(t)
	}
}

// Behind the proxy, two visitors must not share a rate limit bucket: one that
// runs out of requests must not lock the others out.
func TestMigrations_TrustedProxyRateLimitPerClient(t *testing.T) {
	app := testutil.NewApp(t)

	// The invitation routes allow 10 requests a minute (ourRateLimitRules).
	const allowed = 10
	send := func(name, forwardedFor string, status int, content string) {
		t.Helper()
		(&tests.ApiScenario{
			Name:                  name,
			Method:                http.MethodPost,
			URL:                   "/api/app/invitations/lookup",
			Body:                  strings.NewReader(`{}`),
			Headers:               map[string]string{"X-Forwarded-For": forwardedFor},
			ExpectedStatus:        status,
			ExpectedContent:       []string{content},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
		}).Test(t)
	}

	// An unknown invitation is a 404: the request got through the limiter.
	const passed, limited = `invitation_invalid`, `Too Many Requests`

	for range allowed {
		send("first visitor, within the limit", "203.0.113.7", http.StatusNotFound, passed)
	}
	send("first visitor, over the limit", "203.0.113.7", http.StatusTooManyRequests, limited)
	send("second visitor, own bucket", "198.51.100.9", http.StatusNotFound, passed)
}

// Caddyfile.example keeps the dashboard and the superuser API off the
// internet. PocketBase also takes a collection by its id in the URL, so the
// block names the id of _superusers too: this checks that it is the right one.
func TestCaddyfileExample_HidesTheSuperusers(t *testing.T) {
	superusers, err := testutil.NewApp(t).FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	caddyfile, err := os.ReadFile(filepath.Join("..", "..", "Caddyfile.example"))
	if err != nil {
		t.Fatal(err)
	}

	for _, path := range []string{
		"/_/*",
		"/api/collections/" + core.CollectionNameSuperusers + "/*",
		"/api/collections/" + superusers.Id + "/*",
	} {
		if !strings.Contains(string(caddyfile), " "+path) {
			t.Errorf("Caddyfile.example does not block %s", path)
		}
	}
}
