package mcp_test

import (
	"fmt"
	"maps"
	"regexp"
	"slices"
	"strings"
	"testing"

	"courses/server/mcp"
)

// The ports of buildBatch (web/src/features/events/saveEvent.test.ts), of
// eventEndDate, isLongEvent, formerPeriod, shortens and hasMeasure
// (formDraft.test.ts), named after their cases. The ids are those of the TS
// fixture (testFixture.ts): the planner does not check them.

const (
	me        = "aliceRunner0000"
	trailType = "trail0000000000"
)

var idFormat = regexp.MustCompile(`^[a-z0-9]{15}$`)

// newDraft is a new event with two formats: a 42 km trail on the second day, and
// a 15 km one.
func newDraft(change func(*mcp.EventDraft)) mcp.EventDraft {
	draft := mcp.EventDraft{
		Name: "Trail des Crêtes", Location: "Annecy",
		StartDate: "2026-06-13", EndDate: "2026-06-14",
		Formats: []mcp.FormatDraft{
			{RaceType: trailType, DistanceKm: 42, TimeLimitMin: 600, Date: "2026-06-14"},
			{RaceType: trailType, DistanceKm: 15, ElevationGainM: 700},
		},
	}
	if change != nil {
		change(&draft)
	}
	return draft
}

// The formats of the fixture: F42 (Trail, 42 km, 10 h, 2400 m, on the second
// day) and F15 (Trail, 15 km, 700 m, no date of its own).
func draftF42() mcp.FormatDraft {
	return mcp.FormatDraft{ID: "f42", RaceType: trailType, DistanceKm: 42, TimeLimitMin: 600, ElevationGainM: 2400, Date: "2026-06-14"}
}

func draftF15() mcp.FormatDraft {
	return mcp.FormatDraft{ID: "f15", RaceType: trailType, DistanceKm: 15, ElevationGainM: 700}
}

// existing is the event of the fixture as it is stored: « Trail des Crêtes »,
// in Annecy, 13-14 June, F42 and F15.
func existing() *mcp.StoredEvent {
	return &mcp.StoredEvent{
		ID: "event", Name: "Trail des Crêtes", Location: "Annecy", StartDate: "2026-06-13", EndDate: "2026-06-14",
		Formats: []mcp.FormatDraft{draftF42(), draftF15()},
	}
}

// datedExisting is the event of the fixture with F15 dated on the first day too.
func datedExisting() *mcp.StoredEvent {
	stored := existing()
	stored.Formats[1].Date = "2026-06-13"
	return stored
}

// editDraft is the draft that changes nothing of the fixture, ids included.
func editDraft(change func(*mcp.EventDraft)) mcp.EventDraft {
	draft := mcp.EventDraft{
		ID: "event", Name: "Trail des Crêtes", Location: "Annecy",
		StartDate: "2026-06-13", EndDate: "2026-06-14",
		Formats: []mcp.FormatDraft{draftF42(), draftF15()},
	}
	if change != nil {
		change(&draft)
	}
	return draft
}

// collectionOf is the collection of the records that an operation writes.
func collectionOf(op mcp.BatchOp) string {
	rest, _ := strings.CutPrefix(op.URL, "/api/collections/")
	collection, _, _ := strings.Cut(rest, "/")
	return collection
}

// actionOf is what an operation does, as saveEvent.test.ts says it.
func actionOf(op mcp.BatchOp) string {
	switch op.Method {
	case "POST":
		return "create"
	case "PATCH":
		return "update"
	case "DELETE":
		return "delete"
	}
	return op.Method
}

// idOf is the id of the record of an operation: in the body of a creation, at
// the end of the path otherwise.
func idOf(op mcp.BatchOp) string {
	if op.Method == "POST" {
		id, _ := op.Body["id"].(string)
		return id
	}
	return op.URL[strings.LastIndexByte(op.URL, '/')+1:]
}

func summaryOf(ops []mcp.BatchOp) []string {
	var out []string
	for _, op := range ops {
		out = append(out, actionOf(op)+" "+collectionOf(op))
	}
	return out
}

func opIDs(ops []mcp.BatchOp) []string {
	var out []string
	for _, op := range ops {
		out = append(out, idOf(op))
	}
	return out
}

func wantSummary(t *testing.T, ops []mcp.BatchOp, want ...string) {
	t.Helper()
	if got := summaryOf(ops); !slices.Equal(got, want) {
		t.Errorf("the operations are %q, want %q", got, want)
	}
}

