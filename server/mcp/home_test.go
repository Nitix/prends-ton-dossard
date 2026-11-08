package mcp_test

import (
	"fmt"
	"net/http"
	"slices"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// ---------------------------------------------------------------------------
// The ports of the functions of the site that the home page is made of. Each
// test is named after the TS function it ports and holds the cases of its tests.

// rowOn is a participation of this status on a race of this day, of the event
// "Trail des Crêtes", that nobody has confirmed.
func rowOn(id, status, day string) mcp.ParticipationRow {
	return mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: id, Status: status, Format: "f42"},
		Event:         mcp.EventRecord{ID: "trail", Name: "Trail des Crêtes", StartDate: day},
		Format:        mcp.FormatRecord{ID: "f42"},
		Day:           day,
	}
}

// ids are the ids of the participations of the rows, in order.
func rowIDs(rows []mcp.ParticipationRow) []string {
	out := []string{}
	for _, row := range rows {
		out = append(out, row.Participation.ID)
	}
	return out
}

// pendingOf (features/home/pending.test.ts).
func TestPendingOf_ResultsToEnterAreNoLongerToConfirm(t *testing.T) {
	const today = "2026-04-30"
	rows := []mcp.ParticipationRow{
		// Registered and over for 3 days, or for exactly 60: shown to enter.
		rowOn("recent", "registered", "2026-04-27"),
		rowOn("60-days", "registered", "2026-03-01"),
		// Over for 61 days: no longer shown to enter, so it stays here.
		rowOn("61-days", "registered", "2026-02-28"),
		// Registered, and to come or today: it is not over yet.
		rowOn("today", "registered", "2026-04-30"),
		rowOn("to-come", "registered", "2026-06-14"),
		// Not registered: nothing to enter, however old.
		rowOn("interested", "interested", "2026-04-27"),
		rowOn("supporter", "supporter", "2026-04-27"),
	}

	got := rowIDs(mcp.PendingOf(rows, today))
	if want := []string{"61-days", "today", "to-come", "interested", "supporter"}; !slices.Equal(got, want) {
		t.Errorf("to confirm: %v, want %v", got, want)
	}
	// The list it was given is left as it is.
	if len(rows) != 7 || rows[0].Participation.ID != "recent" {
		t.Errorf("the rows were changed: %v", rowIDs(rows))
	}
}

// todosOf (features/home/registrationTodo.test.ts). The rows are the runner's own:
// the site's cases about who the runner is are the ones of the tool.

// trailEvent is the event of the cases below, with this deadline.
func trailEvent(deadline string) mcp.EventRecord {
	return mcp.EventRecord{ID: "trail", Name: "Trail des Crêtes", StartDate: "2026-06-13", EndDate: "2026-06-14", RegistrationDeadline: deadline}
}

// todoOn is a participation of this status on the format f42 of the event.
func todoOn(id, status string, event mcp.EventRecord) mcp.ParticipationRow {
	return mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: id, Status: status, Format: "f42"},
		Event:         event,
		Format:        mcp.FormatRecord{ID: "f42"},
		Day:           event.StartDate,
	}
}

func todoIDs(todos []mcp.RegistrationTodo) []string {
	out := []string{}
	for _, todo := range todos {
		out = append(out, todo.Row.Participation.ID)
	}
	return out
}

func TestTodosOf_OnlyInterestedWithADeadlineNotPassed(t *testing.T) {
	const today = "2026-04-30"
	trail := trailEvent("2026-06-10")

	if got := todoIDs(mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", trail)}, today)); !slices.Equal(got, []string{"p2"}) {
		t.Errorf("interested, deadline to come: %v, want p2", got)
	}

	// The other statuses are not to do: registered, finished, did not finish, not
	// starting, supporter.
	for _, status := range []string{"registered", "finished", "dnf", "dns", "supporter"} {
		if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p", status, trail)}, today); len(got) != 0 {
			t.Errorf("%s: %v, want nothing to do", status, todoIDs(got))
		}
	}

	// No deadline: nothing to do before a day.
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p", "interested", trailEvent(""))}, today); len(got) != 0 {
		t.Errorf("no deadline: %v", todoIDs(got))
	}
	// A deadline that has passed, the event being still to come: closed.
	lyon := mcp.EventRecord{ID: "lyon", Name: "10 km de Lyon", StartDate: "2026-06-22", RegistrationDeadline: "2026-04-29"}
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p-lyon", "interested", lyon)}, today); len(got) != 0 {
		t.Errorf("a closed registration: %v", todoIDs(got))
	}
	// An event that is over, and so is its deadline.
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", trail)}, "2026-06-15"); len(got) != 0 {
		t.Errorf("an event that is over: %v", todoIDs(got))
	}
	// The day of the deadline one can still register.
	got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", trail)}, "2026-06-10")
	if len(got) != 1 || got[0].Deadline != "2026-06-10" || got[0].DaysLeft != 0 {
		t.Errorf("the day of the deadline: %+v, want the deadline of 2026-06-10, 0 days left", got)
	}
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", trail)}, "2026-06-11"); len(got) != 0 {
		t.Errorf("the day after the deadline: %v", todoIDs(got))
	}
}

