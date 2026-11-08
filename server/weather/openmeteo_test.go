package weather_test

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"slices"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"courses/server/testutil"
	"courses/server/weather"
)

func keysOf(q url.Values) []string {
	var keys []string
	for k := range q {
		keys = append(keys, k)
	}
	slices.Sort(keys)
	return keys
}

func TestWeather_SendsOnlyPlaceAndDays(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	// The names of the race, of who goes and of whoever asks are in the database.
	w.setLocation(t, "Annecy")

	a := w.answer(t, w.fx.Event.Id)
	if a.Status != "ok" {
		t.Fatalf("status %q", a.Status)
	}

	geo := w.meteo.last("/v1/search")
	if got, want := keysOf(geo.Query), []string{"count", "format", "language", "name"}; !slices.Equal(got, want) {
		t.Errorf("the geocoding parameters are %v, want %v", got, want)
	}
	for k, want := range map[string]string{"name": "Annecy", "count": "1", "language": "fr", "format": "json"} {
		if got := geo.Query.Get(k); got != want {
			t.Errorf("geocoding %s = %q, want %q", k, got, want)
		}
	}

	fc := w.meteo.last("/v1/forecast")
	if got, want := keysOf(fc.Query), []string{"daily", "end_date", "latitude", "longitude", "start_date", "timezone"}; !slices.Equal(got, want) {
		t.Errorf("the forecast parameters are %v, want %v", got, want)
	}
	for k, want := range map[string]string{
		"latitude": "45.90", "longitude": "6.13", "timezone": "auto", "start_date": "2026-06-13", "end_date": "2026-06-14",
		"daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max",
	} {
		if got := fc.Query.Get(k); got != want {
			t.Errorf("forecast %s = %q, want %q", k, got, want)
		}
	}

	for _, r := range w.meteo.all() {
		for _, h := range []string{"Cookie", "Authorization", "Referer", "Origin"} {
			if r.Header.Get(h) != "" {
				t.Errorf("%s carried a %s header", r.Path, h)
			}
		}
		if got, want := r.Header.Get("User-Agent"), "prends-ton-dossard (+http://localhost:5173)"; got != want {
			t.Errorf("User-Agent = %q, want %q", got, want)
		}
		dump := r.Raw + r.Header.Get("User-Agent")
		for _, secret := range []string{"Crêtes", "Cr%C3%AAtes", "Trail", "Alice", "Bob", "Sam", w.fx.Event.Id, w.token} {
			if strings.Contains(dump, secret) {
				t.Errorf("%s carried %q", r.Path, secret)
			}
		}
	}
}

func TestWeather_SendsTheAltitudeOfATrackOnly(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.track(t, w.fx.F42, gpxAt(45.9012, 6.1234, "476.3"))
	w.answer(t, w.fx.Event.Id)
	if n := w.meteo.count("/v1/search"); n != 0 {
		t.Errorf("a track gives the place: %d geocoding requests", n)
	}
	fc := w.meteo.last("/v1/forecast")
	if got, want := keysOf(fc.Query), []string{"daily", "elevation", "end_date", "latitude", "longitude", "start_date", "timezone"}; !slices.Equal(got, want) {
		t.Errorf("the forecast parameters are %v, want %v", got, want)
	}
	if fc.Query.Get("elevation") != "500" || fc.Query.Get("latitude") != "45.90" || fc.Query.Get("longitude") != "6.12" {
		t.Errorf("the forecast is for %v", fc.Query)
	}
}

