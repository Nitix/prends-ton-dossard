package weather

import (
	"net/http"
	"time"
)

// Override is for the tests of the packages that use the weather (the MCP
// tools): the program never calls it. It points the two addresses of Open-Meteo
// at a test server, gives the package a client that reaches it (the one of the
// program, but for the guard against a loopback address) and, when at is not
// nil, its clock. It returns what puts everything back.
//
// The tests of this package use export_test.go instead.
func Override(forecast, geocoding string, at func() time.Time) (restore func()) {
	oldForecast, oldGeocoding, oldClient, oldNow := forecastURL, geocodingURL, client, now
	forecastURL, geocodingURL = forecast, geocoding
	real := newClient()
	client = &http.Client{Timeout: real.Timeout, CheckRedirect: real.CheckRedirect}
	if at != nil {
		now = at
	}
	return func() { forecastURL, geocodingURL, client, now = oldForecast, oldGeocoding, oldClient, oldNow }
}