func TestTodosOf_SortedByDeadlineThenName(t *testing.T) {
	const today = "2026-04-30"
	lyon := mcp.EventRecord{ID: "lyon", Name: "10 km de Lyon", StartDate: "2026-06-22", RegistrationDeadline: "2026-06-10"}
	// "Marathon de Paris" has the earliest deadline.
	paris := mcp.EventRecord{ID: "paris", Name: "Marathon de Paris", StartDate: "2026-06-20", RegistrationDeadline: "2026-05-20"}
	rows := []mcp.ParticipationRow{
		todoOn("p2", "interested", trailEvent("2026-06-10")),
		todoOn("p-bob-15", "interested", trailEvent("2026-06-10")),
		todoOn("p-lyon", "interested", lyon),
		todoOn("p-paris", "interested", paris),
	}

	todos := mcp.TodosOf(rows, today)

	// Paris (20 May), then the two of 10 June by event name ("10 km de Lyon" before
	// "Trail des Crêtes"), and by id of participation within the event (p-bob-15
	// before p2).
	if want := []string{"p-paris", "p-lyon", "p-bob-15", "p2"}; !slices.Equal(todoIDs(todos), want) {
		t.Errorf("the order is %v, want %v", todoIDs(todos), want)
	}
	var deadlines []string
	var left []int
	for _, todo := range todos {
		deadlines = append(deadlines, todo.Deadline)
		left = append(left, todo.DaysLeft)
	}
	if want := []string{"2026-05-20", "2026-06-10", "2026-06-10", "2026-06-10"}; !slices.Equal(deadlines, want) {
		t.Errorf("the deadlines are %v, want %v", deadlines, want)
	}
	if want := []int{20, 41, 41, 41}; !slices.Equal(left, want) {
		t.Errorf("the days left are %v, want %v", left, want)
	}
	// The order does not depend on the order the rows come in.
	reversed := slices.Clone(rows)
	slices.Reverse(reversed)
	if got := todoIDs(mcp.TodosOf(reversed, today)); !slices.Equal(got, []string{"p-paris", "p-lyon", "p-bob-15", "p2"}) {
		t.Errorf("reversed: %v", got)
	}
}

// openingOf is the trail, with this opening (and this time), and the deadline of 10 June.
func openingOf(opening, time string) mcp.EventRecord {
	event := trailEvent("2026-06-10")
	event.RegistrationOpening, event.RegistrationOpeningTime = opening, time
	return event
}

func TestTodosOf_AnOpeningToComeIsARegistrationToDo(t *testing.T) {
	// registrationState of registration.test.ts: the opening of 12 May at 10:00.
	trail := openingOf("2026-05-12", "10:00")
	row := todoOn("p2", "interested", trail)

	// The day before: soon, which is the day that orders it, with the days to it.
	got := mcp.TodosOf([]mcp.ParticipationRow{row}, "2026-05-11")
	if len(got) != 1 || got[0].State != "soon" || got[0].Day != "2026-05-12" || got[0].Opening != "2026-05-12" ||
		got[0].OpeningTime != "10:00" || got[0].DaysLeft != 1 || got[0].Deadline != "2026-06-10" {
		t.Errorf("the day before: %+v", got)
	}
	// The day itself: today, all day.
	got = mcp.TodosOf([]mcp.ParticipationRow{row}, "2026-05-12")
	if len(got) != 1 || got[0].State != "today" || got[0].Day != "2026-05-12" || got[0].DaysLeft != 0 {
		t.Errorf("the day itself: %+v", got)
	}
	// The day after: open, with the deadline.
	got = mcp.TodosOf([]mcp.ParticipationRow{row}, "2026-05-13")
	if len(got) != 1 || got[0].State != "open" || got[0].Day != "2026-06-10" || got[0].DaysLeft != 28 {
		t.Errorf("the day after: %+v", got)
	}
	// With no time: the time is empty.
	got = mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", openingOf("2026-05-12", ""))}, "2026-05-01")
	if len(got) != 1 || got[0].State != "soon" || got[0].OpeningTime != "" || got[0].DaysLeft != 11 {
		t.Errorf("no time: %+v", got)
	}
	// An opening with no deadline: to come, it is to do; passed, nothing.
	noDeadline := openingOf("2026-05-12", "10:00")
	noDeadline.RegistrationDeadline = ""
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", noDeadline)}, "2026-05-01"); len(got) != 1 || got[0].Deadline != "" {
		t.Errorf("no deadline, to come: %+v", got)
	}
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "interested", noDeadline)}, "2026-05-13"); len(got) != 0 {
		t.Errorf("no deadline, passed: %v", todoIDs(got))
	}
	// A registered runner is not in it.
	if got := mcp.TodosOf([]mcp.ParticipationRow{todoOn("p2", "registered", trail)}, "2026-05-01"); len(got) != 0 {
		t.Errorf("registered: %v", todoIDs(got))
	}
}

