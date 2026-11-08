package weather_test

import (
	"net/http"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/weather"
)

// hourlyFields is what the forecast asks for, by the hour, when a format has a start time.
const hourlyFields = "temperature_2m,weather_code,precipitation_probability,precipitation,wind_speed_10m,wind_gusts_10m"

// timed gives a format of the seeded race a start time.
func (w *world) timed(t testing.TB, format *core.Record, at string) {
	t.Helper()
	r, err := w.app.FindRecordById("formats", format.Id)
	if err != nil {
		t.Fatal(err)
	}
	r.Set("start_time", at)
	if err := w.app.Save(r); err != nil {
		t.Fatal(err)
	}
}

// The seeded race is the 13th (F15) and the 14th (F42) of June.

func TestWeather_Starts_NoHourlyWithoutAStartTime(t *testing.T) {
	w := newWorld(t, "2026-06-10")

	a := w.answer(t, w.fx.Event.Id)

	if got := w.meteo.last("/v1/forecast").Query; got.Has("hourly") {
		t.Errorf("hourly = %q asked for a race with no start time", got.Get("hourly"))
	}
	if len(a.Starts) != 0 {
		t.Errorf("starts %+v, want none", a.Starts)
	}
}

func TestWeather_Starts_ReadsTheHourOfTheStart(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.timed(t, w.fx.F42, "07:30")

	a := w.answer(t, w.fx.Event.Id)

	q := w.meteo.last("/v1/forecast").Query
	if got := q.Get("hourly"); got != hourlyFields {
		t.Errorf("hourly = %q, want %q", got, hourlyFields)
	}
	if w.meteo.count("/v1/forecast") != 1 {
		t.Errorf("%d forecast requests, want the one that gives the days and the hours", w.meteo.count("/v1/forecast"))
	}
	if q.Get("timezone") != "auto" {
		t.Errorf("timezone = %q", q.Get("timezone"))
	}
	// A start at 07:30 reads the 07:00 hour.
	want := []weather.Start{{
		Format: "Trail 42 km", Date: "2026-06-14", Time: "07:30",
		Code: 7, Temp: 7.5, RainChance: 14, RainMm: 0.7, WindKmh: 8, GustKmh: 17,
	}}
	if !slices.Equal(a.Starts, want) {
		t.Errorf("starts\n got %+v\nwant %+v", a.Starts, want)
	}
	// The days are what they were: the minimum and the maximum of the day stay.
	if len(a.Days) != 2 || a.Days[1].TMin != 9.1 || a.Days[1].TMax != 17.3 {
		t.Errorf("days %+v", a.Days)
	}
}

func TestWeather_Starts_OneForEachFormatOnItsDay(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.timed(t, w.fx.F15, "18:59") // no date: the first day, the 13th
	w.timed(t, w.fx.F42, "00:00")

	a := w.answer(t, w.fx.Event.Id)

	var got []string
	for _, s := range a.Starts {
		got = append(got, strings.Join([]string{s.Format, s.Date, s.Time}, "|"))
	}
	want := []string{"Trail 15 km|2026-06-13|18:59", "Trail 42 km|2026-06-14|00:00"}
	if !slices.Equal(got, want) {
		t.Fatalf("starts %v, want %v", got, want)
	}
	if a.Starts[0].Code != 18 || a.Starts[1].Code != 0 {
		t.Errorf("hours read %d and %d, want 18 and 0", a.Starts[0].Code, a.Starts[1].Code)
	}
}

// A race under way: the days start at today, and the format of a day gone has no entry, nor any hourly request.
func TestWeather_Starts_NoneForADayOutsideTheDays(t *testing.T) {
	w := newWorld(t, "2026-06-14")
	w.timed(t, w.fx.F15, "09:00") // the 13th, gone

	a := w.answer(t, w.fx.Event.Id)

	if q := w.meteo.last("/v1/forecast").Query; q.Has("hourly") {
		t.Errorf("hourly = %q asked for a start on a day that is not asked", q.Get("hourly"))
	}
	if len(a.Starts) != 0 || len(a.Days) != 1 || a.Days[0].Date != "2026-06-14" {
		t.Errorf("days %+v, starts %+v", a.Days, a.Starts)
	}

	// With one on a day that is asked, the hours are asked, and only that one has an entry.
	w.timed(t, w.fx.F42, "10:15")
	a = w.answer(t, w.fx.Event.Id)
	if len(a.Starts) != 1 || a.Starts[0].Format != "Trail 42 km" || a.Starts[0].Code != 10 {
		t.Errorf("starts %+v", a.Starts)
	}
}

func TestWeather_Starts_NoEntryWhenTheHourIsMissing(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.timed(t, w.fx.F15, "07:30")
	w.timed(t, w.fx.F42, "08:10")
	// Only the 08:00 hour of the 14th, and the 07:00 one of the 13th with no temperature.
	w.meteo.body = `{"daily":{"time":["2026-06-13","2026-06-14"],"weather_code":[61,61],"temperature_2m_max":[17,17],"temperature_2m_min":[9,9],` +
		`"precipitation_probability_max":[60,60],"precipitation_sum":[2,2],"wind_speed_10m_max":[20,20],"wind_gusts_10m_max":[35,35]},` +
		`"hourly":{"time":["2026-06-13T07:00","2026-06-14T08:00"],"temperature_2m":[null,12.4],"weather_code":[3,80],` +
		`"precipitation_probability":[null,40],"precipitation":[null,null],"wind_speed_10m":[10,12],"wind_gusts_10m":[null,31]}}`

	a := w.answer(t, w.fx.Event.Id)

	want := []weather.Start{{Format: "Trail 42 km", Date: "2026-06-14", Time: "08:10", Code: 80, Temp: 12.4, RainChance: 40, RainMm: 0, WindKmh: 12, GustKmh: 31}}
	if !slices.Equal(a.Starts, want) {
		t.Errorf("starts\n got %+v\nwant %+v", a.Starts, want)
	}
}

