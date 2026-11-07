package weather_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"

	"courses/server/testutil"
	"courses/server/weather"
)

// recorded is a request that the fake Open-Meteo got.
type recorded struct {
	Path   string
	Query  url.Values
	Header http.Header
	Raw    string
}

// meteo is a fake Open-Meteo: it counts the requests and records them.
type meteo struct {
	*httptest.Server

	mu       sync.Mutex
	requests []recorded
	// places are the places that the geocoding knows, by the name asked, in
	// lower case: the answer is {latitude, longitude}.
	places map[string][2]float64
	// status is the status of the forecast (200 when 0).
	status int
	// delay slows each answer.
	delay time.Duration
	// redirect makes the forecast redirect there.
	redirect string
}

func newMeteo(t testing.TB) *meteo {
	t.Helper()
	m := &meteo{places: map[string][2]float64{"annecy": {45.8992, 6.1294}}}
	m.Server = httptest.NewServer(http.HandlerFunc(m.serve))
	t.Cleanup(m.Close)
	weather.UseServer(t, m.Server)
	return m
}

func (m *meteo) serve(w http.ResponseWriter, r *http.Request) {
	m.mu.Lock()
	m.requests = append(m.requests, recorded{Path: r.URL.Path, Query: r.URL.Query(), Header: r.Header.Clone(), Raw: r.URL.RawQuery})
	status, delay, redirect := m.status, m.delay, m.redirect
	m.mu.Unlock()
	if delay > 0 {
		time.Sleep(delay)
	}
	q := r.URL.Query()
	switch r.URL.Path {
	case "/v1/search":
		place, ok := m.places[strings.ToLower(q.Get("name"))]
		if !ok {
			fmt.Fprint(w, `{"generationtime_ms":0.5}`)
			return
		}
		fmt.Fprintf(w, `{"results":[{"name":"Annecy","latitude":%v,"longitude":%v,"admin1":"Auvergne-Rhône-Alpes","country":"France"}]}`, place[0], place[1])
	case "/v1/forecast":
		if redirect != "" {
			http.Redirect(w, r, redirect, http.StatusFound)
			return
		}
		if status != 0 {
			http.Error(w, "no", status)
			return
		}
		start, _ := time.Parse(time.DateOnly, q.Get("start_date"))
		end, _ := time.Parse(time.DateOnly, q.Get("end_date"))
		var days []string
		for d := start; !d.After(end); d = d.AddDate(0, 0, 1) {
			days = append(days, d.Format(time.DateOnly))
		}
		each := func(v any) []any {
			out := make([]any, len(days))
			for i := range out {
				out[i] = v
			}
			return out
		}
		dates := make([]any, len(days))
		for i, d := range days {
			dates[i] = d
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"daily": map[string]any{
			"time": dates, "weather_code": each(61), "temperature_2m_max": each(17.3), "temperature_2m_min": each(9.1),
			"precipitation_probability_max": each(60), "precipitation_sum": each(2.1),
			"wind_speed_10m_max": each(20), "wind_gusts_10m_max": each(35),
		}})
	default:
		http.NotFound(w, r)
	}
}

// count is the requests to a path ("" for all).
func (m *meteo) count(path string) int {
	m.mu.Lock()
	defer m.mu.Unlock()
	n := 0
	for _, r := range m.requests {
		if path == "" || r.Path == path {
			n++
		}
	}
	return n
}

func (m *meteo) all() []recorded {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]recorded(nil), m.requests...)
}

// names are the texts that the geocoding was asked, in order.
func (m *meteo) names() []string {
	var out []string
	for _, r := range m.all() {
		if r.Path == "/v1/search" {
			out = append(out, r.Query.Get("name"))
		}
	}
	return out
}

func (m *meteo) last(path string) recorded {
	var got recorded
	for _, r := range m.all() {
		if r.Path == path {
			got = r
		}
	}
	return got
}

// world is an application with its fixture, a fake Open-Meteo and the handler.
type world struct {
	app   *tests.TestApp
	fx    testutil.Fixture
	meteo *meteo
	h     http.Handler
	token string
}

// at is 10:00 UTC of a day: noon in Paris in summer.
func at(day string) time.Time {
	d, err := time.Parse(time.DateOnly, day)
	if err != nil {
		panic(err)
	}
	return d.Add(10 * time.Hour)
}

func newWorld(t testing.TB, today string) *world {
	t.Helper()
	weather.SetNow(t, at(today))
	m := newMeteo(t)
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	return &world{app: app, fx: fx, meteo: m, h: weather.Serve(t, app), token: testutil.Token(t, fx.Alice)}
}

// get calls the route as Alice and returns the status and the body.
func (w *world) get(t testing.TB, id string) (int, string) {
	t.Helper()
	return w.getAs(t, w.token, id)
}

func (w *world) getAs(t testing.TB, token, id string) (int, string) {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/app/events/"+id+"/weather", nil)
	if token != "" {
		req.Header.Set("Authorization", token)
	}
	rec := httptest.NewRecorder()
	w.h.ServeHTTP(rec, req)
	return rec.Code, rec.Body.String()
}

// answer decodes a 200.
func (w *world) answer(t testing.TB, id string) weather.Answer {
	t.Helper()
	status, body := w.get(t, id)
	if status != http.StatusOK {
		t.Fatalf("status %d: %s", status, body)
	}
	var a weather.Answer
	if err := json.Unmarshal([]byte(body), &a); err != nil {
		t.Fatal(err)
	}
	return a
}

func (w *world) save(t testing.TB, collection string, values map[string]any) *core.Record {
	t.Helper()
	c, err := w.app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	for k, v := range values {
		r.Set(k, v)
	}
	if err := w.app.Save(r); err != nil {
		t.Fatalf("saving a %s: %v", collection, err)
	}
	return r
}

// event makes a race with no format.
func (w *world) event(t testing.TB, location, start, end string) *core.Record {
	t.Helper()
	return w.save(t, "events", map[string]any{"name": "Course", "location": location, "start_date": start, "end_date": end, "created_by": w.fx.AliceRunner.Id})
}

// setLocation changes the place of the seeded race.
func (w *world) setLocation(t testing.TB, location string) {
	t.Helper()
	r, err := w.app.FindRecordById("events", w.fx.Event.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.Set("location", location)
	if err := w.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

// track gives a format a track.
func (w *world) track(t testing.TB, format *core.Record, data []byte) {
	t.Helper()
	file, err := filesystem.NewFileFromBytes(data, "trace.gpx")
	if err != nil {
		t.Fatal(err)
	}
	r, err := w.app.FindRecordById("formats", format.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.Set("gpx", file)
	if err := w.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

// gpxAt is a track of one point.
func gpxAt(lat, lon float64, ele string) []byte {
	e := ""
	if ele != "" {
		e = "<ele>" + ele + "</ele>"
	}
	return []byte(fmt.Sprintf(`<?xml version="1.0"?><gpx version="1.1" creator="t" xmlns="http://www.topografix.com/GPX/1/1"><trk><trkseg><trkpt lat="%v" lon="%v">%s</trkpt></trkseg></trk></gpx>`, lat, lon, e))
}