func TestTodosOf_AnOpeningIsSortedByItsDay(t *testing.T) {
	lyon := mcp.EventRecord{ID: "lyon", Name: "10 km de Lyon", StartDate: "2026-06-22", RegistrationDeadline: "2026-05-20"}
	rows := []mcp.ParticipationRow{
		todoOn("p-trail", "interested", openingOf("2026-05-12", "10:00")),
		todoOn("p-lyon", "interested", lyon),
	}
	// Lyon is open with a deadline of 20 May; the trail opens on 12 May, earlier.
	if got := todoIDs(mcp.TodosOf(rows, "2026-05-01")); !slices.Equal(got, []string{"p-trail", "p-lyon"}) {
		t.Errorf("the order is %v, want the opening first", got)
	}
}

func TestTodosOf_AParticipationOnTheEventCounts(t *testing.T) {
	trail := trailEvent("2026-06-10")
	// Nina is interested in the event, and has not chosen a race.
	nina := mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: "pNinaUndecided", Status: "interested"},
		Event:         trail,
		Day:           trail.StartDate,
	}
	// And Bob is on the 42 km.
	bob := todoOn("p2", "interested", trail)

	todos := mcp.TodosOf([]mcp.ParticipationRow{bob, nina}, "2026-04-30")

	if len(todos) != 2 {
		t.Fatalf("%d to do, want 2", len(todos))
	}
	for _, todo := range todos {
		if todo.Deadline != "2026-06-10" || todo.DaysLeft != 41 {
			t.Errorf("%s: deadline %s, %d days left", todo.Row.Participation.ID, todo.Deadline, todo.DaysLeft)
		}
		switch todo.Row.Participation.ID {
		case "pNinaUndecided":
			if todo.Row.Format.ID != "" {
				t.Errorf("a participation on the event has the format %q", todo.Row.Format.ID)
			}
		case "p2":
			// A participation on a format has its format.
			if todo.Row.Format.ID != "f42" {
				t.Errorf("Bob's format is %q", todo.Row.Format.ID)
			}
		default:
			t.Errorf("unexpected %s", todo.Row.Participation.ID)
		}
	}
}

// resultsToEnter (features/results/resultsToEnter.test.ts).

func toEnterRow(id, day, eventName string) mcp.ParticipationRow {
	row := rowOn(id, "registered", day)
	row.Event.Name = eventName
	return row
}

func TestToEnterOf_OnlyRacesOverForSixtyDaysAtMost(t *testing.T) {
	if mcp.ResultsWindowDays != 60 {
		t.Errorf("the window is %d days, want 60", mcp.ResultsWindowDays)
	}
	rows := []mcp.ParticipationRow{
		// To come, and today: the race is not over yet.
		toEnterRow("tomorrow", "2026-05-01", "Trail des Crêtes"),
		toEnterRow("today", "2026-04-30", "Trail des Crêtes"),
		// Yesterday: over.
		toEnterRow("yesterday", "2026-04-29", "Trail des Crêtes"),
		// Exactly 60 days ago (1 March) is still there; 61 days ago is not.
		toEnterRow("60-days", "2026-03-01", "Trail des Crêtes"),
		toEnterRow("61-days", "2026-02-28", "Trail des Crêtes"),
		toEnterRow("last-year", "2025-04-30", "Trail des Crêtes"),
	}

	for _, row := range []struct {
		today string
		want  []string
	}{
		{"2026-04-30", []string{"yesterday", "60-days"}},
		// The window moves with the day.
		{"2026-05-01", []string{"today", "yesterday"}},
		{"2026-04-29", []string{"60-days", "61-days"}},
	} {
		if got := rowIDs(mcp.ToEnterOf(rows, row.today)); !slices.Equal(got, row.want) {
			t.Errorf("on %s: %v, want %v", row.today, got, row.want)
		}
	}
	// Nothing at all.
	if got := mcp.ToEnterOf(nil, "2026-04-30"); len(got) != 0 {
		t.Errorf("no rows: %v", rowIDs(got))
	}
}

func TestToEnterOf_LatestFirst(t *testing.T) {
	rows := []mcp.ParticipationRow{
		toEnterRow("old", "2026-03-15", "Marathon d'hiver"),
		toEnterRow("recent", "2026-04-26", "Trail des Crêtes"),
		// The same day: the name of the event, then the participation.
		toEnterRow("b-2", "2026-04-12", "Trail du Printemps"),
		toEnterRow("a", "2026-04-12", "10 km de Lyon"),
		toEnterRow("b-1", "2026-04-12", "Trail du Printemps"),
	}

	if got, want := rowIDs(mcp.ToEnterOf(rows, "2026-04-30")), []string{"recent", "a", "b-1", "b-2", "old"}; !slices.Equal(got, want) {
		t.Errorf("the order is %v, want %v", got, want)
	}
	// The list it was given is not reordered.
	if got, want := rowIDs(rows), []string{"old", "recent", "b-2", "a", "b-1"}; !slices.Equal(got, want) {
		t.Errorf("the rows were reordered: %v", got)
	}
}

