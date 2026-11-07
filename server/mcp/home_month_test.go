package mcp_test

import (
	"slices"
	"testing"

	"courses/server/mcp"
	"courses/server/testutil"
)

// The races that are known by their month only on the home page: the ports of the
// cases of resultsToEnter.test.ts (« une course au mois à partir de la fin du mois »),
// pending.test.ts and MyUpcoming (« une course au mois reste jusqu'à la fin du
// mois »).

// monthRow is a participation of this status on a race of June 2027 that is known by
// its month only: its day is the 1st, which is not the day of the race.
func monthRow(id, status string) mcp.ParticipationRow {
	row := rowOn(id, status, "2027-06-01")
	row.Event.StartDate, row.Event.EndDate, row.Event.DatePrecision = "2027-06-01", "2027-06-30", "month"
	return row
}

func TestToEnterOf_MonthOnlyFromTheEndOfTheMonth(t *testing.T) {
	rows := []mcp.ParticipationRow{monthRow("june", "registered")}
	for _, row := range []struct {
		today string
		want  []string
	}{
		{"2027-06-02", []string{}},
		{"2027-06-15", []string{}},
		// The day of the last day of the month is not over, as the day of any race.
		{"2027-06-30", []string{}},
		{"2027-07-01", []string{"june"}},
		// The window of 60 days counts from the end of the month.
		{"2027-08-29", []string{"june"}},
		{"2027-08-30", []string{}},
	} {
		if got := rowIDs(mcp.ToEnterOf(rows, row.today)); !slices.Equal(got, row.want) {
			t.Errorf("on %s the results to enter are %v, want %v", row.today, got, row.want)
		}
	}
}

func TestPendingOf_MonthOnlyStaysUntilTheMonthIsOver(t *testing.T) {
	rows := []mcp.ParticipationRow{monthRow("june", "registered")}
	for today, want := range map[string]int{"2027-06-15": 1, "2027-06-30": 1, "2027-07-01": 0} {
		if got := len(mcp.PendingOf(rows, today)); got != want {
			t.Errorf("on %s there are %d to confirm, want %d", today, got, want)
		}
	}
}

func TestUpcomingOf_MonthOnlyStaysUntilTheEndOfTheMonth(t *testing.T) {
	rows := []mcp.ParticipationRow{monthRow("june", "interested")}
	for today, want := range map[string][]string{
		"2027-05-20": {"june"}, "2027-06-01": {"june"}, "2027-06-15": {"june"}, "2027-06-30": {"june"}, "2027-07-01": {},
	} {
		if got := rowIDs(mcp.UpcomingOf(rows, today)); !slices.Equal(got, want) {
			t.Errorf("on %s the races to come are %v, want %v", today, got, want)
		}
	}

	// On the event alone, it is the end of the event, which is the end of the month.
	alone := monthRow("alone", "supporter")
	alone.Participation.Format, alone.Format = "", mcp.FormatRecord{}
	if got := rowIDs(mcp.UpcomingOf([]mcp.ParticipationRow{alone}, "2027-06-30")); !slices.Equal(got, []string{"alone"}) {
		t.Errorf("on the event alone, on the last day: %v", got)
	}
	if got := rowIDs(mcp.UpcomingOf([]mcp.ParticipationRow{alone}, "2027-07-01")); len(got) != 0 {
		t.Errorf("on the event alone, the day after: %v", got)
	}
}

func TestUpcomingOf_MonthOnlyAtTheEndOfItsMonth(t *testing.T) {
	// Dated races of June, one on the 30th, and one of July; the month goes after
	// every race of June, even the one that ends the same day, whatever the names.
	dated := func(id, day string) mcp.ParticipationRow {
		row := rowOn(id, "registered", day)
		row.Event.Name = id
		return row
	}
	month := monthRow("a-month", "interested")
	month.Event.Name = "A trail de juin"
	got := rowIDs(mcp.UpcomingOf([]mcp.ParticipationRow{
		month, dated("the-30th", "2027-06-30"), dated("the-20th", "2027-06-20"), dated("july", "2027-07-02"),
	}, "2027-06-10"))
	if want := []string{"the-20th", "the-30th", "a-month", "july"}; !slices.Equal(got, want) {
		t.Errorf("the races to come are %v, want %v", got, want)
	}
}

func TestHome_MonthPrecision(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	june := create(t, app, "events", map[string]any{
		"name": "Trail de juin", "location": "Annecy", "start_date": "2027-06-01", "date_precision": "month",
		"created_by": fx.AliceRunner.Id,
	})
	format := create(t, app, "formats", map[string]any{"event": june.Id, "race_type": fx.Trail.Id, "distance_km": 21})
	registered := create(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": format.Id, "status": "registered", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	unconfirmed := create(t, app, "participations", map[string]any{
		"runner": fx.BobRunner.Id, "format": format.Id, "status": "interested", "confirmed": false, "added_by": fx.AliceRunner.Id,
	})

	row := func(id string, extra map[string]any) []any {
		base := map[string]any{
			"participation_id": id, "event": eventRefOf(june), "format_title": "Trail 21 km", "day": "2027-06-01",
			"date_precision": "month",
		}
		for k, v := range extra {
			base[k] = v
		}
		return []any{base}
	}

	// In the middle of the month: it is to come, with the 1st for its day and the precision said.
	home := homeAt(t, app, fx.Alice, at(2027, 6, 15, 10, 0))
	assertJSON(t, block(t, home, "my_upcoming"), row(registered.Id, map[string]any{
		"status": "registered", "status_label": "Inscrit", "confirmed": true,
	}))
	assertJSON(t, block(t, home, "results_to_enter"), []any{})

	// Bob has it to confirm, after what the fixture has him confirm, with the precision too.
	bob := homeAt(t, app, fx.Bob, at(2027, 6, 15, 10, 0))
	toConfirm := block(t, bob, "to_confirm")
	if got := idsOf(toConfirm, "id"); !slices.Equal(got, []string{fx.P2.Id, unconfirmed.Id}) {
		t.Errorf("Bob has %v to confirm, want the one of the fixture, then his participation in June", got)
	}
	if last, _ := toConfirm[len(toConfirm)-1].(map[string]any); last["date_precision"] != "month" || last["day"] != "2027-06-01" {
		t.Errorf("the participation to confirm is %v, want the 1st and date_precision month", last)
	}
	if first, _ := toConfirm[0].(map[string]any); first["date_precision"] != nil {
		t.Errorf("a race with a day says its precision: %v", first)
	}

	// The day after the month: over, so to enter, and no longer to come.
	home = homeAt(t, app, fx.Alice, at(2027, 7, 1, 10, 0))
	assertJSON(t, block(t, home, "my_upcoming"), []any{})
	assertJSON(t, block(t, home, "results_to_enter"), row(registered.Id, nil))
}