func TestWeather_Geocoding(t *testing.T) {
	setup := func(t *testing.T, location string, known ...string) *world {
		w := newWorld(t, "2026-06-10")
		w.meteo.places = map[string][2]float64{}
		for _, k := range known {
			w.meteo.places[k] = [2]float64{45.8, 6.2}
		}
		w.setLocation(t, location)
		return w
	}

	t.Run("the whole text first", func(t *testing.T) {
		w := setup(t, "Lac d'Annecy, Sevrier", "lac d'annecy, sevrier")
		a := w.answer(t, w.fx.Event.Id)
		if a.Status != "ok" || a.Place == nil || a.Place.Source != "place" || a.Place.Name != "Annecy" || a.Place.Detail != "Auvergne-Rhône-Alpes, France" {
			t.Errorf("answer %+v %+v", a, a.Place)
		}
		if got := w.meteo.names(); !slices.Equal(got, []string{"Lac d'Annecy, Sevrier"}) {
			t.Errorf("asked %q", got)
		}
	})

	t.Run("then its parts, the last first", func(t *testing.T) {
		w := setup(t, "Lac d'Annecy, Sevrier", "sevrier")
		if a := w.answer(t, w.fx.Event.Id); a.Status != "ok" {
			t.Errorf("status %q", a.Status)
		}
		if got := w.meteo.names(); !slices.Equal(got, []string{"Lac d'Annecy, Sevrier", "Sevrier"}) {
			t.Errorf("asked %q", got)
		}
	})

	t.Run("three tries at most", func(t *testing.T) {
		w := setup(t, "A, B, C, D", "a")
		a := w.answer(t, w.fx.Event.Id)
		if a.Status != "no_place" || a.Query != "A, B, C, D" || a.Place != nil || len(a.Days) != 0 {
			t.Errorf("answer %+v", a)
		}
		if got := w.meteo.names(); !slices.Equal(got, []string{"A, B, C, D", "D", "C"}) {
			t.Errorf("asked %q", got)
		}
		if n := w.meteo.count("/v1/forecast"); n != 0 {
			t.Errorf("%d forecast requests for no place", n)
		}
	})

	t.Run("the text of a member is encoded, not read as parameters", func(t *testing.T) {
		const text = `Annecy&units=imperial#x "é"`
		w := setup(t, text)
		w.answer(t, w.fx.Event.Id)
		first := w.meteo.all()[0]
		if got, want := keysOf(first.Query), []string{"count", "format", "language", "name"}; !slices.Equal(got, want) {
			t.Errorf("parameters %v (the text was read as some), want %v", got, want)
		}
		if first.Query.Get("name") != text {
			t.Errorf("name = %q, want the whole text", first.Query.Get("name"))
		}
	})
}

// The client of the program, not the one of the tests.
func TestWeather_Client(t *testing.T) {
	t.Run("it refuses a private address", func(t *testing.T) {
		var hits atomic.Int32
		srv := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits.Add(1) }))
		defer srv.Close()
		weather.SetNow(t, at("2026-06-10"))
		weather.UseRealClient(t, srv)
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		h := weather.Serve(t, app)
		req := httptest.NewRequest(http.MethodGet, "/api/app/events/"+fx.Event.Id+"/weather", nil)
		req.Header.Set("Authorization", testutil.Token(t, fx.Alice))
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadGateway || !strings.Contains(rec.Body.String(), `"weather_unavailable"`) {
			t.Errorf("%d %s", rec.Code, rec.Body)
		}
		if hits.Load() != 0 {
			t.Errorf("the loopback address was reached %d times", hits.Load())
		}
	})

	t.Run("it follows no redirect", func(t *testing.T) {
		var other atomic.Int32
		elsewhere := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { other.Add(1) }))
		defer elsewhere.Close()
		w := newWorld(t, "2026-06-10")
		w.meteo.redirect = elsewhere.URL + "/v1/forecast"
		if status, _ := w.get(t, w.fx.Event.Id); status != http.StatusBadGateway {
			t.Errorf("status %d, want 502", status)
		}
		if other.Load() != 0 {
			t.Errorf("the redirect was followed %d times", other.Load())
		}
	})

	t.Run("it has a timeout of 8 s and no jar", func(t *testing.T) {
		c := weather.RealClient()
		if c.Timeout != 8*time.Second || weather.RequestTimeout != 8*time.Second {
			t.Errorf("timeout %v", c.Timeout)
		}
		if c.Jar != nil {
			t.Error("the client keeps cookies")
		}
	})
}