// wantBody checks the fields of want in the body of op (toMatchObject).
func wantBody(t *testing.T, op mcp.BatchOp, want map[string]any) {
	t.Helper()
	for key, value := range want {
		if got, ok := op.Body[key]; !ok || fmt.Sprint(got) != fmt.Sprint(value) {
			t.Errorf("%s %s: %s = %v, want %v", op.Method, op.URL, key, got, value)
		}
	}
}

// wantExactBody checks that the body of op is want (toEqual).
func wantExactBody(t *testing.T, op mcp.BatchOp, want map[string]any) {
	t.Helper()
	if !maps.EqualFunc(op.Body, want, func(a, b any) bool { return fmt.Sprint(a) == fmt.Sprint(b) }) {
		t.Errorf("%s %s: the body is %v, want %v", op.Method, op.URL, op.Body, want)
	}
}

// ---------------------------------------------------------------------------
// buildBatch, creation

func TestPlan_Creation_EventFormatsThenMyParticipation(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 0, Status: "registered"} }), nil, me)
	wantSummary(t, ops, "create events", "create formats", "create formats", "create participations")
	for _, op := range ops {
		if op.Method != "POST" || !strings.HasSuffix(op.URL, "/records") {
			t.Errorf("a creation is %s %s, want POST …/records", op.Method, op.URL)
		}
	}
}

func TestPlan_Creation_IDsAreMadeHere(t *testing.T) {
	ops, eventID, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 0, Status: "registered"} }), nil, me)
	ids := opIDs(ops)
	for _, id := range ids {
		if !idFormat.MatchString(id) {
			t.Errorf("the id %q is not one of PocketBase", id)
		}
	}
	if len(slices.Compact(slices.Sorted(slices.Values(ids)))) != 4 {
		t.Errorf("the ids %q are not all different", ids)
	}
	if ids[0] != eventID {
		t.Errorf("the event is %q, the plan says %q", ids[0], eventID)
	}
}

func TestPlan_Creation_FormatsSayTheirEvent(t *testing.T) {
	ops, eventID, _ := mcp.PlanBatch(newDraft(nil), nil, me)
	for _, op := range ops[1:3] {
		wantBody(t, op, map[string]any{"event": eventID})
	}
}

func TestPlan_Creation_MyParticipationOnTheFirstFormat(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 0, Status: "registered"} }), nil, me)
	wantBody(t, ops[3], map[string]any{"runner": me, "event": idOf(ops[0]), "format": idOf(ops[1]), "status": "registered"})
	if len(ops[3].Body) != 5 {
		t.Errorf("the participation is %v, want its id, runner, event, format and status", ops[3].Body)
	}
}

func TestPlan_Creation_MyParticipationOnTheEventOfTheBatch(t *testing.T) {
	ops, eventID, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 1, Status: "registered"} }), nil, me)
	if collectionOf(ops[3]) != "participations" {
		t.Fatalf("the fourth operation is on %s", collectionOf(ops[3]))
	}
	wantBody(t, ops[3], map[string]any{"event": eventID})
}

func TestPlan_Creation_ItCanBeOnTheOtherFormat(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 1, Status: "interested"} }), nil, me)
	wantBody(t, ops[3], map[string]any{"runner": me, "event": idOf(ops[0]), "format": idOf(ops[2]), "status": "interested"})
}

func TestPlan_Creation_WithoutJoinNoParticipation(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(nil), nil, me)
	wantSummary(t, ops, "create events", "create formats", "create formats")
}

func TestPlan_Creation_NotFilledInIsEmptyOrZero(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.EndDate = "" }), nil, me)
	wantExactBody(t, ops[0], map[string]any{
		"id": idOf(ops[0]), "name": "Trail des Crêtes", "location": "Annecy", "start_date": "2026-06-13",
		"end_date": "", "registration_url": "", "registration_deadline": "", "registration_opening": "",
		"registration_opening_time": "", "date_precision": "", "notes": "",
	})
	// And the creator is never sent: the server sets it.
	if _, ok := ops[0].Body["created_by"]; ok {
		t.Error("the event is sent with its creator")
	}
	wantExactBody(t, ops[2], map[string]any{
		"id": idOf(ops[2]), "event": idOf(ops[0]), "name": "", "race_type": trailType,
		"distance_km": 15, "duration_min": 0, "time_limit_min": 0, "elevation_gain_m": 700,
		"price_eur": 0, "route_url": "", "date": "", "start_time": "",
	})
}

