package mcp

import (
	"cmp"
	"context"
	"errors"
	"fmt"
	"math"
	"net/url"
	"slices"
	"strconv"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// This file has the statistics (spec § 6.4): worked out from the participations
// that have a result ("Terminé" or "Abandon"), by functions that port the ones of
// web/src/features/stats/stats.ts, with the cases of their tests. get_runner uses
// the same ones for the years of a runner.

// resultRow is a race that was started, and what it is: the participation (its
// status is finished or dnf), the runner, the event, and the race with the type
// that gives it its name. Day is the day of the race, whose year is the year of
// the statistics. It is the row of a participation (home.go).
type resultRow = participationRow

// isResult reports whether a status is one that makes a result: a race that was
// started, finished or given up (STARTED of the site's stats.ts).
func isResult(status string) bool {
	return status == "finished" || status == "dnf"
}

// newResultRow ports toResultRow of features/stats/stats.ts: a participation of the
// answer to a request made with expand "runner,event,format.race_type". The shape
// is the API's contract: a race that was started is on a race, so a record without
// its runner, its event, its race or the type of its race is an error.
func newResultRow(record participationRecord) (resultRow, error) {
	if record.Format == "" {
		return resultRow{}, fmt.Errorf("mcp: the participation %s has a result and no format", record.ID)
	}
	return newRow(record, runnerRecord{})
}

// resultsOf are the rows that are results, the latest first (as useResults of the
// site sorts them: the latest race, then the name of the event, then the id of the
// participation). A result with no race is an error, as for the site.
func resultsOf(rows []participationRow) ([]resultRow, error) {
	var results []resultRow
	for _, row := range rows {
		if !isResult(row.Participation.Status) {
			continue
		}
		if row.Participation.Format == "" {
			return nil, fmt.Errorf("mcp: the participation %s has a result and no format", row.Participation.ID)
		}
		results = append(results, row)
	}
	slices.SortFunc(results, latestFirst)
	return results, nil
}

// totals is what a set of races adds up to: Km, Elevation (in meters) and Seconds
// are the sums over the finished races. A measure that is not given counts for
// nothing, and so does an abandon, which only counts in DNF.
type totals struct {
	Finished  int
	DNF       int
	Km        float64
	Elevation int
	Seconds   int
}

// totalsOf ports totalsOf of features/stats/stats.ts: it adds up the races. A
// finished race counts its distance, its elevation gain and its time when they are
// given (the API sends 0 for what is not); an abandon only counts as an abandon,
// whatever else its participation says: a time that survived a change of status
// must not make the totals. Any other status counts for nothing.
func totalsOf(rows []resultRow) totals {
	var sum totals
	for _, row := range rows {
		switch row.Participation.Status {
		case "dnf":
			sum.DNF++
		case "finished":
			sum.Finished++
			sum.Km += row.Format.DistanceKm
			sum.Elevation += row.Format.ElevationGainM
			sum.Seconds += row.Participation.FinishTimeS
		}
	}
	// Distances have decimals: 0.1 + 0.2 must be 0.3, for what is said and for the
	// order of byRunner.
	sum.Km = math.Round(sum.Km*1000) / 1000
	return sum
}

// runnerTotals is the totals of a runner.
type runnerTotals struct {
	Runner runnerRecord
	Totals totals
}

// byRunner ports byRunner of features/stats/stats.ts: the totals of each runner who
// has a race in this year, the one who ran the most kilometers first, then by name
// (and by id, so that the order never depends on the one of the rows). The year is
// the one of the day of the race.
func byRunner(rows []resultRow, year int) []runnerTotals {
	ofRunner := map[string][]resultRow{}
	runners := map[string]runnerRecord{}
	for _, row := range rows {
		if yearOf(row.Day) != year {
			continue
		}
		ofRunner[row.Runner.ID] = append(ofRunner[row.Runner.ID], row)
		runners[row.Runner.ID] = row.Runner
	}
	list := make([]runnerTotals, 0, len(ofRunner))
	for id, ofThisRunner := range ofRunner {
		list = append(list, runnerTotals{Runner: runners[id], Totals: totalsOf(ofThisRunner)})
	}
	slices.SortFunc(list, func(a, b runnerTotals) int {
		return cmp.Or(
			cmp.Compare(b.Totals.Km, a.Totals.Km),
			compareNames(a.Runner.Name, b.Runner.Name),
			cmp.Compare(a.Runner.ID, b.Runner.ID),
		)
	})
	return list
}

// yearTotals is the totals of a year.
type yearTotals struct {
	Year   int
	Totals totals
}

// byYear ports byYear of features/stats/stats.ts: the totals of each year in which
// there is a race, the latest year first.
func byYear(rows []resultRow) []yearTotals {
	ofYear := map[int][]resultRow{}
	for _, row := range rows {
		year := yearOf(row.Day)
		ofYear[year] = append(ofYear[year], row)
	}
	list := make([]yearTotals, 0, len(ofYear))
	for year, ofThisYear := range ofYear {
		list = append(list, yearTotals{Year: year, Totals: totalsOf(ofThisYear)})
	}
	slices.SortFunc(list, func(a, b yearTotals) int { return cmp.Compare(b.Year, a.Year) })
	return list
}

// yearOf is the year of a day written YYYY-MM-DD (0 for what is not one).
func yearOf(day string) int {
	if len(day) < 4 {
		return 0
	}
	year, err := strconv.Atoi(day[:4])
	if err != nil {
		return 0
	}
	return year
}

// ---------------------------------------------------------------------------
// get_stats

// totalsOut is the totals in an answer.
type totalsOut struct {
	Finished       int     `json:"finished" jsonschema:"les courses terminées"`
	DNF            int     `json:"dnf" jsonschema:"les abandons"`
	DistanceKm     float64 `json:"distance_km" jsonschema:"les kilomètres des courses terminées dont la distance est renseignée"`
	ElevationGainM int     `json:"elevation_gain_m" jsonschema:"le dénivelé positif des courses terminées, en mètres, quand il est renseigné"`
	TimeS          int     `json:"time_s" jsonschema:"le temps des courses terminées, en secondes, quand il est renseigné"`
}

func (s totals) out() totalsOut {
	return totalsOut{Finished: s.Finished, DNF: s.DNF, DistanceKm: s.Km, ElevationGainM: s.Elevation, TimeS: s.Seconds}
}

type statsRunnerOut struct {
	Runner runnerRef `json:"runner"`
	totalsOut
}

type getStatsIn struct {
	Year int `json:"year,omitempty" jsonschema:"l'année, sur 4 chiffres ; l'année en cours à Paris par défaut"`
}

type getStatsOut struct {
	Year    int              `json:"year"`
	Runners []statsRunnerOut `json:"runners" jsonschema:"les coureurs qui ont au moins un résultat cette année-là, par kilomètres puis par nom"`
}

// getStatsSchema is the input of get_stats: the schema that the SDK infers, with
// the years that a day can be in. Made once, for the servers that OnServe makes
// again (the schema cache keeps it by pointer).
var getStatsSchema = sync.OnceValue(func() *jsonschema.Schema {
	schema := inputSchema[getStatsIn](nil)
	year := schema.Properties["year"]
	year.Minimum, year.Maximum = ptr(1.0), ptr(9999.0)
	return schema
})

func addGetStats(s *mcpsdk.Server, t *tools) {
	mcpsdk.AddTool(s, &mcpsdk.Tool{
		Name:  "get_stats",
		Title: "Statistiques",
		Description: "Donne les statistiques d'une année, coureur par coureur, comme la page Statistiques du site : " +
			"les courses terminées, les abandons, les kilomètres, le dénivelé et le temps des courses terminées. " +
			"Seuls les coureurs qui ont au moins un résultat cette année-là y sont, par kilomètres puis par nom. " +
			"L'année est celle du jour de l'épreuve. Une course terminée compte sa distance, son D+ et son temps quand ils sont renseignés ; un abandon ne compte que comme abandon.",
		InputSchema: getStatsSchema(),
		Annotations: readOnly(),
	}, t.getStats)
}

func (t *tools) getStats(ctx context.Context, _ *mcpsdk.CallToolRequest, in getStatsIn) (*mcpsdk.CallToolResult, getStatsOut, error) {
	fail := func(err error) (*mcpsdk.CallToolResult, getStatsOut, error) {
		return nil, getStatsOut{}, describe(t.app, err, nil)
	}
	year := cmp.Or(in.Year, yearOf(today()))
	if year < 1 || year > 9999 {
		return nil, getStatsOut{}, errors.New("year : l'année se donne sur 4 chiffres (de 0001 à 9999).")
	}

	// The participations that have a result, in the events that have a day in the
	// year: the day of a race is the one of its own date, which is inside its event.
	// The days are built from a number: they are checked ones.
	first, last := fmt.Sprintf("%04d-01-01", year), fmt.Sprintf("%04d-12-31", year)
	filter := "(status='finished' || status='dnf') && event.start_date<='" + last + "' && (event.end_date>='" + first + "' || event.start_date>='" + first + "')"
	records, err := listAll[participationRecord](ctx, t.inner, "participations",
		url.Values{"filter": {filter}, "sort": {"created"}, "expand": {"runner,event,format.race_type"}}, 500)
	if err != nil {
		return fail(err)
	}
	rows := make([]resultRow, 0, len(records))
	for _, record := range records {
		row, err := newResultRow(record)
		if err != nil {
			return fail(err)
		}
		rows = append(rows, row)
	}

	out := getStatsOut{Year: year, Runners: []statsRunnerOut{}}
	for _, entry := range byRunner(rows, year) {
		out.Runners = append(out.Runners, statsRunnerOut{Runner: entry.Runner.ref(), totalsOut: entry.Totals.out()})
	}
	return nil, out, nil
}
