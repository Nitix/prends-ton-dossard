package weather

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/apis"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
)

// The tests of the package are external ones (testutil imports the setup of the
// application, which imports this package): this file gives them what they
// need.

// SetNow makes the package read at as the time, until the test ends.
func SetNow(t testing.TB, at time.Time) {
	t.Helper()
	old := now
	now = func() time.Time { return at }
	t.Cleanup(func() { now = old })
}

// UseServer points the two addresses of Open-Meteo at srv (the forecast at
// /v1/forecast, the geocoding at /v1/search) and gives the package a client that
// reaches it: the one of the program, but for the guard that refuses the
// loopback address, until the test ends.
func UseServer(t testing.TB, srv *httptest.Server) {
	t.Helper()
	oldForecast, oldGeocoding, oldClient := forecastURL, geocodingURL, client
	forecastURL = srv.URL + "/v1/forecast"
	geocodingURL = srv.URL + "/v1/search"
	real := newClient()
	client = &http.Client{Timeout: real.Timeout, CheckRedirect: real.CheckRedirect}
	t.Cleanup(func() { forecastURL, geocodingURL, client = oldForecast, oldGeocoding, oldClient })
}

// UseRealClient points the addresses at srv but keeps the client of the program,
// guard included.
func UseRealClient(t testing.TB, srv *httptest.Server) {
	t.Helper()
	oldForecast, oldGeocoding, oldClient := forecastURL, geocodingURL, client
	forecastURL = srv.URL + "/v1/forecast"
	geocodingURL = srv.URL + "/v1/search"
	client = newClient()
	t.Cleanup(func() { forecastURL, geocodingURL, client = oldForecast, oldGeocoding, oldClient })
}

// RealClient is a client as the program makes it.
func RealClient() *http.Client { return newClient() }

// RequestTimeout is the timeout of a call.
const RequestTimeout = requestTimeout

// SetBudget lowers the calls an hour until the test ends.
func SetBudget(t testing.TB, n int) {
	t.Helper()
	old := budgetPerHour
	budgetPerHour = n
	t.Cleanup(func() { budgetPerHour = old })
}

// FirstPoint is firstPoint.
var FirstPoint = firstPoint

// MaxTrackRead is how much of a track is read.
const MaxTrackRead = maxTrackRead

// The bounded cache, of strings.
type StringCache = cache[string]

func NewStringCache(max int) *StringCache { return newCache[string](max) }

func PutString(c *StringCache, key, value string) { c.put(key, value, time.Hour) }

func GetString(c *StringCache, key string) (string, bool) {
	e, ok := c.get(key)
	return e.value, ok
}

func LenString(c *StringCache) int { return c.len() }

// CacheMax is the bound of each cache.
const CacheMax = cacheMax

// Serve does what the start of the server does to the handlers of OnServe and
// returns the handler of the router.
func Serve(t testing.TB, app core.App) http.Handler {
	t.Helper()
	router, err := apis.NewRouter(app)
	if err != nil {
		t.Fatal(err)
	}
	event := &core.ServeEvent{App: app, Router: router}
	if err := app.OnServe().Trigger(event, func(*core.ServeEvent) error { return nil }); err != nil {
		t.Fatal(err)
	}
	app.Cron().Stop()
	mux, err := router.BuildMux()
	if err != nil {
		t.Fatal(err)
	}
	return mux
}

// The locks of a key.
type KeyLocks = keyLocks

func LockKey(ctx context.Context, k *KeyLocks, key string) (func(), error) { return k.lock(ctx, key) }

// FailureTTL is how long a failed call is remembered.
const FailureTTL = failureTTL

// SetTimeout shortens the timeout of the client that the test installed.
func SetTimeout(t testing.TB, d time.Duration) {
	t.Helper()
	old := client.Timeout
	client.Timeout = d
	t.Cleanup(func() { client.Timeout = old })
}

// SetDayBudget lowers the calls a day (of a normal instance, then of a demo)
// until the test ends.
func SetDayBudget(t testing.TB, normal, demo int) {
	t.Helper()
	oldN, oldD := budgetPerDay, demoBudgetPerDay
	budgetPerDay, demoBudgetPerDay = normal, demo
	t.Cleanup(func() { budgetPerDay, demoBudgetPerDay = oldN, oldD })
}

// DayBudgets are the caps of a day as the program has them (normal, demo).
func DayBudgets() (normal, demo int) { return budgetPerDay, demoBudgetPerDay }