func TestPlan_Creation_RouteLinkSentWhenFilledEmptyOtherwise(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) {
		d.Formats[0].RouteURL = "https://www.openrunner.com/route-details/123"
	}), nil, me)
	wantBody(t, ops[1], map[string]any{"route_url": "https://www.openrunner.com/route-details/123"})
	wantBody(t, ops[2], map[string]any{"route_url": ""})
	// The track itself never goes in the batch: it is a file (set_track).
	if _, ok := ops[1].Body["gpx"]; ok {
		t.Error("a format is sent with a track")
	}
}

func TestPlan_Creation_DeadlineAndPriceSentWhenFilled(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) {
		d.RegistrationDeadline = "2026-06-10"
		d.Formats[0].PriceEur = 42.5
	}), nil, me)
	wantBody(t, ops[0], map[string]any{"registration_deadline": "2026-06-10"})
	wantBody(t, ops[1], map[string]any{"price_eur": 42.5})
	wantBody(t, ops[2], map[string]any{"price_eur": 0})
}

func TestPlan_Creation_AFormatWithAnIDKeepsIt(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Formats[0].ID = "mine12345678901" }), nil, me)
	if got := idOf(ops[1]); got != "mine12345678901" {
		t.Errorf("the format is created as %q, want its own id", got)
	}
}

func TestPlan_Creation_GivesTheIDOfEachFormat(t *testing.T) {
	ops, _, formatIDs := mcp.PlanBatch(newDraft(nil), nil, me)
	if want := []string{idOf(ops[1]), idOf(ops[2])}; !slices.Equal(formatIDs, want) {
		t.Errorf("the formats are %q, want %q", formatIDs, want)
	}
}

// What a failed request is about: the target and the index of each operation.
func TestPlan_Creation_TargetsOfTheOperations(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) { d.Join = &mcp.JoinDraft{FormatIndex: 1, Status: "registered"} }), nil, me)
	var got []string
	for _, op := range ops {
		got = append(got, fmt.Sprint(op.Target, " ", op.Format))
	}
	if want := []string{"event -1", "format 0", "format 1", "participation -1"}; !slices.Equal(got, want) {
		t.Errorf("the targets are %q, want %q", got, want)
	}
}

// ---------------------------------------------------------------------------
// buildBatch, modification

// The TS test sends the formats that stay as they are, and the event as it is;
// here they change (a price each, and the name of the event), and
// TestPlan_UnchangedFormatsAreNotSent is the one where they do not.
func TestPlan_Modification_UpdatesKeptFormatsThenTheEvent(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.Name = "Trail des Crêtes 2026"
		d.Formats[0].PriceEur = 65
		d.Formats[1].PriceEur = 25
	})
	ops, eventID, _ := mcp.PlanBatch(draft, existing(), me)
	if eventID != "event" {
		t.Errorf("the event is %q", eventID)
	}
	wantSummary(t, ops, "update formats", "update formats", "update events")
	if got := opIDs(ops); !slices.Equal(got, []string{"f42", "f15", "event"}) {
		t.Errorf("the ids are %q", got)
	}
	for _, op := range ops[:2] {
		if _, ok := op.Body["event"]; ok {
			t.Errorf("the format %s is sent with its event", idOf(op))
		}
		if op.Method != "PATCH" || op.URL != "/api/collections/formats/records/"+idOf(op) {
			t.Errorf("an update is %s %s", op.Method, op.URL)
		}
	}
	if _, ok := ops[2].Body["created_by"]; ok {
		t.Error("the event is sent with its creator")
	}
	// The dates are those of the draft: they all are days the event has.
	wantBody(t, ops[0], map[string]any{"date": "2026-06-14", "price_eur": 65})
	if ops[2].URL != "/api/collections/events/records/event" {
		t.Errorf("the event is updated at %s", ops[2].URL)
	}
	// The event is sent with what changes, and nothing else.
	wantExactBody(t, ops[2], map[string]any{"name": "Trail des Crêtes 2026"})
}

func TestPlan_Modification_RemovedFormatIsDeleted(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.Formats = d.Formats[:1]
		d.Formats[0].Name = "Le grand tour"
	})
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	var deletes []mcp.BatchOp
	for _, op := range ops {
		if op.Method == "DELETE" {
			deletes = append(deletes, op)
		}
	}
	if len(deletes) != 1 || deletes[0].URL != "/api/collections/formats/records/f15" || deletes[0].Body != nil {
		t.Errorf("the deletions are %+v, want F15's alone, without a body", deletes)
	}
	if deletes[0].Target != "removal" || deletes[0].Format != -1 {
		t.Errorf("the deletion is about %s %d, want a removal", deletes[0].Target, deletes[0].Format)
	}
	updates := 0
	for _, op := range ops {
		if collectionOf(op) == "formats" && op.Method != "DELETE" {
			updates++
		}
	}
	if updates != 1 {
		t.Errorf("%d other operations on the formats, want 1", updates)
	}
}

