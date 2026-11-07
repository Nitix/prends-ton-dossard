package weather_test

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"courses/server/weather"
)

func TestWeather_Cache(t *testing.T) {
	t.Run("two calls, one forecast; an hour later, another", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.answer(t, w.fx.Event.Id)
		w.answer(t, w.fx.Event.Id)
		if f, g := w.meteo.count("/v1/forecast"), w.meteo.count("/v1/search"); f != 1 || g != 1 {
			t.Fatalf("%d forecasts and %d geocodings for two calls, want 1 and 1", f, g)
		}
		weather.SetNow(t, at("2026-06-10").Add(61*time.Minute))
		w.answer(t, w.fx.Event.Id)
		if f, g := w.meteo.count("/v1/forecast"), w.meteo.count("/v1/search"); f != 2 || g != 1 {
			t.Errorf("%d forecasts and %d geocodings 61 minutes later, want 2 and 1", f, g)
		}
	})

	t.Run("a place is kept 30 days", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.answer(t, w.fx.Event.Id)
		weather.SetNow(t, at("2026-06-10").Add(29*24*time.Hour))
		// Another race of the same place, in the window of that day.
		other := w.event(t, "  ANNECY ", "2026-07-12", "2026-07-12")
		w.answer(t, other.Id)
		if g := w.meteo.count("/v1/search"); g != 1 {
			t.Errorf("%d geocodings after 29 days (and a place written otherwise), want 1", g)
		}
		weather.SetNow(t, at("2026-06-10").Add(31*24*time.Hour))
		third := w.event(t, "Annecy", "2026-07-14", "2026-07-14")
		w.answer(t, third.Id)
		if g := w.meteo.count("/v1/search"); g != 2 {
			t.Errorf("%d geocodings after 31 days, want 2", g)
		}
	})

	t.Run("not found is kept one day", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.meteo.places = map[string][2]float64{}
		for range 2 {
			if a := w.answer(t, w.fx.Event.Id); a.Status != "no_place" {
				t.Fatalf("status %q", a.Status)
			}
		}
		if g := w.meteo.count("/v1/search"); g != 1 {
			t.Fatalf("%d geocodings for two calls, want 1", g)
		}
		weather.SetNow(t, at("2026-06-10").Add(25*time.Hour))
		w.answer(t, w.fx.Event.Id)
		if g := w.meteo.count("/v1/search"); g != 2 {
			t.Errorf("%d geocodings a day later, want 2", g)
		}
	})

	t.Run("ten calls at once make one request", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.meteo.delay = 100 * time.Millisecond
		var wg sync.WaitGroup
		for range 10 {
			wg.Add(1)
			go func() {
				defer wg.Done()
				if status, body := w.get(t, w.fx.Event.Id); status != http.StatusOK {
					t.Errorf("%d %s", status, body)
				}
			}()
		}
		wg.Wait()
		if f, g := w.meteo.count("/v1/forecast"), w.meteo.count("/v1/search"); f != 1 || g != 1 {
			t.Errorf("%d forecasts and %d geocodings for ten calls at once, want 1 and 1", f, g)
		}
	})

	t.Run("the first point of a track is kept", func(t *testing.T) {
		w := newWorld(t, "2026-06-10")
		w.track(t, w.fx.F42, gpxAt(45.9, 6.1, ""))
		w.answer(t, w.fx.Event.Id)
		weather.SetNow(t, at("2026-06-10").Add(2*time.Hour))
		w.answer(t, w.fx.Event.Id)
		if f := w.meteo.count("/v1/forecast"); f != 2 {
			t.Errorf("%d forecasts, want 2", f)
		}
	})

	t.Run("501 keys: the oldest goes", func(t *testing.T) {
		c := weather.NewStringCache(weather.CacheMax)
		if weather.CacheMax != 500 {
			t.Fatalf("the bound is %d, want 500", weather.CacheMax)
		}
		for i := range 501 {
			weather.PutString(c, fmt.Sprint("k", i), "v")
		}
		if n := weather.LenString(c); n != 500 {
			t.Errorf("%d entries, want 500", n)
		}
		if _, ok := weather.GetString(c, "k0"); ok {
			t.Error("the oldest is still there")
		}
		if _, ok := weather.GetString(c, "k1"); !ok {
			t.Error("the second oldest is gone")
		}
		// A key put again is the newest.
		weather.PutString(c, "k1", "again")
		weather.PutString(c, "k501", "v")
		if _, ok := weather.GetString(c, "k1"); !ok {
			t.Error("a key put again went as the oldest")
		}
		if _, ok := weather.GetString(c, "k2"); ok {
			t.Error("k2 should have gone")
		}
	})
}

