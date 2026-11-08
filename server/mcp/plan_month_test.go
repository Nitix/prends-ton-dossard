package mcp_test

import (
	"slices"
	"testing"

	"courses/server/mcp"
)

// The precision of the date (eventBody, buildBatch and eventEndDate): the ports of
// the cases of saveEvent.test.ts « la précision de la date » and of
// formDraft.test.ts « eventEndDate — une course au mois ».

// monthExisting is the event of the fixture as a month: June 2027, its formats
// with no date.
func monthExisting() *mcp.StoredEvent {
	stored := existing()
	stored.StartDate, stored.EndDate, stored.DatePrecision = "2027-06-01", "2027-06-30", "month"
	stored.Formats[0].Date = ""
	return stored
}

// monthDraft is a draft of the fixture's formats, as a month: no date on any format.
func monthDraft(change func(*mcp.EventDraft)) mcp.EventDraft {
	return editDraft(func(d *mcp.EventDraft) {
		d.StartDate, d.EndDate, d.DatePrecision = "2027-06-01", "2027-06-30", "month"
		d.Formats[0].Date = ""
		if change != nil {
			change(d)
		}
	})
}

func TestPlan_Precision_SentWithTheEvent(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(monthDraft(nil), nil, me)
	wantBody(t, ops[0], map[string]any{"date_precision": "month", "start_date": "2027-06-01", "end_date": "2027-06-30"})

	for _, precision := range []string{"day", ""} {
		ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.DatePrecision = precision }), nil, me)
		wantBody(t, ops[0], map[string]any{"date_precision": ""})
	}
}

// buildBatch — passer au mois vide d'abord les dates des épreuves.
func TestPlan_Precision_ToMonthEmptiesTheDatesOfTheFormatsFirst(t *testing.T) {
	// 13-14 June 2026, F42 on the 14th: June 2027 as a month.
	ops, _, _ := mcp.PlanBatch(monthDraft(nil), existing(), me)

	// F15 has no date and is unchanged: the plan sends no request for it.
	wantSummary(t, ops, "update formats", "update events")
	if idOf(ops[0]) != "f42" {
		t.Errorf("the first request is on %s, want F42", idOf(ops[0]))
	}
	wantBody(t, ops[0], map[string]any{"date": ""})
	wantBody(t, ops[1], map[string]any{"date_precision": "month", "start_date": "2027-06-01"})
	s, err := runOnServer(ops, existing())
	if err != nil {
		t.Fatal(err)
	}
	if s.start != "2027-06-01" || s.end != "2027-06-30" || !s.month || s.formats["f42"] != "" {
		t.Errorf("the server holds %+v", s)
	}
}

func TestPlan_Precision_ADraftOfAMonthThatKeptADateDoesNotSendIt(t *testing.T) {
	draft := monthDraft(func(d *mcp.EventDraft) {
		d.Formats[0].Date, d.Formats[1].Date = "2027-06-12", "2027-06-12"
	})

	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	for _, op := range ops {
		if collectionOf(op) == "formats" {
			wantBody(t, op, map[string]any{"date": ""})
		}
	}
	if _, err := runOnServer(ops, existing()); err != nil {
		t.Error(err)
	}

	created, _, _ := mcp.PlanBatch(draft, nil, me)
	wantSummary(t, created, "create events", "create formats", "create formats")
	wantBody(t, created[1], map[string]any{"date": ""})
	wantBody(t, created[2], map[string]any{"date": ""})
}

// buildBatch — passer au jour date les épreuves après la course.
func TestPlan_Precision_ToDayDatesTheFormatsAfterTheEvent(t *testing.T) {
	// June 2027 as a month: back to a day, 12-13 June, F42 on the 13th.
	draft := editDraft(func(d *mcp.EventDraft) {
		d.StartDate, d.EndDate, d.DatePrecision = "2027-06-12", "2027-06-13", ""
		d.Formats[0].Date = "2027-06-13"
	})

	ops, _, _ := mcp.PlanBatch(draft, monthExisting(), me)

	// The stored event is a month, which offers no day: the format keeps its empty date (the
	// plan, unlike the form, sends nothing for a format that does not change), the event changes,
	// then the format gets its day.
	wantSummary(t, ops, "update events", "update formats")
	wantBody(t, ops[0], map[string]any{"date_precision": "", "start_date": "2027-06-12"})
	wantExactBody(t, ops[1], map[string]any{"date": "2027-06-13"})
	s, err := runOnServer(ops, monthExisting())
	if err != nil {
		t.Fatal(err)
	}
	if s.start != "2027-06-12" || s.end != "2027-06-13" || s.month || s.formats["f42"] != "2027-06-13" {
		t.Errorf("the server holds %+v", s)
	}
}