func TestPlan_Modification_AFormatWithNoIDIsNew(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.Formats = append(d.Formats, mcp.FormatDraft{RaceType: trailType, DurationMin: 360})
	})
	ops, _, formatIDs := mcp.PlanBatch(draft, existing(), me)
	var created []mcp.BatchOp
	for _, op := range ops {
		if op.Method == "POST" {
			created = append(created, op)
		}
	}
	if len(created) != 1 || collectionOf(created[0]) != "formats" || !idFormat.MatchString(idOf(created[0])) {
		t.Fatalf("the creations are %+v, want one format", created)
	}
	wantBody(t, created[0], map[string]any{"event": "event"})
	if want := []string{"f42", "f15", idOf(created[0])}; !slices.Equal(formatIDs, want) {
		t.Errorf("the formats are %q, want %q", formatIDs, want)
	}
	if created[0].Target != "format" || created[0].Format != 2 {
		t.Errorf("the creation is about %s %d, want format 2", created[0].Target, created[0].Format)
	}
}

func TestPlan_Modification_ClearedFieldsSentEmpty(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.EndDate = ""
		d.Formats = []mcp.FormatDraft{{ID: "f15", RaceType: trailType, DistanceKm: 15}}
	})
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	for _, op := range ops {
		switch idOf(op) {
		case "event":
			wantBody(t, op, map[string]any{"end_date": ""})
		case "f15":
			wantBody(t, op, map[string]any{"date": "", "time_limit_min": 0, "elevation_gain_m": 0})
		}
	}
}

func TestPlan_Modification_RemovedFormatsGoFirst(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.EndDate = ""
		d.Formats = []mcp.FormatDraft{{ID: "f15", RaceType: trailType, DistanceKm: 15}}
	})
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	wantSummary(t, ops, "delete formats", "update formats", "update events")
}

func TestPlan_Modification_NewFormatsAfterTheEvent(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.EndDate = "2026-06-15"
		d.Formats = append(d.Formats, mcp.FormatDraft{RaceType: trailType, DurationMin: 360, Date: "2026-06-15"})
		// The formats that stay change, as in the TS test, where they are sent.
		d.Formats[0].Name, d.Formats[1].Name = "Grand tour", "Petit tour"
	})
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	wantSummary(t, ops, "update formats", "update formats", "update events", "create formats")
}

func TestPlan_Modification_DateWaitsForTheEvent(t *testing.T) {
	draft := editDraft(func(d *mcp.EventDraft) {
		d.EndDate = "2026-06-15"
		d.Formats[0].Date = "2026-06-15"
		d.Formats[1].Name = "Petit tour"
	})
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	wantSummary(t, ops, "update formats", "update formats", "update events", "update formats")
	if idOf(ops[0]) != "f42" {
		t.Fatalf("the first operation is on %s, want F42", idOf(ops[0]))
	}
	wantBody(t, ops[0], map[string]any{"date": "", "distance_km": 42})
	// The late request sends nothing but the date, and never the event.
	if idOf(ops[3]) != "f42" || ops[3].Method != "PATCH" {
		t.Errorf("the late operation is %s %s", ops[3].Method, ops[3].URL)
	}
	wantExactBody(t, ops[3], map[string]any{"date": "2026-06-15"})
	if ops[3].Target != "format" || ops[3].Format != 0 {
		t.Errorf("the late operation is about %s %d, want format 0", ops[3].Target, ops[3].Format)
	}
}

