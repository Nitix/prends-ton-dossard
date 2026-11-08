package events_test

import (
	"net/http"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/events"
	"courses/server/testutil"
)

// asMonth is a Before that makes the event of the fixture a race known by its
// month only (the month of day), the way the code of the application would. Its
// races lose their day first, as the form does.
func asMonth(day string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		formats, err := app.FindAllRecords("formats", dbx.HashExp{"event": fx.Event.Id})
		if err != nil {
			t.Fatal(err)
		}
		for _, f := range formats {
			f.Set("date", "")
			if err := app.Save(f); err != nil {
				t.Fatal(err)
			}
		}
		record := storedEvent(t, app, fx.Event.Id)
		record.Set("date_precision", "month")
		record.Set("start_date", day)
		record.Set("end_date", "")
		if err := app.Save(record); err != nil {
			t.Fatal(err)
		}
	}
}

// precisionIs asserts the stored precision and days of the fixture event.
func precisionIs(precision, start, end string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record := storedEvent(t, app, fx.Event.Id)
		got := [3]string{record.GetString("date_precision"), record.GetString("start_date"), record.GetString("end_date")}
		if want := [3]string{precision, start, end}; got != want {
			t.Errorf("date_precision, start_date, end_date = %q, want %q", got, want)
		}
	}
}

// createdPrecisionIs asserts the precision and the days of the event named name,
// which the request has just created.
func createdPrecisionIs(name, precision, start, end string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		record, err := app.FindFirstRecordByData("events", "name", name)
		if err != nil {
			t.Fatalf("the event %q was not created: %v", name, err)
		}
		got := [3]string{record.GetString("date_precision"), record.GetString("start_date"), record.GetString("end_date")}
		if want := [3]string{precision, start, end}; got != want {
			t.Errorf("date_precision, start_date, end_date = %q, want %q", got, want)
		}
	}
}