func TestWeather_Starts_ValidatesTheHours(t *testing.T) {
	daily := `"daily":{"time":["2026-06-14"],"weather_code":[61],"temperature_2m_max":[17],"temperature_2m_min":[9],` +
		`"precipitation_probability_max":[60],"precipitation_sum":[2],"wind_speed_10m_max":[20],"wind_gusts_10m_max":[35]}`
	hourly := func(times, rest string) string {
		return `{` + daily + `,"hourly":{"time":` + times + `,` + rest + `}}`
	}
	ones := func(n int) string {
		return "[" + strings.TrimSuffix(strings.Repeat("1,", n), ",") + "]"
	}
	fields := func(n int) string {
		return `"temperature_2m":` + ones(n) + `,"weather_code":` + ones(n) + `,"precipitation_probability":` + ones(n) +
			`,"precipitation":` + ones(n) + `,"wind_speed_10m":` + ones(n) + `,"wind_gusts_10m":` + ones(n)
	}

	t.Run("lists of different lengths are a failure", func(t *testing.T) {
		w := newWorld(t, "2026-06-14")
		w.timed(t, w.fx.F42, "07:30")
		w.meteo.body = hourly(`["2026-06-14T07:00","2026-06-14T08:00"]`, strings.Replace(fields(2), `"wind_gusts_10m":[1,1]`, `"wind_gusts_10m":[1]`, 1))
		if status, body := w.get(t, w.fx.Event.Id); status != http.StatusBadGateway || !strings.Contains(body, "weather_unavailable") {
			t.Errorf("%d %s", status, body)
		}
	})

	t.Run("an hour that is no hour, or out of the days, is dropped", func(t *testing.T) {
		w := newWorld(t, "2026-06-14")
		w.timed(t, w.fx.F42, "07:30")
		w.meteo.body = hourly(`["bonjour","2026-06-14T7:00","2026-06-15T07:00","2026-06-14T07:30","2026-06-14T07:00"]`, fields(5))
		a := w.answer(t, w.fx.Event.Id)
		if len(a.Starts) != 1 || a.Starts[0].Code != 1 {
			t.Errorf("starts %+v, want the one of the 07:00 hour", a.Starts)
		}
	})

	t.Run("an answer with no hours gives the days and no start", func(t *testing.T) {
		w := newWorld(t, "2026-06-14")
		w.timed(t, w.fx.F42, "07:30")
		w.meteo.body = `{` + daily + `}`
		a := w.answer(t, w.fx.Event.Id)
		if len(a.Days) != 1 || len(a.Starts) != 0 {
			t.Errorf("days %+v starts %+v", a.Days, a.Starts)
		}
	})

	t.Run("an answer over the cap is a failure", func(t *testing.T) {
		w := newWorld(t, "2026-06-14")
		w.timed(t, w.fx.F42, "07:30")
		w.meteo.body = `{"junk":"` + strings.Repeat("x", 1<<20) + `",` + strings.TrimPrefix(hourly(`["2026-06-14T07:00"]`, fields(1)), "{")
		if status, _ := w.get(t, w.fx.Event.Id); status != http.StatusBadGateway {
			t.Errorf("status %d, want 502", status)
		}
	})
}

func TestWeather_Starts_TheCacheKnowsTheStartTimes(t *testing.T) {
	w := newWorld(t, "2026-06-10")
	w.timed(t, w.fx.F42, "07:30")

	first := w.answer(t, w.fx.Event.Id)
	again := w.answer(t, w.fx.Event.Id)

	if n := w.meteo.count("/v1/forecast"); n != 1 {
		t.Errorf("%d forecasts for two calls, want 1: the hours are kept with the days", n)
	}
	if !slices.Equal(first.Starts, again.Starts) {
		t.Errorf("the second answer has %+v, the first %+v", again.Starts, first.Starts)
	}

	// Another time is another key: the hour is read again, not served from the old one.
	w.timed(t, w.fx.F42, "09:45")
	changed := w.answer(t, w.fx.Event.Id)
	if n := w.meteo.count("/v1/forecast"); n != 2 {
		t.Errorf("%d forecasts after the change of the time, want 2", n)
	}
	if len(changed.Starts) != 1 || changed.Starts[0].Time != "09:45" || changed.Starts[0].Code != 9 {
		t.Errorf("starts %+v, want 09:45 reading the 09:00 hour", changed.Starts)
	}

	// A time taken off asks no hour, and is a key of its own.
	w.timed(t, w.fx.F42, "")
	none := w.answer(t, w.fx.Event.Id)
	if len(none.Starts) != 0 {
		t.Errorf("starts %+v after the time was taken off", none.Starts)
	}
	if q := w.meteo.last("/v1/forecast").Query; q.Has("hourly") {
		t.Errorf("hourly asked with no start time left")
	}
}