// The differences with buildBatch: a format that stays as it is gets no
// operation, and the event is sent with the fields that change only, or not at
// all, so that a tool never writes back what it read over the change of
// somebody else (spec § 6.5).
func TestPlan_UnchangedFormatsAreNotSent(t *testing.T) {
	t.Run("the event alone changes", func(t *testing.T) {
		ops, _, formatIDs := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) { d.Name = "Trail des Crêtes 2026" }), existing(), me)
		wantSummary(t, ops, "update events")
		wantExactBody(t, ops[0], map[string]any{"name": "Trail des Crêtes 2026"})
		if !slices.Equal(formatIDs, []string{"f42", "f15"}) {
			t.Errorf("the formats are %q", formatIDs)
		}
	})
	t.Run("one format changes: the event is not sent", func(t *testing.T) {
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) { d.Formats[1].DistanceKm = 16 }), existing(), me)
		wantSummary(t, ops, "update formats")
		if idOf(ops[0]) != "f15" {
			t.Errorf("the format sent is %s, want F15", idOf(ops[0]))
		}
	})
	t.Run("an undated format given a day the event gains: the late date alone", func(t *testing.T) {
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) {
			d.EndDate = "2026-06-15"
			d.Formats[1].Date = "2026-06-15"
		}), existing(), me)
		wantSummary(t, ops, "update events", "update formats")
		wantExactBody(t, ops[0], map[string]any{"end_date": "2026-06-15"})
		wantExactBody(t, ops[1], map[string]any{"date": "2026-06-15"})
	})
	t.Run("nothing changes: nothing is sent", func(t *testing.T) {
		ops, eventID, formatIDs := mcp.PlanBatch(editDraft(nil), existing(), me)
		if len(ops) != 0 || eventID != "event" || !slices.Equal(formatIDs, []string{"f42", "f15"}) {
			t.Errorf("the plan is %v, %q, %q; want no operation", summaryOf(ops), eventID, formatIDs)
		}
	})
	t.Run("each field of the event that changes, alone", func(t *testing.T) {
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) {
			d.Location = "Annecy-le-Vieux"
			d.RegistrationURL = "https://inscriptions.example.test"
			d.RegistrationDeadline = "2026-05-31"
			d.Notes = "Navette."
			d.StartDate = "2026-06-12"
		}), existing(), me)
		wantSummary(t, ops, "update events")
		wantExactBody(t, ops[0], map[string]any{
			"location": "Annecy-le-Vieux", "registration_url": "https://inscriptions.example.test",
			"registration_deadline": "2026-05-31", "notes": "Navette.", "start_date": "2026-06-12",
		})
	})
}

// ---------------------------------------------------------------------------
// buildBatch, the dates of the event and of its formats move together

// stored is the event as the server has it while a batch runs.
type stored struct {
	start, end string
	month      bool
	formats    map[string]string
}

// runOnServer runs the operations against the two checks of the server
// (server/events/hooks.go): the date of a format against the event as it is
// stored, and the dates of an event against the formats as they are stored,
// each time a request runs. An update of the event that does not send a day
// leaves it as it is stored.
func runOnServer(ops []mcp.BatchOp, view *mcp.StoredEvent) (stored, error) {
	s := stored{start: view.StartDate, end: view.EndDate, month: view.DatePrecision == "month", formats: map[string]string{}}
	for _, f := range view.Formats {
		s.formats[f.ID] = f.Date
	}
	within := func(day, start, end string) bool { return day >= start && (end == "" || day <= end) }
	for index, op := range ops {
		switch collectionOf(op) {
		case "events":
			start, ok := op.Body["start_date"].(string)
			if !ok {
				start = s.start
			}
			end, ok := op.Body["end_date"].(string)
			if !ok {
				end = s.end
			}
			month := s.month
			if precision, ok := op.Body["date_precision"].(string); ok {
				month = precision == "month"
			}
			for id, day := range s.formats {
				if month && day != "" {
					return s, fmt.Errorf("request %d: the event becomes a month while %s has a date", index, id)
				}
				if day != "" && !within(day, start, end) {
					return s, fmt.Errorf("request %d: the date %s of %s is out of the event", index, day, id)
				}
			}
			s.start, s.end, s.month = start, end, month
		case "formats":
			id := idOf(op)
			if op.Method == "DELETE" {
				delete(s.formats, id)
				continue
			}
			day, ok := op.Body["date"].(string)
			if !ok {
				day = s.formats[id]
			}
			if day != "" && s.month {
				return s, fmt.Errorf("request %d: %s has a date, and the event is a month", index, id)
			}
			if day != "" && !within(day, s.start, s.end) {
				return s, fmt.Errorf("request %d: the date %s of %s is out of the event", index, day, id)
			}
			if at, _ := op.Body["start_time"].(string); at != "" && s.month {
				return s, fmt.Errorf("request %d: %s has a start time, and the event is a month", index, id)
			}
			s.formats[id] = day
		}
	}
	return s, nil
}

// movedDraft is editDraft's event with the dates of the event and of each format
// (F42, F15) given.
func movedDraft(start, end string, dates [2]string) mcp.EventDraft {
	return editDraft(func(d *mcp.EventDraft) {
		d.StartDate, d.EndDate = start, end
		d.Formats[0].Date, d.Formats[1].Date = dates[0], dates[1]
	})
}