// A race that is known by its month only runs from the 1st to the last day of
// that month: the server sets the end, whatever the request says, the start is a
// 1st, its races have no day, and its deadline and opening can fall anywhere in
// the month.
func TestEvents_MonthPrecision(t *testing.T) {
	type check = func(testing.TB, *tests.TestApp, testutil.Fixture)
	create := func(name, payload string, status int, contains string, after check) testutil.Row {
		row := testutil.Row{
			Name: name, As: "alice", Method: http.MethodPost, URL: records("events"),
			Body:   body(`{"name":"Course du mois","location":"Annecy",` + payload + `}`),
			Status: status, After: after,
		}
		if contains != "" {
			row.Contains = []string{contains}
		}
		return row
	}
	patch := func(name string, before check, payload string, status int, contains string, after check) testutil.Row {
		row := testutil.Row{
			Name: name, As: "alice", Before: before, Method: http.MethodPatch, URL: records("events", event),
			Body: body(payload), Status: status, After: after,
		}
		if contains != "" {
			row.Contains = []string{contains}
		}
		return row
	}
	june := asMonth("2027-06-01")
	testutil.RunRows(t, []testutil.Row{
		create("created with no end, it ends on the last day of its month", `"start_date":"2027-06-01","date_precision":"month"`,
			http.StatusOK, "", createdPrecisionIs("Course du mois", "month", "2027-06-01", "2027-06-30")),
		create("created with an end of its own, it is the last day of the month all the same", `"start_date":"2027-06-01","end_date":"2027-06-10","date_precision":"month"`,
			http.StatusOK, "", createdPrecisionIs("Course du mois", "month", "2027-06-01", "2027-06-30")),
		create("a February of a leap year", `"start_date":"2028-02-01","date_precision":"month"`,
			http.StatusOK, "", createdPrecisionIs("Course du mois", "month", "2028-02-01", "2028-02-29")),
		create("created on another day than the 1st", `"start_date":"2027-06-15","date_precision":"month"`,
			http.StatusBadRequest, fieldError("start_date", "month_start_invalid"), nil),
		create("a day precision is the request's, end included", `"start_date":"2027-06-15","end_date":"2027-06-16","date_precision":"day"`,
			http.StatusOK, "", createdPrecisionIs("Course du mois", "day", "2027-06-15", "2027-06-16")),
		create("no precision is a day", `"start_date":"2027-06-15"`,
			http.StatusOK, "", createdPrecisionIs("Course du mois", "", "2027-06-15", "")),
		create("a precision that is not one", `"start_date":"2027-06-01","date_precision":"year"`,
			http.StatusBadRequest, fieldError("date_precision", "validation_invalid_value"), nil),

		// An event of a day becomes a month.
		patch("a month for an event whose races have no day", func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			t.Helper()
			f, err := app.FindRecordById("formats", fx.F42.Id)
			if err != nil {
				t.Fatal(err)
			}
			f.Set("date", "")
			if err := app.Save(f); err != nil {
				t.Fatal(err)
			}
		}, `{"date_precision":"month","start_date":"2026-06-01"}`,
			http.StatusOK, "", precisionIs("month", "2026-06-01", "2026-06-30")),
		patch("a month with the 15th", nil, `{"date_precision":"month","start_date":"2026-06-15"}`,
			http.StatusBadRequest, fieldError("start_date", "month_start_invalid"), precisionIs("", "2026-06-13", "2026-06-14")),
		patch("a month that leaves a race dated is refused on the precision", nil, `{"date_precision":"month","start_date":"2026-06-01"}`,
			http.StatusBadRequest, fieldError("date_precision", "format_date_month"), precisionIs("", "2026-06-13", "2026-06-14")),

		// A month, edited.
		patch("another month moves the end", june, `{"start_date":"2027-07-01"}`,
			http.StatusOK, "", precisionIs("month", "2027-07-01", "2027-07-31")),
		patch("an end that the request gives is not kept", june, `{"end_date":"2027-06-05"}`,
			http.StatusOK, "", precisionIs("month", "2027-06-01", "2027-06-30")),
		patch("the start of a month is not the 15th", june, `{"start_date":"2027-06-15"}`,
			http.StatusBadRequest, fieldError("start_date", "month_start_invalid"), precisionIs("month", "2027-06-01", "2027-06-30")),
		patch("a deadline in the month, after the 1st", june, `{"registration_deadline":"2027-06-20"}`,
			http.StatusOK, "", deadlineIs("2027-06-20")),
		patch("an opening in the month, after the 1st", june, `{"registration_opening":"2027-06-20"}`,
			http.StatusOK, "", openingIs("2027-06-20", "")),
		patch("an opening on the last day of the month", june, `{"registration_opening":"2027-06-30","registration_opening_time":"10:00"}`,
			http.StatusOK, "", openingIs("2027-06-30", "10:00")),
		patch("a deadline after the month", june, `{"registration_deadline":"2027-07-01"}`,
			http.StatusBadRequest, fieldError("registration_deadline", "registration_deadline_after_start"), deadlineIs("")),
		patch("an opening after the month", june, `{"registration_opening":"2027-07-01"}`,
			http.StatusBadRequest, fieldError("registration_opening", "registration_opening_after_start"), openingIs("", "")),

		// Its races have no day.
		{
			Name: "a race of a month with a day", As: "alice", Before: june, Method: http.MethodPost, URL: records("formats"),
			Body:   body(`{"event":%q,"race_type":%q,"distance_km":10,"date":"2027-06-10"}`, idOf(event), idOf(road)),
			Status: http.StatusBadRequest, Contains: []string{fieldError("date", "format_date_month")},
		},
		{
			Name: "a race of a month with a day that is the 1st", As: "alice", Before: june, Method: http.MethodPost, URL: records("formats"),
			Body:   body(`{"event":%q,"race_type":%q,"distance_km":10,"date":"2027-06-01"}`, idOf(event), idOf(road)),
			Status: http.StatusBadRequest, Contains: []string{fieldError("date", "format_date_month")},
		},
		{
			Name: "a race of a month with no day", As: "alice", Before: june, Method: http.MethodPost, URL: records("formats"),
			Body:   body(`{"event":%q,"race_type":%q,"distance_km":10,"date":""}`, idOf(event), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name: "a race of a month with a day is refused on an update too", As: "alice", Before: june, Method: http.MethodPatch, URL: records("formats", f42),
			Body:   body(`{"date":"2027-06-10"}`),
			Status: http.StatusBadRequest, Contains: []string{fieldError("date", "format_date_month")},
		},

		// Nor a start time: a time needs a day.
		{
			Name: "a race of a month with a start time", As: "alice", Before: june, Method: http.MethodPost, URL: records("formats"),
			Body:   body(`{"event":%q,"race_type":%q,"distance_km":10,"start_time":"07:30"}`, idOf(event), idOf(road)),
			Status: http.StatusBadRequest, Contains: []string{fieldError("start_time", "format_time_month")},
		},
		{
			Name: "a race of a month with no start time", As: "alice", Before: june, Method: http.MethodPost, URL: records("formats"),
			Body:   body(`{"event":%q,"race_type":%q,"distance_km":10,"start_time":""}`, idOf(event), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name: "a race of a month with a start time is refused on an update too", As: "alice", Before: june, Method: http.MethodPatch, URL: records("formats", f42),
			Body:   body(`{"start_time":"07:30"}`),
			Status: http.StatusBadRequest, Contains: []string{fieldError("start_time", "format_time_month")},
		},
		{
			Name: "a start time that is not a time", As: "alice", Method: http.MethodPatch, URL: records("formats", f42),
			Body:   body(`{"start_time":"7h30"}`),
			Status: http.StatusBadRequest, Contains: []string{`"start_time"`},
		},
		{
			Name: "a start time on a race with a day", As: "alice", Method: http.MethodPatch, URL: records("formats", f42),
			Body:   body(`{"start_time":"07:30"}`),
			Status: http.StatusOK,
		},
		patch("a month for an event with a timed race is refused on the precision", func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
			t.Helper()
			for _, id := range []string{fx.F42.Id, fx.F15.Id} {
				f, err := app.FindRecordById("formats", id)
				if err != nil {
					t.Fatal(err)
				}
				f.Set("date", "")
				f.Set("start_time", "07:30")
				if err := app.Save(f); err != nil {
					t.Fatal(err)
				}
			}
		}, `{"date_precision":"month","start_date":"2026-06-01"}`,
			http.StatusBadRequest, fieldError("date_precision", "format_time_month"), precisionIs("", "2026-06-13", "2026-06-14")),

		// Back to a day: the end is the request's again, and the races have days.
		patch("back to a day, with the end of the request", june, `{"date_precision":"day","start_date":"2027-06-12","end_date":"2027-06-13"}`,
			http.StatusOK, "", precisionIs("day", "2027-06-12", "2027-06-13")),
		patch("back to a day, with no end given", june, `{"date_precision":"day","start_date":"2027-06-12","end_date":""}`,
			http.StatusOK, "", precisionIs("day", "2027-06-12", "")),
		{
			Name: "back to a day, then a race gets its day", As: "alice",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				t.Helper()
				june(t, app, fx)
				record := storedEvent(t, app, fx.Event.Id)
				record.Set("date_precision", "day")
				record.Set("start_date", "2027-06-12")
				record.Set("end_date", "2027-06-13")
				if err := app.Save(record); err != nil {
					t.Fatal(err)
				}
			},
			Method: http.MethodPatch, URL: records("formats", f42), Body: body(`{"date":"2027-06-13"}`), Status: http.StatusOK,
		},
	})
}

func TestEvents_LastDayOfMonth(t *testing.T) {
	for _, row := range []struct {
		day, want string
		ok        bool
	}{
		{"2027-06-01", "2027-06-30", true},
		{"2027-06-15", "2027-06-30", true},
		{"2027-01-31", "2027-01-31", true},
		{"2027-12-01", "2027-12-31", true},
		{"2028-02-10", "2028-02-29", true},
		{"2027-02-10", "2027-02-28", true},
		{"2027-02-31", "", false},
		{"juin 2027", "", false},
		{"", "", false},
	} {
		got, ok := events.LastDayOfMonth(row.day)
		if got != row.want || ok != row.ok {
			t.Errorf("LastDayOfMonth(%q) = %q, %v; want %q, %v", row.day, got, ok, row.want, row.ok)
		}
	}
}