func TestWeather_StaleOnError(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	first := w.answer(t, w.fx.Event.Id)
	if first.Stale {
		t.Fatal("a fresh forecast is stale")
	}
	w.meteo.status = http.StatusInternalServerError

	weather.SetNow(t, at("2026-06-10").Add(2*time.Hour))
	stale := w.answer(t, w.fx.Event.Id)
	if !stale.Stale || stale.FetchedAt != first.FetchedAt || len(stale.Days) != len(first.Days) {
		t.Errorf("2 h later: %+v, want the old forecast marked stale", stale)
	}

	weather.SetNow(t, at("2026-06-10").Add(7*time.Hour))
	status, body := w.get(t, w.fx.Event.Id)
	if status != http.StatusBadGateway || !strings.Contains(body, `"code":"weather_unavailable"`) {
		t.Errorf("7 h later: %d %s", status, body)
	}

	// And it comes back.
	w.meteo.status = 0
	weather.SetNow(t, at("2026-06-10").Add(7*time.Hour+2*time.Minute))
	if a := w.answer(t, w.fx.Event.Id); a.Stale || a.Status != "ok" {
		t.Errorf("after the recovery: %+v", a)
	}
}

func TestWeather_Budget(t *testing.T) {
	weather.SetBudget(t, 2)
	w := newWorld(t, "2026-06-10")

	w.answer(t, w.fx.Event.Id) // a geocoding and a forecast: the budget
	if n := w.meteo.count(""); n != 2 {
		t.Fatalf("%d requests, want 2", n)
	}
	// The cache is served over the budget.
	w.answer(t, w.fx.Event.Id)

	// Another place needs a call: it is not made, and there is no cache for it.
	w.meteo.places["lyon"] = [2]float64{45.76, 4.84}
	other := w.event(t, "Lyon", "2026-06-13", "2026-06-13")
	status, body := w.get(t, other.Id)
	if status != http.StatusBadGateway || !strings.Contains(body, `"weather_unavailable"`) {
		t.Errorf("over the budget: %d %s", status, body)
	}
	if n := w.meteo.count(""); n != 2 {
		t.Errorf("%d requests, the one over the budget was made", n)
	}

	// The hour after, the budget is there again.
	weather.SetNow(t, at("2026-06-10").Add(61*time.Minute))
	if a := w.answer(t, other.Id); a.Status != "ok" {
		t.Errorf("status %q", a.Status)
	}
}

func TestWeather_FailureIsKeptAMinute(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.meteo.status = http.StatusInternalServerError
	w.meteo.delay = 50 * time.Millisecond
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if status, _ := w.get(t, w.fx.Event.Id); status != http.StatusBadGateway {
				t.Errorf("status %d, want 502", status)
			}
		}()
	}
	wg.Wait()
	if f := w.meteo.count("/v1/forecast"); f != 1 {
		t.Errorf("%d forecast requests for ten calls at once that fail, want 1", f)
	}
	w.get(t, w.fx.Event.Id)
	if f := w.meteo.count("/v1/forecast"); f != 1 {
		t.Errorf("%d forecast requests: the failure was not kept", f)
	}
	w.meteo.status = 0
	weather.SetNow(t, at("2026-06-10").Add(7*time.Hour+2*time.Minute))
	weather.SetNow(t, at("2026-06-10").Add(weather.FailureTTL+time.Second))
	if a := w.answer(t, w.fx.Event.Id); a.Status != "ok" {
		t.Errorf("status %q after the minute", a.Status)
	}
}

func TestWeather_LockHonoursTheContext(t *testing.T) {
	var locks weather.KeyLocks
	release, err := weather.LockKey(context.Background(), &locks, "k")
	if err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()
	if _, err := weather.LockKey(ctx, &locks, "k"); err == nil {
		t.Error("a held key was taken")
	}
	release()
	again, err := weather.LockKey(context.Background(), &locks, "k")
	if err != nil {
		t.Fatalf("the key is not free after a waiter gave up: %v", err)
	}
	again()
}

func TestWeather_ATimeoutIsKeptAMinute(t *testing.T) {
	// The track gives the place: only the forecast is asked.
	w := newWorld(t, "2026-06-10")
	w.track(t, w.fx.F42, gpxAt(45.9, 6.1, ""))
	w.meteo.delay = 400 * time.Millisecond
	weather.SetTimeout(t, 80*time.Millisecond)
	var wg sync.WaitGroup
	for range 10 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if status, _ := w.get(t, w.fx.Event.Id); status != http.StatusBadGateway {
				t.Errorf("status %d, want 502", status)
			}
		}()
	}
	wg.Wait()
	if f := w.meteo.count("/v1/forecast"); f != 1 {
		t.Errorf("%d forecast requests for ten calls at once that time out, want 1", f)
	}
}

func TestWeather_ACancelledRequestIsNotKept(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.track(t, w.fx.F42, gpxAt(45.9, 6.1, ""))
	w.meteo.delay = 300 * time.Millisecond

	ctx, cancel := context.WithCancel(context.Background())
	req := httptest.NewRequest(http.MethodGet, "/api/app/events/"+w.fx.Event.Id+"/weather", nil).WithContext(ctx)
	req.Header.Set("Authorization", w.token)
	go func() {
		time.Sleep(80 * time.Millisecond)
		cancel()
	}()
	w.h.ServeHTTP(httptest.NewRecorder(), req)
	if f := w.meteo.count("/v1/forecast"); f != 1 {
		t.Fatalf("%d forecast requests, want the 1 that was cancelled", f)
	}

	w.meteo.delay = 0
	if a := w.answer(t, w.fx.Event.Id); a.Status != "ok" {
		t.Errorf("status %q: the cancelled request was remembered as a failure", a.Status)
	}
	if f := w.meteo.count("/v1/forecast"); f != 2 {
		t.Errorf("%d forecast requests, want 2", f)
	}
}