func TestPlan_DatesMoveTogether_PostponeTwoDayEvent(t *testing.T) {
	// 13-14 to 20-21, F42 to the 21st.
	ops, _, _ := mcp.PlanBatch(movedDraft("2026-06-20", "2026-06-21", [2]string{"2026-06-21", ""}), existing(), me)
	// The format waits (no date), the event moves, then the format gets its day.
	// F15 does not change: it has no date, and goes with the first day.
	wantSummary(t, ops, "update formats", "update events", "update formats")
	if got := opIDs(ops); !slices.Equal(got, []string{"f42", "event", "f42"}) {
		t.Errorf("the ids are %q", got)
	}
	wantBody(t, ops[0], map[string]any{"date": ""})
	wantExactBody(t, ops[2], map[string]any{"date": "2026-06-21"})
	for _, op := range ops {
		if _, ok := op.Body["event"]; ok && collectionOf(op) == "formats" {
			t.Errorf("the format %s is sent with its event", idOf(op))
		}
	}
	s, err := runOnServer(ops, existing())
	if err != nil {
		t.Fatal(err)
	}
	if s.start != "2026-06-20" || s.end != "2026-06-21" || s.formats["f42"] != "2026-06-21" {
		t.Errorf("the server has %+v", s)
	}
}

func TestPlan_DatesMoveTogether_OverlappingShift(t *testing.T) {
	// 13-14 June becomes 14-15 June: F15 (the 13th) is cleared, F42 (the 14th)
	// moves to the 15th.
	ops, _, _ := mcp.PlanBatch(movedDraft("2026-06-14", "2026-06-15", [2]string{"2026-06-15", ""}), datedExisting(), me)
	wantSummary(t, ops, "update formats", "update formats", "update events", "update formats")
	s, err := runOnServer(ops, datedExisting())
	if err != nil {
		t.Fatal(err)
	}
	if s.start != "2026-06-14" || s.end != "2026-06-15" || s.formats["f42"] != "2026-06-15" || s.formats["f15"] != "" {
		t.Errorf("the server has %+v", s)
	}
}

func TestPlan_DatesMoveTogether_TheServerRefusesTheEventFirst(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(movedDraft("2026-06-20", "2026-06-21", [2]string{"2026-06-21", ""}), existing(), me)
	i := slices.IndexFunc(ops, func(op mcp.BatchOp) bool { return collectionOf(op) == "events" })
	if i < 0 {
		t.Fatal("no event request")
	}
	reordered := append([]mcp.BatchOp{ops[i]}, slices.Delete(slices.Clone(ops), i, i+1)...)
	if _, err := runOnServer(reordered, existing()); err == nil || !strings.Contains(err.Error(), "out of the event") {
		t.Errorf("the event first: %v, want a date out of the event", err)
	}
}

// Every final state that is valid is saved by the same batch.
func TestPlan_DatesMoveTogether_EveryValidFinalState(t *testing.T) {
	for _, row := range []struct {
		name, start, end string
		dates            [2]string
	}{
		{"the same dates", "2026-06-13", "2026-06-14", [2]string{"2026-06-14", ""}},
		{"shrinking to one day, dates cleared", "2026-06-13", "", [2]string{"", ""}},
		{"extending, F42 moved to the new day", "2026-06-13", "2026-06-15", [2]string{"2026-06-15", ""}},
		{"a disjoint shift, formats dated on both days", "2026-06-20", "2026-06-21", [2]string{"2026-06-21", "2026-06-20"}},
		{"a disjoint shift, dates cleared", "2026-06-20", "2026-06-21", [2]string{"", ""}},
		{"an overlapping shift, F15 on the shared day", "2026-06-14", "2026-06-15", [2]string{"2026-06-15", "2026-06-14"}},
		{"an earlier event", "2026-05-01", "2026-05-02", [2]string{"2026-05-02", "2026-05-01"}},
		{"an open-ended event, F42 on a later day", "2026-06-13", "", [2]string{"2026-06-30", ""}},
	} {
		t.Run(row.name, func(t *testing.T) {
			ops, _, _ := mcp.PlanBatch(movedDraft(row.start, row.end, row.dates), existing(), me)
			s, err := runOnServer(ops, existing())
			if err != nil {
				t.Fatal(err)
			}
			if s.start != row.start || s.end != row.end || s.formats["f42"] != row.dates[0] || s.formats["f15"] != row.dates[1] {
				t.Errorf("the server has %+v, want %s-%s, F42 %q, F15 %q", s, row.start, row.end, row.dates[0], row.dates[1])
			}
		})
	}
}

