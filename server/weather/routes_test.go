package weather_test

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	"courses/server/testutil"
	"courses/server/weather"
)

func TestWeather_Window(t *testing.T) {
	// The seeded race is on 2026-06-13 and 2026-06-14.
	for _, row := range []struct {
		today  string
		status string
		from   string
		days   []string
	}{
		{"2026-06-05", "not_yet", "2026-06-06", nil},
		{"2026-06-06", "ok", "", []string{"2026-06-13", "2026-06-14"}},
		{"2026-06-13", "ok", "", []string{"2026-06-13", "2026-06-14"}},
		{"2026-06-14", "ok", "", []string{"2026-06-14"}},
		{"2026-06-15", "over", "", nil},
	} {
		t.Run(row.today, func(t *testing.T) {
			w := newWorld(t, row.today)
			a := w.answer(t, w.fx.Event.Id)
			if a.Status != row.status || a.From != row.from {
				t.Fatalf("answer %+v, want %s from %q", a, row.status, row.from)
			}
			var days []string
			for _, d := range a.Days {
				days = append(days, d.Date)
			}
			if strings.Join(days, " ") != strings.Join(row.days, " ") {
				t.Errorf("days %v, want %v", days, row.days)
			}
			if row.status != "ok" {
				if n := w.meteo.count(""); n != 0 {
					t.Errorf("%d requests for %s, want none", n, row.status)
				}
			}
		})
	}

	t.Run("the window is read on the wall clock of Paris", func(t *testing.T) {
		// 22:30 UTC on 06-05 is 00:30 on 06-06 in Paris.
		w := newWorld(t, "2026-06-05")
		weather.SetNow(t, at("2026-06-05").Add(12*60*60*1e9+30*60*1e9))
		if a := w.answer(t, w.fx.Event.Id); a.Status != "ok" {
			t.Errorf("status %q, want ok from midnight in Paris", a.Status)
		}
	})

	t.Run("a race known by its month has no weather", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		month := w.save(t, "events", map[string]any{"name": "Marathon", "location": "Annecy", "start_date": "2026-06-01", "date_precision": "month", "created_by": w.fx.AliceRunner.Id})
		if a := w.answer(t, month.Id); a.Status != "no_day" {
			t.Errorf("status %q", a.Status)
		}
		if n := w.meteo.count(""); n != 0 {
			t.Errorf("%d requests, want none", n)
		}
	})
}

func TestWeather_Route(t *testing.T) {
	w := newWorld(t, "2026-06-10")

	t.Run("a session is needed", func(t *testing.T) {
		if status, _ := w.getAs(t, "", w.fx.Event.Id); status != http.StatusUnauthorized {
			t.Errorf("status %d, want 401", status)
		}
		if n := w.meteo.count(""); n != 0 {
			t.Errorf("%d requests without a session", n)
		}
	})

	t.Run("an unknown race", func(t *testing.T) {
		status, body := w.get(t, "aaaaaaaaaaaaaaa")
		if status != http.StatusNotFound || !strings.Contains(body, `"not_found"`) {
			t.Errorf("%d %s", status, body)
		}
	})

	t.Run("the shape", func(t *testing.T) {
		status, body := w.get(t, w.fx.Event.Id)
		if status != http.StatusOK {
			t.Fatalf("%d %s", status, body)
		}
		var got map[string]any
		if err := json.Unmarshal([]byte(body), &got); err != nil {
			t.Fatal(err)
		}
		want := `{"status":"ok","place":{"source":"place","name":"Annecy","detail":"Auvergne-Rhône-Alpes, France"},` +
			`"days":[{"date":"2026-06-13","code":61,"tMin":9.1,"tMax":17.3,"rainChance":60,"rainMm":2.1,"windKmh":20,"gustKmh":35},` +
			`{"date":"2026-06-14","code":61,"tMin":9.1,"tMax":17.3,"rainChance":60,"rainMm":2.1,"windKmh":20,"gustKmh":35}],` +
			`"fetchedAt":"2026-06-10T10:00:00Z","stale":false}`
		if body := strings.TrimSpace(body); body != want {
			t.Errorf("body\n got %s\nwant %s", body, want)
		}
	})

	t.Run("a place that was not found", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.meteo.places = map[string][2]float64{}
		status, body := w.get(t, w.fx.Event.Id)
		if want := `{"status":"no_place","query":"Annecy","stale":false}`; status != http.StatusOK || strings.TrimSpace(body) != want {
			t.Errorf("%d %s, want %s", status, body, want)
		}
	})

	t.Run("only the days of the race within 16 days", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		long := w.event(t, "Annecy", "2026-06-08", "2026-07-20")
		a := w.answer(t, long.Id)
		if len(a.Days) != 16 || a.Days[0].Date != "2026-06-10" || a.Days[15].Date != "2026-06-25" {
			t.Errorf("%d days, from %s to %s, want 16 from 2026-06-10 to 2026-06-25", len(a.Days), a.Days[0].Date, a.Days[len(a.Days)-1].Date)
		}
		if got := w.meteo.last("/v1/forecast").Query.Get("end_date"); got != "2026-06-25" {
			t.Errorf("end_date %q", got)
		}
	})
}

// On the demo the route is there too.
func TestWeather_OnTheDemo(t *testing.T) {
	weather.SetNow(t, at("2026-06-10"))
	newMeteo(t)
	app := testutil.NewAppWith(t, map[string]string{"DEMO_LOGIN_EMAIL": "alice@example.test"})
	fx := testutil.Seed(t, app)
	w := &world{app: app, fx: fx, h: weather.Serve(t, app), token: testutil.Token(t, fx.Alice)}
	if status, body := w.get(t, fx.Event.Id); status != http.StatusOK {
		t.Errorf("%d %s", status, body)
	}
}

func TestWeather_Labels(t *testing.T) {
	for code, want := range map[int]string{
		0: "Ciel dégagé", 1: "Peu nuageux", 2: "Peu nuageux", 3: "Couvert", 45: "Brouillard", 48: "Brouillard",
		51: "Bruine", 53: "Bruine", 55: "Bruine", 56: "Bruine", 57: "Bruine", 61: "Pluie", 63: "Pluie", 65: "Forte pluie",
		66: "Pluie verglaçante", 67: "Pluie verglaçante", 71: "Neige", 73: "Neige", 75: "Neige", 77: "Neige",
		80: "Averses", 81: "Averses", 82: "Fortes averses", 85: "Averses de neige", 86: "Averses de neige",
		95: "Orage", 96: "Orage et grêle", 99: "Orage et grêle",
		4: "Temps inconnu", 62: "Temps inconnu", -1: "Temps inconnu", 1000: "Temps inconnu",
	} {
		if got := weather.Label(code); got != want {
			t.Errorf("Label(%d) = %q, want %q", code, got, want)
		}
	}
}