func TestIsResultToEnter_RegisteredAndOverForOneToSixtyDays(t *testing.T) {
	const today = "2026-04-30"
	for _, row := range []struct {
		name, day string
		want      bool
	}{
		// To come, and today: the race is not over yet.
		{"to come", "2026-05-01", false},
		{"today", "2026-04-30", false},
		// Yesterday, and exactly 60 days ago: over, and still asked for.
		{"yesterday", "2026-04-29", true},
		{"60 days ago", "2026-03-01", true},
		// 61 days ago: left alone.
		{"61 days ago", "2026-02-28", false},
	} {
		if got := mcp.IsResultToEnter("registered", row.day, today); got != row.want {
			t.Errorf("registered, %s (%s): %v, want %v", row.name, row.day, got, row.want)
		}
	}
}

func TestIsResultToEnter_AnotherParticipationIsNotToEnter(t *testing.T) {
	for _, status := range []string{"interested", "supporter", "finished", "dnf", "dns"} {
		if mcp.IsResultToEnter(status, "2026-04-27", "2026-04-30") {
			t.Errorf("%s, over for 3 days, is to enter", status)
		}
	}
}

func TestIsResultToEnter_ToEnterOfKeepsExactlyWhatItSays(t *testing.T) {
	// The block and the predicate cannot drift apart: the block is the predicate.
	const today = "2026-04-30"
	days := []string{"2026-05-01", "2026-04-30", "2026-04-29", "2026-03-01", "2026-02-28"}
	var rows []mcp.ParticipationRow
	var want []string
	for _, day := range days {
		rows = append(rows, toEnterRow(day, day, "Trail des Crêtes"))
		if mcp.IsResultToEnter("registered", day, today) {
			want = append(want, day)
		}
	}
	slices.SortFunc(want, func(a, b string) int { return strings.Compare(b, a) })
	if got := rowIDs(mcp.ToEnterOf(rows, today)); !slices.Equal(got, want) {
		t.Errorf("the block holds %v, the predicate keeps %v", got, want)
	}
}

// MyUpcoming (features/home/MyUpcoming.tsx, upcomingOf), on rows.
func TestUpcomingOf_NotBehindAndNotStartingTheNearestFirst(t *testing.T) {
	const today = "2026-06-14"
	// A race of a several-day event is behind by the day of its own, not of the
	// event's end: the 42 km of the 14th is today, the 15 km of the 13th is behind.
	f15 := rowOn("f15", "finished", "2026-06-13")
	f15.Event.EndDate = "2026-06-14"
	f42 := rowOn("f42", "registered", "2026-06-14")
	f42.Event.EndDate = "2026-06-14"
	later := rowOn("later", "interested", "2026-07-05")
	sameDay := rowOn("a-same-day", "interested", "2026-07-05")
	sameDay.Event.Name = "10 km de Lyon"
	dns := rowOn("dns", "dns", "2026-06-20")

	// On the event alone: interested with no race yet, or supporter. It has no
	// day of its own: it is there until the last day of its event, and sorted on
	// the first.
	underway := mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: "underway", Status: "supporter"},
		Event:         mcp.EventRecord{ID: "e", Name: "Raid", StartDate: "2026-06-12", EndDate: "2026-06-15"},
		Day:           "2026-06-12",
	}
	over := mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: "over", Status: "interested"},
		Event:         mcp.EventRecord{ID: "e2", Name: "Cross", StartDate: "2026-06-10", EndDate: "2026-06-13"},
		Day:           "2026-06-10",
	}
	noEnd := mcp.ParticipationRow{
		Participation: mcp.ParticipationRecord{ID: "no-end", Status: "interested"},
		Event:         mcp.EventRecord{ID: "e3", Name: "Foulées", StartDate: "2026-06-14"},
		Day:           "2026-06-14",
	}

	got := rowIDs(mcp.UpcomingOf([]mcp.ParticipationRow{later, f15, dns, over, f42, sameDay, underway, noEnd}, today))
	// By day, then name of the event ("Foulées" before "Trail des Crêtes"), then id
	// of the participation.
	if want := []string{"underway", "no-end", "f42", "a-same-day", "later"}; !slices.Equal(got, want) {
		t.Errorf("the races to come are %v, want %v", got, want)
	}
}