func TestPlan_DatesMoveTogether_RemovedFormatDoesNotHoldTheEventBack(t *testing.T) {
	draft := movedDraft("2026-06-20", "2026-06-21", [2]string{"", ""})
	draft.Formats = draft.Formats[1:]
	ops, _, _ := mcp.PlanBatch(draft, existing(), me)
	// F15 does not change: it has no date before and none after.
	wantSummary(t, ops, "delete formats", "update events")
	s, err := runOnServer(ops, existing())
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := s.formats["f42"]; ok {
		t.Error("F42 is still there")
	}
}

// ---------------------------------------------------------------------------
// formDraft.ts

func TestEventEndDate(t *testing.T) {
	for _, row := range []struct {
		name  string
		start string
		dates []string
		want  string
	}{
		// sans épreuve datée, l'événement tient sur un jour
		{"no format", "2026-06-13", nil, ""},
		{"one undated", "2026-06-13", []string{""}, ""},
		{"two undated", "2026-06-13", []string{"", ""}, ""},
		// une épreuve plus tard que le début donne la fin
		{"a later format", "2026-06-13", []string{"2026-06-14"}, "2026-06-14"},
		{"across a year", "2026-12-30", []string{"2027-01-02"}, "2027-01-02"},
		// plusieurs épreuves : la plus tardive, quel que soit l'ordre
		{"the latest, in any order", "2026-06-13", []string{"2026-06-14", "2026-06-16", "2026-06-15"}, "2026-06-16"},
		{"the latest, first", "2026-06-13", []string{"2026-06-16", "2026-06-14"}, "2026-06-16"},
		// une épreuve sans date compte pour le premier jour
		{"undated then dated", "2026-06-13", []string{"", "2026-06-15"}, "2026-06-15"},
		{"dated then undated", "2026-06-13", []string{"2026-06-15", ""}, "2026-06-15"},
		// une épreuve le premier jour, ou avant, ne fait pas de fin
		{"on the first day", "2026-06-13", []string{"2026-06-13"}, ""},
		{"two on the first day", "2026-06-13", []string{"2026-06-13", "2026-06-13"}, ""},
		{"before the start", "2026-06-13", []string{"2026-06-12"}, ""},
		{"before the start and after", "2026-06-13", []string{"2026-06-12", "2026-06-14"}, "2026-06-14"},
		// un texte qui n'est pas un jour est laissé de côté, et sans début il n'y a pas de fin
		{"texts that are no days", "2026-06-13", []string{"2026-06-1", "2026-02-31", "demain"}, ""},
		{"a text that is no day and a day", "2026-06-13", []string{"2026-06-1", "2026-06-15"}, "2026-06-15"},
		{"no start", "", []string{"2026-06-15"}, ""},
		{"a start that is no day", "2026-06-1", []string{"2026-06-15"}, ""},
	} {
		if got := mcp.EventEndDate(row.start, row.dates, false); got != row.want {
			t.Errorf("%s: eventEndDate(%q, %q) = %q, want %q", row.name, row.start, row.dates, got, row.want)
		}
	}
}

func TestIsLongEvent(t *testing.T) {
	for _, row := range []struct {
		start, end string
		want       bool
	}{
		// plus de quatorze jours entre le début et la fin
		{"2026-06-13", "2026-06-27", false},
		{"2026-06-13", "2026-06-28", true},
		{"2026-06-13", "2027-06-15", true}, // a year typed wrong
		{"2026-12-25", "2027-01-08", false},
		{"2026-12-25", "2027-01-09", true},
		// un jour, ou pas de jour, n'est pas long
		{"2026-06-13", "", false},
		{"", "2027-06-15", false},
		{"2026-06-1", "2027-06-15", false},
	} {
		if got := mcp.IsLongEvent(row.start, row.end); got != row.want {
			t.Errorf("isLongEvent(%q, %q) = %v, want %v", row.start, row.end, got, row.want)
		}
	}
}