func TestPlan_Precision_ADayInTheStoredMonthStillWaitsForTheEvent(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.StartDate, d.EndDate, d.DatePrecision = "2027-06-01", "2027-06-30", ""
		d.Formats[0].Date = "2027-06-10"
	})

	ops, _, _ := mcp.PlanBatch(draft, monthExisting(), me)

	wantSummary(t, ops, "update events", "update formats")
	wantExactBody(t, ops[1], map[string]any{"date": "2027-06-10"})
	if _, err := runOnServer(ops, monthExisting()); err != nil {
		t.Error(err)
	}
}

func TestPlan_Precision_AMonthThatStaysAMonthSendsNothing(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(monthDraft(nil), monthExisting(), me)
	if len(ops) != 0 {
		t.Errorf("the plan is %v, want no operation", summaryOf(ops))
	}
	ops, _, _ = mcp.PlanBatch(monthDraft(func(d *mcp.EventDraft) { d.Name = "Trail de juin" }), monthExisting(), me)
	wantSummary(t, ops, "update events")
	wantExactBody(t, ops[0], map[string]any{"name": "Trail de juin"})
}

// eventEndDate — une course au mois finit le dernier jour du mois.
func TestEventEndDate_Month(t *testing.T) {
	for _, row := range []struct {
		name, start string
		dates       []string
		want        string
	}{
		{"june", "2027-06-01", nil, "2027-06-30"},
		{"december", "2027-12-01", nil, "2027-12-31"},
		{"a leap february", "2028-02-01", nil, "2028-02-29"},
		{"february", "2027-02-01", nil, "2027-02-28"},
		{"the days of the formats do not give it its end", "2027-06-01", []string{"2027-06-12", "2027-07-02"}, "2027-06-30"},
		{"no start, no month", "", nil, ""},
		{"a month is not a start", "2027-06", nil, ""},
	} {
		if got := mcp.EventEndDate(row.start, row.dates, true); got != row.want {
			t.Errorf("%s: eventEndDate(%q, %q, true) = %q, want %q", row.name, row.start, row.dates, got, row.want)
		}
	}
	if got := mcp.EventEndDate("2027-06-01", slices.Clone([]string{"2027-06-12"}), false); got != "2027-06-12" {
		t.Errorf("without the month, the end is %q, want 2027-06-12", got)
	}
}

// The start time of a format (formatBody and buildBatch): the ports of the cases of
// saveEvent.test.ts « l'heure de départ ».
func TestPlan_StartTime_GoesWithTheFormatAndEmptyClearsIt(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) { d.Formats[0].StartTime = "07:30" })

	ops, _, _ := mcp.PlanBatch(draft, existing(), me)

	for _, op := range ops {
		switch idOf(op) {
		case "f42":
			wantBody(t, op, map[string]any{"start_time": "07:30"})
		}
	}
	created, _, _ := mcp.PlanBatch(newDraft(nil), nil, me)
	for _, op := range created {
		if collectionOf(op) == "formats" {
			wantBody(t, op, map[string]any{"start_time": ""})
		}
	}

	// A start time that is taken off is sent as empty, which clears it.
	stored := existing()
	stored.Formats[0].StartTime = "07:30"
	cleared, _, _ := mcp.PlanBatch(editDraft(nil), stored, me)
	found := false
	for _, op := range cleared {
		if idOf(op) == "f42" {
			wantBody(t, op, map[string]any{"start_time": ""})
			found = true
		}
	}
	if !found {
		t.Error("no request clears the start time of F42")
	}
}

func TestPlan_StartTime_ARaceOfAMonthSendsNone(t *testing.T) {
	draft := monthDraft(func(d *mcp.EventDraft) {
		d.Formats[0].StartTime, d.Formats[1].StartTime = "07:30", "09:00"
	})

	for _, stored := range []*mcp.StoredEvent{nil, existing()} {
		ops, _, _ := mcp.PlanBatch(draft, stored, me)
		formats := 0
		for _, op := range ops {
			if collectionOf(op) == "formats" {
				wantBody(t, op, map[string]any{"start_time": ""})
				formats++
			}
		}
		if formats == 0 {
			t.Error("the plan has no request for a format")
		}
	}
}