func TestWeather_DayBudget(t *testing.T) {
	if normal, demo := weather.DayBudgets(); normal != 2500 || demo != 300 {
		t.Errorf("caps of a day: %d and %d on the demo, want 2500 and 300", normal, demo)
	}

	t.Run("the hour has room, the day does not", func(t *testing.T) {
		weather.SetDayBudget(t, 2, 2)
		w := newWorld(t, "2026-06-10")
		first := w.answer(t, w.fx.Event.Id) // a geocoding and a forecast: the day
		if n := w.meteo.count(""); n != 2 {
			t.Fatalf("%d requests, want 2", n)
		}

		// Two hours on, the forecast is old and the day is spent: the old
		// forecast is served, marked stale, and no call is made.
		weather.SetNow(t, at("2026-06-10").Add(2*time.Hour))
		stale := w.answer(t, w.fx.Event.Id)
		if !stale.Stale || stale.FetchedAt != first.FetchedAt {
			t.Errorf("day spent: %+v, want the old forecast marked stale", stale)
		}
		// A place never asked has nothing to serve.
		w.meteo.places["lyon"] = [2]float64{45.76, 4.84}
		other := w.event(t, "Lyon", "2026-06-13", "2026-06-13")
		status, body := w.get(t, other.Id)
		if status != http.StatusBadGateway || !strings.Contains(body, `"weather_unavailable"`) {
			t.Errorf("day spent, no cache: %d %s", status, body)
		}
		if n := w.meteo.count(""); n != 2 {
			t.Errorf("%d requests, the ones over the day were made", n)
		}

		// The next day of Paris, the count starts again.
		weather.SetNow(t, at("2026-06-11"))
		if a := w.answer(t, other.Id); a.Status != "ok" {
			t.Errorf("next day: status %q", a.Status)
		}
	})

	t.Run("the day ends at midnight in Paris, not in UTC", func(t *testing.T) {
		weather.SetDayBudget(t, 2, 2)
		w := newWorld(t, "2026-01-10")
		// 22:59 UTC is 23:59 in Paris (winter): still the 10th. The day is spent.
		weather.SetNow(t, at("2026-01-10").Add(12*time.Hour+59*time.Minute))
		first := w.event(t, "Annecy", "2026-01-12", "2026-01-12")
		if a := w.answer(t, first.Id); a.Status != "ok" {
			t.Fatalf("first: status %q", a.Status)
		}
		w.meteo.places["lyon"] = [2]float64{45.76, 4.84}
		other := w.event(t, "Lyon", "2026-01-12", "2026-01-12")
		status, body := w.get(t, other.Id)
		if status != http.StatusBadGateway || !strings.Contains(body, `"weather_unavailable"`) {
			t.Fatalf("23:59 in Paris, day spent: %d %s", status, body)
		}
		// 23:01 UTC is 00:01 in Paris: the 11th, the count starts again, though
		// it is still the 10th in UTC.
		weather.SetNow(t, at("2026-01-10").Add(13*time.Hour+1*time.Minute))
		if a := w.answer(t, other.Id); a.Status != "ok" {
			t.Errorf("00:01 in Paris: status %q, want a new day", a.Status)
		}
	})

	t.Run("the demo has its own, lower cap", func(t *testing.T) {
		weather.SetDayBudget(t, 1000, 2)
		w := newWorldWith(t, "2026-06-10", map[string]string{"DEMO_LOGIN_EMAIL": "demo@example.org"})
		w.answer(t, w.fx.Event.Id)
		w.meteo.places["lyon"] = [2]float64{45.76, 4.84}
		other := w.event(t, "Lyon", "2026-06-13", "2026-06-13")
		status, body := w.get(t, other.Id)
		if status != http.StatusBadGateway || !strings.Contains(body, `"weather_unavailable"`) {
			t.Errorf("demo over its cap: %d %s", status, body)
		}
		if n := w.meteo.count(""); n != 2 {
			t.Errorf("%d requests on the demo, want 2", n)
		}
	})

	t.Run("the same cap does not stop a normal instance", func(t *testing.T) {
		weather.SetDayBudget(t, 1000, 2)
		w := newWorld(t, "2026-06-10")
		w.answer(t, w.fx.Event.Id)
		w.meteo.places["lyon"] = [2]float64{45.76, 4.84}
		other := w.event(t, "Lyon", "2026-06-13", "2026-06-13")
		if a := w.answer(t, other.Id); a.Status != "ok" {
			t.Errorf("status %q", a.Status)
		}
	})
}