// shortens is formerPeriod and shortens of formDraft.ts: the stored days, and
// the end that saving gives.
func TestShortens(t *testing.T) {
	for _, row := range []struct {
		name                   string
		storedStart, storedEnd string
		end                    string
		want                   bool
	}{
		// shortens — plus de fin, ou une fin plus tôt, raccourcit
		{"no end any more", "2026-06-13", "2026-06-14", "", true},
		{"an earlier end", "2026-06-13", "2026-06-18", "2026-06-15", true},
		// shortens — une fin plus tard, ou rien d'ancien, ne raccourcit pas
		{"a later end", "2026-06-13", "2026-06-14", "2026-06-16", false},
		{"nothing stored", "2026-06-13", "", "", false},
		// formerPeriod — rien à dire avec la même fin
		{"the same end", "2026-06-13", "2026-06-14", "2026-06-14", false},
		// formerPeriod — une fin stockée égale au début (v4) est un jour : rien n'est perdu
		{"a stored end that is the start, made one day", "2026-06-13", "2026-06-13", "", false},
		{"a stored end that is the start, made longer", "2026-06-13", "2026-06-13", "2026-06-15", false},
		// formerPeriod — la fin stockée, quand l'enregistrement en donnerait une autre
		{"the start as the end", "2026-06-13", "2026-06-14", "2026-06-13", true},
	} {
		if got := mcp.Shortens(row.storedStart, row.storedEnd, row.end); got != row.want {
			t.Errorf("%s: shortens(%s-%s, %q) = %v, want %v", row.name, row.storedStart, row.storedEnd, row.end, got, row.want)
		}
	}
}

func TestHasMeasure(t *testing.T) {
	for _, row := range []struct {
		name   string
		format mcp.FormatDraft
		want   bool
	}{
		// a distance, a duration or a time limit is a measure
		{"a distance", mcp.FormatDraft{DistanceKm: 42.195}, true},
		{"a duration", mcp.FormatDraft{DurationMin: 360}, true},
		{"a time limit", mcp.FormatDraft{TimeLimitMin: 2880}, true},
		// nothing, a blank, or zero is none
		{"nothing", mcp.FormatDraft{}, false},
		{"zero", mcp.FormatDraft{DistanceKm: 0, DurationMin: 0, TimeLimitMin: 0}, false},
		// the elevation and the date are not measures
		{"the elevation, the date and a name", mcp.FormatDraft{ElevationGainM: 700, Date: "2026-06-14", Name: "Marathon"}, false},
	} {
		if got := mcp.HasMeasure(row.format); got != row.want {
			t.Errorf("%s: hasMeasure = %v, want %v", row.name, got, row.want)
		}
	}
}

// ---------------------------------------------------------------------------
// The opening of the registration (eventBody and changedEventBody)

// eventBody — l'ouverture et son heure: they go with the event, as text, and
// empty when not given (which is how an update clears them).
func TestPlan_Creation_OpeningAndItsTimeSentWhenFilled(t *testing.T) {
	ops, _, _ := mcp.PlanBatch(newDraft(func(d *mcp.EventDraft) {
		d.RegistrationOpening = "2026-05-01"
		d.RegistrationOpeningTime = "10:00"
	}), nil, me)
	wantBody(t, ops[0], map[string]any{"registration_opening": "2026-05-01", "registration_opening_time": "10:00"})
}

func TestPlan_Modification_OnlyAChangedOpeningIsSent(t *testing.T) {
	t.Run("a new opening, and its time", func(t *testing.T) {
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) {
			d.RegistrationOpening = "2026-05-01"
			d.RegistrationOpeningTime = "10:00"
		}), existing(), me)
		wantSummary(t, ops, "update events")
		wantExactBody(t, ops[0], map[string]any{"registration_opening": "2026-05-01", "registration_opening_time": "10:00"})
	})
	t.Run("only the time moves", func(t *testing.T) {
		was := existing()
		was.RegistrationOpening, was.RegistrationOpeningTime = "2026-05-01", "10:00"
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) {
			d.RegistrationOpening, d.RegistrationOpeningTime = "2026-05-01", "11:30"
		}), was, me)
		wantSummary(t, ops, "update events")
		wantExactBody(t, ops[0], map[string]any{"registration_opening_time": "11:30"})
	})
	t.Run("the same opening sends nothing", func(t *testing.T) {
		was := existing()
		was.RegistrationOpening, was.RegistrationOpeningTime = "2026-05-01", "10:00"
		ops, _, _ := mcp.PlanBatch(editDraft(func(d *mcp.EventDraft) {
			d.RegistrationOpening, d.RegistrationOpeningTime = "2026-05-01", "10:00"
		}), was, me)
		if len(ops) != 0 {
			t.Errorf("the plan is %v, want no operation", summaryOf(ops))
		}
	})
	t.Run("emptied, they go as empty texts", func(t *testing.T) {
		was := existing()
		was.RegistrationOpening, was.RegistrationOpeningTime = "2026-05-01", "10:00"
		ops, _, _ := mcp.PlanBatch(editDraft(nil), was, me)
		wantExactBody(t, ops[0], map[string]any{"registration_opening": "", "registration_opening_time": ""})
	})
}
