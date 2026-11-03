package mcp_test

import (
	"encoding/json"
	"net/http"
	"reflect"
	"slices"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The ports of features/stats/stats.ts: each test is named after the function it
// ports and holds the cases of its tests (stats.test.ts), on plain rows.

var (
	aliceRunner = mcp.RunnerRecord{ID: "aliceRunner0000", Name: "Alice"}
	bobRunner   = mcp.RunnerRecord{ID: "bobRunner000000", Name: "Bob"}
	// The trail of 42 km (2 400 m) and the 15 km (700 m) of the fixture of the site.
	f42 = mcp.FormatRecord{ID: "f42", DistanceKm: 42, ElevationGainM: 2400}
	f15 = mcp.FormatRecord{ID: "f15", DistanceKm: 15, ElevationGainM: 700}
)

// resultOn is a result of the fixture: Alice on the trail of 42 km by default,
// finished, with no time, on this day. The options change it.
func resultOn(id, day string, options ...func(*mcp.ResultRow)) mcp.ResultRow {
	row := mcp.ResultRow{
		Participation: mcp.ParticipationRecord{ID: id, Runner: aliceRunner.ID, Format: f42.ID, Status: "finished"},
		Runner:        aliceRunner,
		Event:         mcp.EventRecord{ID: "trail", Name: "Trail des Crêtes"},
		Format:        f42,
		Day:           day,
	}
	for _, option := range options {
		option(&row)
	}
	return row
}

func runnerOf(r mcp.RunnerRecord) func(*mcp.ResultRow) {
	return func(row *mcp.ResultRow) {
		row.Runner = r
		row.Participation.Runner = r.ID
	}
}

func formatOf(f mcp.FormatRecord) func(*mcp.ResultRow) {
	return func(row *mcp.ResultRow) {
		row.Format = f
		row.Participation.Format = f.ID
	}
}

func statusOf(status string) func(*mcp.ResultRow) {
	return func(row *mcp.ResultRow) { row.Participation.Status = status }
}

func timeOf(seconds int) func(*mcp.ResultRow) {
	return func(row *mcp.ResultRow) { row.Participation.FinishTimeS = seconds }
}

func TestTotalsOf_AFinishedRaceCountsItsDistanceItsElevationAndItsTime(t *testing.T) {
	rows := []mcp.ResultRow{
		resultOn("a", "2026-06-14", timeOf(15_150)),
		resultOn("b", "2026-06-13", formatOf(f15), timeOf(5_400)),
	}

	want := mcp.Totals{Finished: 2, Km: 57, Elevation: 3_100, Seconds: 20_550}
	if got := mcp.TotalsOf(rows); got != want {
		t.Errorf("totals %+v, want %+v", got, want)
	}
}

func TestTotalsOf_Nothing(t *testing.T) {
	if got := mcp.TotalsOf(nil); got != (mcp.Totals{}) {
		t.Errorf("totals %+v, want zeros", got)
	}
}

func TestTotalsOf_WhatIsNotGivenCountsForNothing(t *testing.T) {
	// The API sends 0 for a measure that is not given, and a timed race has no distance.
	timed := mcp.FormatRecord{ID: "timed", DurationMin: 360}
	rows := []mcp.ResultRow{
		resultOn("no-time", "2026-06-14", timeOf(0)),
		resultOn("timed", "2026-06-14", formatOf(timed), timeOf(21_600)),
	}

	want := mcp.Totals{Finished: 2, Km: 42, Elevation: 2_400, Seconds: 21_600}
	if got := mcp.TotalsOf(rows); got != want {
		t.Errorf("totals %+v, want %+v", got, want)
	}
}

func TestTotalsOf_DecimalDistancesAddWithoutFloatNoise(t *testing.T) {
	var rows []mcp.ResultRow
	for i, km := range []float64{0.1, 0.2} {
		rows = append(rows, resultOn(string(rune('a'+i)), "2026-06-14", formatOf(mcp.FormatRecord{ID: "f", DistanceKm: km})))
	}

	if got := mcp.TotalsOf(rows).Km; got != 0.3 {
		t.Errorf("0.1 + 0.2 = %v, want 0.3", got)
	}
}

// stats — un abandon ne compte que dans les abandons.
func TestTotalsOf_ADNFCountsOnlyAsAnAbandon(t *testing.T) {
	// A time on a DNF is a leftover that the server clears: the totals do not rely on it.
	dnf := resultOn("dnf", "2026-06-14", statusOf("dnf"), timeOf(3_600))

	if got, want := mcp.TotalsOf([]mcp.ResultRow{dnf}), (mcp.Totals{DNF: 1}); got != want {
		t.Errorf("totals %+v, want %+v", got, want)
	}
	got := mcp.TotalsOf([]mcp.ResultRow{dnf, resultOn("done", "2026-06-13", timeOf(900))})
	if want := (mcp.Totals{Finished: 1, DNF: 1, Km: 42, Elevation: 2_400, Seconds: 900}); got != want {
		t.Errorf("totals %+v, want %+v", got, want)
	}
}

func TestTotalsOf_AnotherStatusCountsForNothing(t *testing.T) {
	var rows []mcp.ResultRow
	for _, status := range []string{"registered", "interested", "dns", "supporter"} {
		rows = append(rows, resultOn(status, "2026-06-14", statusOf(status)))
	}

	if got := mcp.TotalsOf(rows); got != (mcp.Totals{}) {
		t.Errorf("totals %+v, want zeros", got)
	}
}

func TestByRunner_OnlyTheYearAskedSortedByKmThenName(t *testing.T) {
	// Her id comes before Alice's: the name decides, not the id.
	zoe := mcp.RunnerRecord{ID: "000zoeRunner000", Name: "Zoé"}
	sam := mcp.RunnerRecord{ID: "samRunner000000", Name: "Sam"}
	rows := []mcp.ResultRow{
		// Alice, 2026: 42 km.
		resultOn("a1", "2026-06-14"),
		// Bob, 2026: 57 km, over two races.
		resultOn("b1", "2026-03-01", runnerOf(bobRunner)),
		resultOn("b2", "2026-09-20", runnerOf(bobRunner), formatOf(f15)),
		// Zoé, 2026: 42 km too, like Alice: the name decides.
		resultOn("z1", "2026-05-10", runnerOf(zoe)),
		// Another year: left out, with the runner who has nothing else.
		resultOn("a0", "2025-06-14"),
		resultOn("s0", "2025-06-14", runnerOf(sam)),
		resultOn("a2", "2027-01-01"),
	}

	list := mcp.ByRunner(rows, 2026)

	var names []string
	var kms []float64
	for _, entry := range list {
		names = append(names, entry.Runner.Name)
		kms = append(kms, entry.Totals.Km)
	}
	if want := []string{"Bob", "Alice", "Zoé"}; !slices.Equal(names, want) {
		t.Errorf("the runners are %v, want %v", names, want)
	}
	if want := []float64{57, 42, 42}; !slices.Equal(kms, want) {
		t.Errorf("the kilometers are %v, want %v", kms, want)
	}
	if want := (mcp.Totals{Finished: 2, Km: 57, Elevation: 3_100}); list[0].Totals != want {
		t.Errorf("Bob's totals %+v, want %+v", list[0].Totals, want)
	}
}

func TestByRunner_ARunnerWithOnlyAbandonsIsThereAtZeroKm(t *testing.T) {
	rows := []mcp.ResultRow{resultOn("a1", "2026-06-14", statusOf("dnf"))}

	want := []mcp.RunnerTotals{{Runner: aliceRunner, Totals: mcp.Totals{DNF: 1}}}
	if got := mcp.ByRunner(rows, 2026); !reflect.DeepEqual(got, want) {
		t.Errorf("got %+v, want %+v", got, want)
	}
}

func TestByRunner_TheDayOfTheRaceGivesTheYearNotTheEventsOwn(t *testing.T) {
	// The day of the format is on 1 January, the event began on 31 December.
	rows := []mcp.ResultRow{resultOn("a1", "2027-01-01")}

	if got := mcp.ByRunner(rows, 2026); len(got) != 0 {
		t.Errorf("2026: %+v, want nobody", got)
	}
	if got := mcp.ByRunner(rows, 2027); len(got) != 1 {
		t.Errorf("2027: %+v, want one runner", got)
	}
}

func TestByRunner_NoResultThatYear(t *testing.T) {
	if got := mcp.ByRunner(nil, 2026); len(got) != 0 {
		t.Errorf("got %+v, want nobody", got)
	}
}

func TestByYear_DescendingYears(t *testing.T) {
	rows := []mcp.ResultRow{
		resultOn("a", "2024-06-14", timeOf(100)),
		resultOn("b", "2026-06-14", timeOf(200)),
		resultOn("c", "2025-06-14", statusOf("dnf")),
		resultOn("d", "2026-09-01", formatOf(f15), timeOf(50)),
	}

	years := mcp.ByYear(rows)

	var got []int
	for _, entry := range years {
		got = append(got, entry.Year)
	}
	if want := []int{2026, 2025, 2024}; !slices.Equal(got, want) {
		t.Errorf("the years are %v, want %v", got, want)
	}
	if want := (mcp.Totals{Finished: 2, Km: 57, Elevation: 3_100, Seconds: 250}); years[0].Totals != want {
		t.Errorf("2026: %+v, want %+v", years[0].Totals, want)
	}
	if want := (mcp.Totals{DNF: 1}); years[1].Totals != want {
		t.Errorf("2025: %+v, want %+v", years[1].Totals, want)
	}
}

func TestByYear_NoResult(t *testing.T) {
	if got := mcp.ByYear(nil); len(got) != 0 {
		t.Errorf("got %+v, want nothing", got)
	}
}

// toResultRow: a participation of the answer to a request made with the expand of
// the statistics ("runner,event,format.race_type").
func resultRecord(t *testing.T, expand string) mcp.ParticipationRecord {
	t.Helper()
	var record mcp.ParticipationRecord
	body := `{"id":"p1","runner":"alice","event":"trail","format":"f42","status":"finished","expand":` + expand + `}`
	if err := json.Unmarshal([]byte(body), &record); err != nil {
		t.Fatal(err)
	}
	return record
}

const (
	expandRunner   = `"runner":{"id":"alice","name":"Alice"}`
	expandEvent    = `"event":{"id":"trail","name":"Trail des Crêtes","start_date":"2026-06-13","end_date":"2026-06-14"}`
	expandFormat   = `"format":{"id":"f42","distance_km":42,"date":"2026-06-14","expand":{"race_type":{"id":"trailType","label":"Trail"}}}`
	expandNoDate   = `"format":{"id":"f15","distance_km":15,"expand":{"race_type":{"id":"trailType","label":"Trail"}}}`
	expandNoType   = `"format":{"id":"f42","distance_km":42,"date":"2026-06-14"}`
	allOfTheExpand = `{` + expandRunner + `,` + expandEvent + `,` + expandFormat + `}`
)

func TestToResultRow_TheRunnerTheEventTheRaceAndItsTypeAndTheDayOfTheRace(t *testing.T) {
	row, err := mcp.NewResultRow(resultRecord(t, allOfTheExpand))
	if err != nil {
		t.Fatal(err)
	}
	if row.Runner.Name != "Alice" || row.Event.Name != "Trail des Crêtes" || row.Format.ID != "f42" || row.RaceType.Label != "Trail" {
		t.Errorf("the row is %+v", row)
	}
	if row.Day != "2026-06-14" {
		t.Errorf("the day is %s, want the date of the race", row.Day)
	}

	// A format with no date of its own is on the day its event starts.
	row, err = mcp.NewResultRow(resultRecord(t, `{`+expandRunner+`,`+expandEvent+`,`+expandNoDate+`}`))
	if err != nil {
		t.Fatal(err)
	}
	if row.Day != "2026-06-13" {
		t.Errorf("the day is %s, want the start of the event", row.Day)
	}
}

func TestToResultRow_AnAnswerWithoutRunnerEventOrRaceIsAnError(t *testing.T) {
	for _, row := range []struct{ name, expand, word string }{
		{"no runner", `{` + expandEvent + `,` + expandFormat + `}`, "runner"},
		{"no event", `{` + expandRunner + `,` + expandFormat + `}`, "event"},
		{"no format", `{` + expandRunner + `,` + expandEvent + `}`, "format"},
		{"no race type", `{` + expandRunner + `,` + expandEvent + `,` + expandNoType + `}`, "format"},
		{"nothing expanded", `{}`, "runner"},
	} {
		t.Run(row.name, func(t *testing.T) {
			_, err := mcp.NewResultRow(resultRecord(t, row.expand))
			if err == nil || !strings.Contains(err.Error(), row.word) {
				t.Errorf("error %v, want one that names the %s", err, row.word)
			}
		})
	}

	// A result is on a race: a participation with none is not one.
	record := resultRecord(t, allOfTheExpand)
	record.Format = ""
	if _, err := mcp.NewResultRow(record); err == nil {
		t.Error("a result with no format is accepted")
	}
}

// ---------------------------------------------------------------------------
// The tool

// statsRunner is a line of the statistics of a year.
func statsRunner(runner *core.Record, finished, dnf int, km float64, elevation, seconds int) map[string]any {
	return map[string]any{
		"runner": runnerRef(runner), "finished": finished, "dnf": dnf,
		"distance_km": km, "elevation_gain_m": elevation, "time_s": seconds,
	}
}

func TestTools_GetStats(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	token := newToken(t, app, fx.Alice)
	mcp.SetNow(t, at(2026, 6, 20, 10, 0))

	// Alice finished the 42 km in 4:12:30, and Bob started the 15 km and gave up.
	update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150})
	create(t, app, "participations", map[string]any{
		"runner": fx.BobRunner.Id, "format": fx.F15.Id, "status": "dnf", "confirmed": true, "added_by": fx.BobRunner.Id,
	})
	stats := func(args map[string]any) toolResult {
		t.Helper()
		return callTool(t, app, token, "get_stats", args)
	}

	t.Run("the current year by default, by kilometers", func(t *testing.T) {
		result := succeeded(t, stats(nil))
		assertJSON(t, result.Structured, map[string]any{"year": 2026, "runners": []any{
			statsRunner(fx.AliceRunner, 1, 0, 42, 2400, 15150),
			// Bob has only an abandon: he is there, at 0 km.
			statsRunner(fx.BobRunner, 0, 1, 0, 0, 0),
		}})
		textIs(t, result)
	})

	t.Run("a year that is asked for", func(t *testing.T) {
		result := succeeded(t, stats(map[string]any{"year": 2026}))
		if got := len(result.Structured["runners"].([]any)); got != 2 {
			t.Errorf("%d runners in 2026, want 2", got)
		}
	})

	t.Run("another year has no result: an empty list, not null", func(t *testing.T) {
		for _, year := range []int{2025, 2027} {
			result := succeeded(t, stats(map[string]any{"year": year}))
			assertJSON(t, result.Structured, map[string]any{"year": year, "runners": []any{}})
		}
	})

	t.Run("the year is the one in Paris", func(t *testing.T) {
		// A quarter to midnight on New Year's Eve in UTC is already the next year in Paris.
		mcp.SetNow(t, at(2026, 12, 31, 23, 30))
		result := succeeded(t, stats(nil))
		assertJSON(t, result.Structured, map[string]any{"year": 2027, "runners": []any{}})
	})

	t.Run("a runner without an account has a line too, and a tie goes by name", func(t *testing.T) {
		mcp.SetNow(t, at(2026, 6, 20, 10, 0))
		// Sam finished the 42 km too: the same distance as Alice, whose name comes first.
		create(t, app, "participations", map[string]any{
			"runner": fx.SamRunner.Id, "format": fx.F42.Id, "status": "finished", "confirmed": false, "added_by": fx.AliceRunner.Id,
			"finish_time_s": 18000,
		})
		result := succeeded(t, stats(nil))
		assertJSON(t, result.Structured["runners"], []any{
			statsRunner(fx.AliceRunner, 1, 0, 42, 2400, 15150),
			statsRunner(fx.SamRunner, 1, 0, 42, 2400, 18000),
			statsRunner(fx.BobRunner, 0, 1, 0, 0, 0),
		})
	})

	t.Run("the day of the race gives the year, not the start of the event", func(t *testing.T) {
		// An event that begins on New Year's Eve, with a race on 1 January.
		event := create(t, app, "events", map[string]any{
			"name": "Réveillon", "location": "Annecy", "start_date": "2025-12-31", "end_date": "2026-01-01", "created_by": fx.AliceRunner.Id,
		})
		night := create(t, app, "formats", map[string]any{"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 10, "date": "2026-01-01"})
		eve := create(t, app, "formats", map[string]any{"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 5, "date": "2025-12-31"})
		for _, format := range []*core.Record{night, eve} {
			create(t, app, "participations", map[string]any{
				"runner": fx.AdminRunner.Id, "format": format.Id, "status": "finished", "confirmed": true, "added_by": fx.AdminRunner.Id,
				"finish_time_s": 3000,
			})
		}

		in2026 := succeeded(t, stats(map[string]any{"year": 2026}))
		var found bool
		for _, line := range in2026.Structured["runners"].([]any) {
			line := line.(map[string]any)
			if line["runner"].(map[string]any)["id"] == fx.AdminRunner.Id {
				found = true
				assertJSON(t, line, statsRunner(fx.AdminRunner, 1, 0, 10, 0, 3000))
			}
		}
		if !found {
			t.Error("2026 has no line for the admin, who ran the 10 km of 1 January")
		}

		in2025 := succeeded(t, stats(map[string]any{"year": 2025}))
		assertJSON(t, in2025.Structured["runners"], []any{statsRunner(fx.AdminRunner, 1, 0, 5, 0, 3000)})
	})

	t.Run("the year is bounded by the schema", func(t *testing.T) {
		for _, year := range []any{-1, 10000, 2026.5, "2026"} {
			if result := stats(map[string]any{"year": year}); !result.IsError {
				t.Errorf("year %v accepted: %.200s", year, result.Text)
			}
		}
	})

	t.Run("the statistics only read", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		succeeded(t, stats(nil))
		if counted.Total() == 0 {
			t.Error("no request was made")
		}
		for _, method := range []string{http.MethodPost, http.MethodPatch, http.MethodPut, http.MethodDelete} {
			if n := counted.Of(method); n != 0 {
				t.Errorf("%d %s requests", n, method)
			}
		}
	})
}