// excerpt (features/comments/excerpt.test.ts).
func TestExcerpt(t *testing.T) {
	for _, row := range []struct {
		name, in string
		max      int
		want     string
	}{
		{"short, unchanged", "Je viens avec Paul.", 140, "Je viens avec Paul."},
		// Right at the limit: nothing to cut.
		{"right at the limit", strings.Repeat("a", 140), 140, strings.Repeat("a", 140)},
		// The text before the dots is at most 140 characters, and whole words.
		{"long, cut at a word with the dots", strings.Repeat("mot ", 50), 140, strings.TrimSuffix(strings.Repeat("mot ", 35), " ") + "…"},
		// "aaaa bbbb" is 9 characters: with a limit of 9 nothing is cut, with 8 the last word goes.
		{"the cut falls on a space: the last word stays", "aaaa bbbb cccc", 9, "aaaa bbbb…"},
		{"the cut is before the last word", "aaaa bbbb cccc", 8, "aaaa…"},
		{"a single word longer than the limit is cut at the limit", "abcdefghij", 5, "abcde…"},
		// Each emoji is two UTF-16 code units: the site counts them so.
		{"never in the middle of a character", "😀😀😀😀", 3, "😀…"},
		{"line breaks become spaces", "ligne 1\n\nligne   2\t fin", 140, "ligne 1 ligne 2 fin"},
		{"and the blanks around go", "  \n début \n", 140, "début"},
		{"a non-breaking space is a space too", "un deux", 140, "un deux"},
		{"nothing", "", 140, ""},
		{"only blanks", " \n\t ", 140, ""},
	} {
		t.Run(row.name, func(t *testing.T) {
			if got := mcp.Excerpt(row.in, row.max); got != row.want {
				t.Errorf("Excerpt(%q, %d) = %q, want %q", row.in, row.max, got, row.want)
			}
		})
	}
	// An emoji is whole or it is not there, whatever the limit.
	for max := 1; max <= 8; max++ {
		got := strings.TrimSuffix(mcp.Excerpt("😀😀😀😀", max), "…")
		if strings.Trim(got, "😀") != "" {
			t.Errorf("max %d: %q is not made of whole emoji", max, got)
		}
	}
}

// ---------------------------------------------------------------------------
// The tool

// homeAt is the home page of somebody, on the day of now.
func homeAt(t *testing.T, app *tests.TestApp, user *core.Record, now time.Time) map[string]any {
	t.Helper()
	mcp.SetNow(t, now)
	result := succeeded(t, callTool(t, app, newToken(t, app, user), "home", nil))
	textIs(t, result)
	return result.Structured
}

// block is a list of the home page, which is a list and never null.
func block(t *testing.T, home map[string]any, name string) []any {
	t.Helper()
	list, ok := home[name].([]any)
	if !ok {
		t.Fatalf("%s is %v, want a list", name, home[name])
	}
	return list
}

// eventRefOf is the shape of a race that an answer points to.
func eventRefOf(event *core.Record) map[string]any {
	return map[string]any{"id": event.Id, "name": event.GetString("name"), "url": siteURL + "/evenements/" + event.Id}
}

// idsOf are the values of a key of the items of a list, in order.
func idsOf(list []any, key string) []string {
	out := []string{}
	for _, item := range list {
		out = append(out, fmt.Sprint(item.(map[string]any)[key]))
	}
	return out
}

// onEvent makes a participation on the event alone, of this runner.
func onEvent(t *testing.T, app core.App, runner, event *core.Record, status string, confirmed bool, addedBy *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "participations", map[string]any{
		"runner": runner.Id, "event": event.Id, "status": status, "confirmed": confirmed, "added_by": addedBy.Id,
	})
}

func TestTools_Home(t *testing.T) {
	june1 := at(2026, 6, 1, 10, 0)

	// The summary of the trail as the group's list shows it to Bob and to Alice.
	trailSummary := func(fx testutil.Fixture, mine map[string]any) map[string]any {
		return map[string]any{
			"id": fx.Event.Id, "name": "Trail des Crêtes", "location": "Annecy",
			"start_date": "2026-06-13", "end_date": "2026-06-14",
			"url": siteURL + "/evenements/" + fx.Event.Id,
			"formats": []any{
				map[string]any{"id": fx.F15.Id, "title": "Trail 15 km", "race_type": "Trail", "date": "2026-06-13"},
				map[string]any{"id": fx.F42.Id, "title": "Trail 42 km", "race_type": "Trail", "date": "2026-06-14"},
			},
			"participants": 3,
			"mine":         []any{mine},
		}
	}

	t.Run("the page of Bob: what Alice added for him, and his plans", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		got := homeAt(t, app, fx.Bob, june1)

		assertJSON(t, got, map[string]any{
			"to_confirm": []any{map[string]any{
				"id": fx.P2.Id, "runner": runnerRef(fx.BobRunner), "status": "interested", "status_label": "Intéressé",
				"confirmed": false, "added_by": runnerRef(fx.AliceRunner),
				"event": eventRefOf(fx.Event), "format_title": "Trail 42 km", "day": "2026-06-14",
			}},
			"registrations_to_do": []any{},
			"results_to_enter":    []any{},
			// What is not confirmed is part of his plans until he refuses it, as on the site.
			"my_upcoming": []any{map[string]any{
				"participation_id": fx.P2.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 42 km",
				"day": "2026-06-14", "status": "interested", "status_label": "Intéressé", "confirmed": false,
			}},
			"group_soon": []any{trailSummary(fx, map[string]any{
				"participation_id": fx.P2.Id, "format_id": fx.F42.Id, "status": "interested", "status_label": "Intéressé",
			})},
			"latest_comments": []any{},
		})
	})

	t.Run("the page of Alice: she is registered, and has nothing to confirm", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		got := homeAt(t, app, fx.Alice, june1)

		assertJSON(t, block(t, got, "to_confirm"), []any{})
		assertJSON(t, block(t, got, "my_upcoming"), []any{map[string]any{
			"participation_id": fx.P1.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 42 km",
			"day": "2026-06-14", "status": "registered", "status_label": "Inscrit", "confirmed": true,
		}})
		assertJSON(t, block(t, got, "group_soon"), []any{trailSummary(fx, map[string]any{
			"participation_id": fx.P1.Id, "format_id": fx.F42.Id, "status": "registered", "status_label": "Inscrit",
		})})
	})

	t.Run("a participation of Bob that is registered and over is to enter, not to confirm", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// Registered by Alice on the 15 km of the 13th, and not confirmed.
		registered := create(t, app, "participations", map[string]any{
			"runner": fx.BobRunner.Id, "format": fx.F15.Id, "status": "registered", "confirmed": false, "added_by": fx.AliceRunner.Id,
		})

		// Before the race: to confirm, with the interested one, the earlier day first.
		got := homeAt(t, app, fx.Bob, june1)
		if want := []string{registered.Id, fx.P2.Id}; !slices.Equal(idsOf(block(t, got, "to_confirm"), "id"), want) {
			t.Errorf("to confirm: %v, want %v", idsOf(block(t, got, "to_confirm"), "id"), want)
		}
		assertJSON(t, block(t, got, "results_to_enter"), []any{})

		// A week after: the result is asked for, and no longer the confirmation.
		got = homeAt(t, app, fx.Bob, at(2026, 6, 20, 10, 0))
		if want := []string{fx.P2.Id}; !slices.Equal(idsOf(block(t, got, "to_confirm"), "id"), want) {
			t.Errorf("a week after, to confirm: %v, want %v", idsOf(block(t, got, "to_confirm"), "id"), want)
		}
		assertJSON(t, block(t, got, "results_to_enter"), []any{map[string]any{
			"participation_id": registered.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 15 km", "day": "2026-06-13",
		}})

		// Past the window of 60 days, nothing asks for it any more but the confirmation.
		got = homeAt(t, app, fx.Bob, at(2026, 8, 20, 10, 0))
		if want := []string{registered.Id, fx.P2.Id}; !slices.Equal(idsOf(block(t, got, "to_confirm"), "id"), want) {
			t.Errorf("past the window, to confirm: %v, want %v", idsOf(block(t, got, "to_confirm"), "id"), want)
		}
		assertJSON(t, block(t, got, "results_to_enter"), []any{})
	})

	// A half marathon whose registrations close on the 5th of June, and Alice
	// interested in it. want is the block that it makes of her home page.
	// An event with no deadline (the trail) holds nothing to do.
	semiWithADeadline := func(t *testing.T) (app *tests.TestApp, fx testutil.Fixture, todo *core.Record, want func(daysLeft int) []any) {
		app = testutil.NewApp(t)
		fx = testutil.Seed(t, app)
		semi := create(t, app, "events", map[string]any{
			"name": "Semi de Chambéry", "location": "Chambéry", "start_date": "2026-06-28", "registration_deadline": "2026-06-05",
			"registration_url": "https://inscriptions.example.test/semi", "created_by": fx.AliceRunner.Id,
		})
		fSemi := create(t, app, "formats", map[string]any{"event": semi.Id, "race_type": fx.Road.Id, "distance_km": 21.1})
		todo = create(t, app, "participations", map[string]any{
			"runner": fx.AliceRunner.Id, "format": fSemi.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
		})
		want = func(daysLeft int) []any {
			return []any{map[string]any{
				"participation_id": todo.Id, "event": eventRefOf(semi), "format_title": "Route 21,1 km",
				"state": "open", "deadline": "2026-06-05", "days_left": daysLeft, "registration_url": "https://inscriptions.example.test/semi",
			}}
		}
		return app, fx, todo, want
	}

	t.Run("registrations to do: interested, the deadline not passed, the day of it included", func(t *testing.T) {
		app, fx, todo, want := semiWithADeadline(t)
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, june1), "registrations_to_do"), want(4))
		// The day of the deadline one can still register.
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 6, 5, 10, 0)), "registrations_to_do"), want(0))
		// The day after, it is closed.
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 6, 6, 10, 0)), "registrations_to_do"), []any{})

		// Registered, it is done.
		update(t, app, todo, map[string]any{"status": "registered"})
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, june1), "registrations_to_do"), []any{})
	})

	t.Run("registrations to do: the day is the one in Paris", func(t *testing.T) {
		app, fx, _, want := semiWithADeadline(t)
		// Paris is two hours ahead of UTC in June: at half past eleven in the evening
		// of the 5th it is still the day of the deadline, and an hour later, which is
		// still the 5th in UTC, the deadline is behind.
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 6, 5, 21, 30)), "registrations_to_do"), want(0))
		assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 6, 5, 22, 30)), "registrations_to_do"), []any{})
	})

	t.Run("results to enter: registered, over for 60 days at most", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		got := homeAt(t, app, fx.Alice, at(2026, 6, 20, 10, 0))
		assertJSON(t, block(t, got, "results_to_enter"), []any{map[string]any{
			"participation_id": fx.P1.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 42 km", "day": "2026-06-14",
		}})
		// The race is behind: not among the races to come.
		assertJSON(t, block(t, got, "my_upcoming"), []any{})

		got = homeAt(t, app, fx.Alice, at(2026, 8, 20, 10, 0))
		assertJSON(t, block(t, got, "results_to_enter"), []any{})
	})

	t.Run("a race of several days under way: what is on the event alone stays, the race of the day before is to enter", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		// Five days, from the 10th to the 14th, with a supporter who confirmed her
		// participation: nothing but the end of the event keeps it among the races to
		// come on the 14th (it is not to confirm, nor registered, and the event started
		// before).
		ultra := create(t, app, "events", map[string]any{
			"name": "Ultra des Lacs", "location": "Annecy", "start_date": "2026-06-10", "end_date": "2026-06-14", "created_by": fx.AliceRunner.Id,
		})
		create(t, app, "formats", map[string]any{"event": ultra.Id, "race_type": fx.Trail.Id, "distance_km": 100, "date": "2026-06-14"})
		supporter := onEvent(t, app, fx.AliceRunner, ultra, "supporter", true, fx.AliceRunner)
		// She is registered on the 15 km of the 13th too, which has been run.
		run := create(t, app, "participations", map[string]any{
			"runner": fx.AliceRunner.Id, "format": fx.F15.Id, "status": "registered", "confirmed": true, "added_by": fx.AliceRunner.Id,
		})

		got := homeAt(t, app, fx.Alice, at(2026, 6, 14, 10, 0))

		assertJSON(t, block(t, got, "my_upcoming"), []any{
			// On the event alone, sorted on its first day.
			map[string]any{
				"participation_id": supporter.Id, "event": eventRefOf(ultra),
				"day": "2026-06-10", "status": "supporter", "status_label": "Supporteur", "confirmed": true,
			},
			map[string]any{
				"participation_id": fx.P1.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 42 km",
				"day": "2026-06-14", "status": "registered", "status_label": "Inscrit", "confirmed": true,
			},
		})
		// The 13th is behind: its result is to enter, and it is not to come.
		assertJSON(t, block(t, got, "results_to_enter"), []any{map[string]any{
			"participation_id": run.Id, "event": eventRefOf(fx.Event), "format_title": "Trail 15 km", "day": "2026-06-13",
		}})
	})

	t.Run("my upcoming races: not those that are not started, the races on the event alone too", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		update(t, app, fx.P1, map[string]any{"status": "dns"})
		supporter := onEvent(t, app, fx.AliceRunner, fx.Event2, "supporter", true, fx.AliceRunner)

		got := homeAt(t, app, fx.Alice, june1)

		assertJSON(t, block(t, got, "my_upcoming"), []any{map[string]any{
			"participation_id": supporter.Id, "event": eventRefOf(fx.Event2),
			"day": "2026-06-22", "status": "supporter", "status_label": "Supporteur", "confirmed": true,
		}})
	})

	t.Run("the next races of the group: five at most, with somebody who starts", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		// Earlier than the trail, with a supporter and nobody else: not one.
		cheering := create(t, app, "events", map[string]any{"name": "Les Foulées", "location": "Aix", "start_date": "2026-06-05", "created_by": fx.AliceRunner.Id})
		onEvent(t, app, fx.AdminRunner, cheering, "supporter", true, fx.AdminRunner)
		// The 10 km of Lyon holds a runner who does not start: not one either.
		create(t, app, "participations", map[string]any{
			"runner": fx.SamRunner.Id, "format": fx.FLyon.Id, "status": "dns", "confirmed": false, "added_by": fx.AliceRunner.Id,
		})
		// Six more, each with somebody interested and no race chosen yet.
		var later []*core.Record
		for i := 1; i <= 6; i++ {
			event := create(t, app, "events", map[string]any{
				"name": fmt.Sprintf("Course %d", i), "location": "Quelque part",
				"start_date": fmt.Sprintf("2026-07-%02d", i), "created_by": fx.AliceRunner.Id,
			})
			onEvent(t, app, fx.AdminRunner, event, "interested", true, fx.AdminRunner)
			later = append(later, event)
		}

		got := homeAt(t, app, fx.Alice, june1)

		want := []string{fx.Event.Id, later[0].Id, later[1].Id, later[2].Id, later[3].Id}
		if ids := idsOf(block(t, got, "group_soon"), "id"); !slices.Equal(ids, want) {
			t.Errorf("the next races are %v, want %v", ids, want)
		}
	})

	t.Run("the latest comments: the five newest, with the beginning of the text", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)

		long := strings.Repeat("mot ", 50)
		var comments []*core.Record
		for i := 1; i <= 7; i++ {
			event, author, body := fx.Event, fx.AliceRunner, fmt.Sprintf("Commentaire %d", i)
			if i%2 == 0 {
				event, author = fx.Event2, fx.BobRunner
			}
			if i == 5 {
				body = long
			}
			comment := create(t, app, "comments", map[string]any{"event": event.Id, "author": author.Id, "body": body})
			stamp := fmt.Sprintf("2026-05-25 10:%02d:00.000Z", i)
			putDates(t, app, comment.Id, stamp, stamp)
			comments = append(comments, comment)
		}

		got := homeAt(t, app, fx.Alice, june1)

		assertJSON(t, block(t, got, "latest_comments"), []any{
			map[string]any{"comment_id": comments[6].Id, "event": eventRefOf(fx.Event), "author": runnerRef(fx.AliceRunner), "excerpt": "Commentaire 7", "created": "2026-05-25 10:07:00.000Z"},
			map[string]any{"comment_id": comments[5].Id, "event": eventRefOf(fx.Event2), "author": runnerRef(fx.BobRunner), "excerpt": "Commentaire 6", "created": "2026-05-25 10:06:00.000Z"},
			// Cut at a word, at 140 characters.
			map[string]any{"comment_id": comments[4].Id, "event": eventRefOf(fx.Event), "author": runnerRef(fx.AliceRunner), "excerpt": strings.TrimSuffix(strings.Repeat("mot ", 35), " ") + "…", "created": "2026-05-25 10:05:00.000Z"},
			map[string]any{"comment_id": comments[3].Id, "event": eventRefOf(fx.Event2), "author": runnerRef(fx.BobRunner), "excerpt": "Commentaire 4", "created": "2026-05-25 10:04:00.000Z"},
			map[string]any{"comment_id": comments[2].Id, "event": eventRefOf(fx.Event), "author": runnerRef(fx.AliceRunner), "excerpt": "Commentaire 3", "created": "2026-05-25 10:03:00.000Z"},
		})
	})

	t.Run("an account without a runner has no home page", func(t *testing.T) {
		app := testutil.NewApp(t)
		testutil.Seed(t, app)
		mcp.SetNow(t, june1)
		orphan := create(t, app, "users", map[string]any{"email": "orphan@example.test", "password": testutil.Password, "role": "member", "verified": true})

		result := callTool(t, app, newToken(t, app, orphan), "home", nil)
		if !result.IsError || result.Text != "Ton compte n'a pas de coureur : demande à un admin." {
			t.Errorf("isError %v, text %q", result.IsError, result.Text)
		}
	})

	t.Run("a home page only reads", func(t *testing.T) {
		app := testutil.NewApp(t)
		fx := testutil.Seed(t, app)
		mcp.SetNow(t, june1)
		counted := mcp.CountInnerRequests(t)

		succeeded(t, callTool(t, app, newToken(t, app, fx.Alice), "home", nil))

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

func TestHome_RegistrationsToDo_Opening(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	semi := create(t, app, "events", map[string]any{
		"name": "Semi de Chambéry", "location": "Chambéry", "start_date": "2026-06-28",
		"registration_opening": "2026-05-12", "registration_opening_time": "10:00", "registration_deadline": "2026-06-05",
		"registration_url": "https://inscriptions.example.test/semi", "created_by": fx.AliceRunner.Id,
	})
	fSemi := create(t, app, "formats", map[string]any{"event": semi.Id, "race_type": fx.Road.Id, "distance_km": 21.1})
	todo := create(t, app, "participations", map[string]any{
		"runner": fx.AliceRunner.Id, "format": fSemi.Id, "status": "interested", "confirmed": true, "added_by": fx.AliceRunner.Id,
	})
	row := func(fields map[string]any) []any {
		base := map[string]any{
			"participation_id": todo.Id, "event": eventRefOf(semi), "format_title": "Route 21,1 km",
			"registration_url": "https://inscriptions.example.test/semi",
		}
		for k, v := range fields {
			base[k] = v
		}
		return []any{base}
	}

	// The day before: soon, with the opening, its time and the deadline, and no days left (they are the deadline's).
	assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 5, 11, 10, 0)), "registrations_to_do"), row(map[string]any{
		"state": "soon", "opening": "2026-05-12", "opening_time": "10:00", "deadline": "2026-06-05",
	}))
	// The day itself: today.
	assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 5, 12, 10, 0)), "registrations_to_do"), row(map[string]any{
		"state": "today", "opening": "2026-05-12", "opening_time": "10:00", "deadline": "2026-06-05",
	}))
	// Once it is open, the deadline is what counts: the 13th of May is 23 days before the 5th of June.
	assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 5, 13, 10, 0)), "registrations_to_do"), row(map[string]any{
		"state": "open", "deadline": "2026-06-05", "days_left": 23,
	}))
	// With no time, none is said.
	update(t, app, semi, map[string]any{"registration_opening_time": ""})
	assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 5, 11, 10, 0)), "registrations_to_do"), row(map[string]any{
		"state": "soon", "opening": "2026-05-12", "deadline": "2026-06-05",
	}))
	// Registered: nothing to do.
	update(t, app, todo, map[string]any{"status": "registered"})
	assertJSON(t, block(t, homeAt(t, app, fx.Alice, at(2026, 5, 11, 10, 0)), "registrations_to_do"), []any{})
}
