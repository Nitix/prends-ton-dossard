package events_test

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	"courses/server/events"
	"courses/server/testutil"
)

// records builds the URL of a collection's records, or of one of them.
func records(collection string, record ...func(testutil.Fixture) *core.Record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		url := "/api/collections/" + collection + "/records"
		if len(record) > 0 {
			url += "/" + record[0](fx).Id
		}
		return url
	}
}

func event(fx testutil.Fixture) *core.Record  { return fx.Event }
func format(fx testutil.Fixture) *core.Record { return fx.FLyon }
func f42(fx testutil.Fixture) *core.Record    { return fx.F42 }

// body builds a JSON request body from the fixture.
func body(tmpl string, ids ...func(testutil.Fixture) string) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id(fx)
		}
		return fmt.Sprintf(tmpl, args...)
	}
}

func idOf(record func(testutil.Fixture) *core.Record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string { return record(fx).Id }
}

func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func bobRunner(fx testutil.Fixture) *core.Record   { return fx.BobRunner }
func event2(fx testutil.Fixture) *core.Record      { return fx.Event2 }
func road(fx testutil.Fixture) *core.Record        { return fx.Road }
func backyard(fx testutil.Fixture) *core.Record    { return fx.Backyard }

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return fmt.Sprintf(`"%s":{"code":"%s"`, field, code)
}

// storedEvent returns the event with that id as it is in the database.
func storedEvent(t testing.TB, app core.App, id string) *core.Record {
	t.Helper()
	record, err := app.FindRecordById("events", id)
	if err != nil {
		t.Fatal(err)
	}
	return record
}

// createdByIs asserts the stored creator of the event.
func createdByIs(id func(testutil.Fixture) *core.Record, runner func(testutil.Fixture) *core.Record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		if got, want := storedEvent(t, app, id(fx).Id).GetString("created_by"), runner(fx).Id; got != want {
			t.Errorf("created_by = %q, want %q", got, want)
		}
	}
}

// createdEventIs asserts the creator of the event named name, which the
// request has just created.
func createdEventIs(name string, runner func(testutil.Fixture) *core.Record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record, err := app.FindFirstRecordByData("events", "name", name)
		if err != nil {
			t.Fatalf("the event %q was not created: %v", name, err)
		}
		if got, want := record.GetString("created_by"), runner(fx).Id; got != want {
			t.Errorf("created_by = %q, want %q", got, want)
		}
	}
}

// eventDatesAre asserts the stored dates of the fixture event.
func eventDatesAre(start, end string) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		record := storedEvent(t, app, fx.Event.Id)
		if got := record.GetString("start_date"); got != start {
			t.Errorf("start_date = %q, want %q", got, start)
		}
		if got := record.GetString("end_date"); got != end {
			t.Errorf("end_date = %q, want %q", got, end)
		}
	}
}

// formatCount asserts how many formats the fixture event 2 has.
func formatCount(want int) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		all, err := app.FindAllRecords("formats", dbx.HashExp{"event": fx.Event2.Id})
		if err != nil {
			t.Fatal(err)
		}
		if len(all) != want {
			t.Errorf("event 2 has %d formats, want %d", len(all), want)
		}
	}
}

func TestEventHooks(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		// created_by
		{
			Name:   "alice creates an event: she is its creator",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("events"),
			Body:   body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-01"}`),
			Status: http.StatusOK,
			After:  createdEventIs("Marathon d'Annecy", aliceRunner),
		},
		{
			Name:   "alice cannot name another creator",
			As:     "alice",
			Method: http.MethodPost,
			URL:    records("events"),
			Body: body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-01","created_by":%q}`,
				idOf(bobRunner)),
			Status: http.StatusOK,
			After:  createdEventIs("Marathon d'Annecy", aliceRunner),
		},
		{
			Name:   "bob cannot take over an event by patching created_by",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    records("events", event),
			Body:   body(`{"created_by":%q}`, idOf(bobRunner)),
			Status: http.StatusOK,
			After:  createdByIs(event, aliceRunner),
		},
		{
			Name:   "a patch of created_by does not stop the other fields from changing",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    records("events", event),
			Body:   body(`{"created_by":%q,"location":"Chamonix"}`, idOf(bobRunner)),
			Status: http.StatusOK,
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				createdByIs(event, aliceRunner)(t, app, fx)
				if got := storedEvent(t, app, fx.Event.Id).GetString("location"); got != "Chamonix" {
					t.Errorf("location = %q, want Chamonix", got)
				}
			},
		},

		// event dates
		{
			Name:     "an event cannot end before it starts",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-02","end_date":"2026-09-01"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("end_date", "end_before_start")},
		},
		{
			Name:     "an event can start and end the same day",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-01","end_date":"2026-09-01"}`),
			Status:   http.StatusOK,
			Contains: []string{`"end_date":"2026-09-01"`},
		},
		{
			Name:     "a start date that is not a calendar day",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-02-30"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("start_date", "date_invalid")},
		},
		{
			Name:     "a start date that is not in the YYYY-MM-DD format",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-9-1"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("start_date", "date_invalid")},
		},
		{
			Name:     "an end date that is not a calendar day",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-01","end_date":"2026-13-01"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("end_date", "date_invalid")},
		},
		{
			Name:     "an end date with a time is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      records("events"),
			Body:     body(`{"name":"Marathon d'Annecy","location":"Annecy","start_date":"2026-09-01","end_date":"2026-09-02 10:00:00.000Z"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("end_date", "date_invalid")},
		},
		{
			Name:   "removing the end date is allowed",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("events", event),
			Body:   body(`{"end_date":""}`),
			Status: http.StatusOK,
			// The range is now [13th, +inf[, and F42 is on the 14th.
			After: eventDatesAre("2026-06-13", ""),
		},

		// the dates of the formats of an event
		{
			Name:   "a format the day before its event",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-12"}`,
				idOf(event), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "format_date_out_of_range")},
		},
		{
			Name:   "a format the day after its event",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-15"}`,
				idOf(event), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "format_date_out_of_range")},
		},
		{
			Name:   "a format the first day of its event",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-13"}`,
				idOf(event), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name:   "a format the last day of its event",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-14"}`,
				idOf(event), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name:   "a format without a date is not checked",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21}`,
				idOf(event), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name:   "an event without an end date has no last day",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-30"}`,
				idOf(event2), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name:   "an event without an end date still has a first day",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-06-21"}`,
				idOf(event2), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "format_date_out_of_range")},
			After:    formatCount(1),
		},
		{
			Name:   "a format date that is not a calendar day",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"2026-02-30"}`,
				idOf(event), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "date_invalid")},
		},
		{
			Name:   "a format date that is not in the YYYY-MM-DD format",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":21,"date":"14/06/2026"}`,
				idOf(event), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "date_invalid")},
		},
		{
			Name:     "a format moved out of its event is refused",
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      records("formats", f42),
			Body:     body(`{"date":"2026-06-15"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "format_date_out_of_range")},
		},
		{
			Name:   "a format moved inside its event is accepted",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    records("formats", f42),
			Body:   body(`{"date":"2026-06-13"}`),
			Status: http.StatusOK,
		},

		// shrinking an event around its formats
		{
			Name:     "an event cannot end before one of its formats",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("events", event),
			Body:     body(`{"end_date":"2026-06-13"}`), // F42 is on the 14th
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("start_date", "format_date_out_of_range")},
			After:    eventDatesAre("2026-06-13", "2026-06-14"),
		},
		{
			Name:     "an event cannot start after one of its formats",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      records("events", event),
			Body:     body(`{"start_date":"2026-06-15","end_date":"2026-06-16"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("start_date", "format_date_out_of_range")},
			After:    eventDatesAre("2026-06-13", "2026-06-14"),
		},
		{
			Name:   "an event can grow around its formats",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("events", event),
			Body:   body(`{"end_date":"2026-06-15"}`),
			Status: http.StatusOK,
			After:  eventDatesAre("2026-06-13", "2026-06-15"),
		},
		{
			Name:   "an event can keep its dates around its formats",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    records("events", event),
			Body:   body(`{"end_date":"2026-06-14"}`),
			Status: http.StatusOK,
		},

		// the measure of a format
		{
			Name:   "a backyard has a time limit",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"time_limit_min":2880}`,
				idOf(event2), idOf(backyard)),
			Status: http.StatusOK,
		},
		{
			Name:   "a timed race has a duration",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"duration_min":360}`,
				idOf(event2), idOf(road)),
			Status: http.StatusOK,
		},
		{
			Name:   "a format without any measure",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q}`,
				idOf(event2), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("distance_km", "format_measure_required")},
			After:    formatCount(1),
		},
		{
			Name:   "a measure of zero is not a measure",
			As:     "bob",
			Method: http.MethodPost,
			URL:    records("formats"),
			Body: body(`{"event":%q,"race_type":%q,"distance_km":0,"duration_min":0,"time_limit_min":0}`,
				idOf(event2), idOf(road)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("distance_km", "format_measure_required")},
		},
		{
			Name:     "a format cannot lose its only measure",
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      records("formats", format),
			Body:     body(`{"distance_km":null}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("distance_km", "format_measure_required")},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				record, err := app.FindRecordById("formats", fx.FLyon.Id)
				if err != nil {
					t.Fatal(err)
				}
				if got := record.GetFloat("distance_km"); got != 10 {
					t.Errorf("distance_km = %v, want 10", got)
				}
			},
		},
		{
			Name:   "a format can swap its measure",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    records("formats", format),
			Body:   body(`{"distance_km":null,"duration_min":60}`),
			Status: http.StatusOK,
		},
	})
}

// The invariants hold for any write, not only the API ones: they are model
// hooks, so a Go write or a dashboard edit is checked the same way.
func TestEventHooks_ModelWrites(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	save := func(record *core.Record) error { return app.Save(record) }
	code := func(t *testing.T, err error, field string) string {
		t.Helper()
		var errs validation.Errors
		if !errors.As(err, &errs) {
			t.Fatalf("want validation errors, got %v", err)
		}
		fieldErr, ok := errs[field].(validation.Error)
		if !ok {
			t.Fatalf("want an error on %q, got %v", field, errs)
		}
		return fieldErr.Code()
	}

	t.Run("event dates", func(t *testing.T) {
		record := core.NewRecord(fx.Event.Collection())
		record.Set("name", "Bad dates")
		record.Set("location", "Nowhere")
		record.Set("start_date", "2026-09-02")
		record.Set("end_date", "2026-09-01")
		if got := code(t, save(record), "end_date"); got != apperr.CodeEndBeforeStart {
			t.Errorf("code = %q, want %q", got, apperr.CodeEndBeforeStart)
		}
	})

	t.Run("format date", func(t *testing.T) {
		record := core.NewRecord(fx.F42.Collection())
		record.Set("event", fx.Event.Id)
		record.Set("race_type", fx.Trail.Id)
		record.Set("distance_km", 10)
		record.Set("date", "2027-01-01")
		if got := code(t, save(record), "date"); got != apperr.CodeFormatDateOutOfRange {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatDateOutOfRange)
		}
	})

	t.Run("format measure", func(t *testing.T) {
		record := core.NewRecord(fx.F42.Collection())
		record.Set("event", fx.Event.Id)
		record.Set("race_type", fx.Trail.Id)
		if got := code(t, save(record), "distance_km"); got != apperr.CodeFormatMeasureRequired {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatMeasureRequired)
		}
	})

	t.Run("event shrunk around a format", func(t *testing.T) {
		record, err := app.FindRecordById("events", fx.Event.Id)
		if err != nil {
			t.Fatal(err)
		}
		record.Set("end_date", "2026-06-13")
		if got := code(t, save(record), "start_date"); got != apperr.CodeFormatDateOutOfRange {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatDateOutOfRange)
		}
	})

	t.Run("an event with formats outside its range can still be renamed", func(t *testing.T) {
		// Written behind the hook's back: the data is already inconsistent.
		_, err := app.NonconcurrentDB().NewQuery(
			"UPDATE events SET end_date = '2026-06-13' WHERE id = {:id}",
		).Bind(map[string]any{"id": fx.Event.Id}).Execute()
		if err != nil {
			t.Fatal(err)
		}
		record, err := app.FindRecordById("events", fx.Event.Id)
		if err != nil {
			t.Fatal(err)
		}
		record.Set("name", "Renamed")
		if err := save(record); err != nil {
			t.Errorf("renaming: %v", err)
		}
	})
}

func TestRunnerOf(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	t.Run("the runner of an account", func(t *testing.T) {
		runner, err := events.RunnerOf(app, fx.Alice.Id)
		if err != nil {
			t.Fatal(err)
		}
		if runner == nil || runner.Id != fx.AliceRunner.Id {
			t.Errorf("runner = %v, want Alice's", runner)
		}
	})

	t.Run("an unknown account has no runner", func(t *testing.T) {
		runner, err := events.RunnerOf(app, "doesnotexist1")
		if err != nil || runner != nil {
			t.Errorf("RunnerOf = %v, %v; want nil, nil", runner, err)
		}
	})

	t.Run("an empty id does not match the runners without account", func(t *testing.T) {
		runner, err := events.RunnerOf(app, "")
		if err != nil || runner != nil {
			t.Errorf("RunnerOf = %v, %v; want nil, nil", runner, err)
		}
	})
}

// A superuser has no runner: the event has no creator rather than the one the
// request names.
func TestEventHooks_SuperuserCreatesWithoutCreator(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	collection, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(collection)
	superuser.SetEmail("root@example.test")
	superuser.SetPassword(testutil.Password)
	if err := app.Save(superuser); err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Method: http.MethodPost,
		URL:    "/api/collections/events/records",
		Body: strings.NewReader(fmt.Sprintf(
			`{"name":"Ultra","location":"Nice","start_date":"2026-09-01","created_by":%q}`, fx.BobRunner.Id)),
		Headers:               map[string]string{"Authorization": testutil.Token(t, superuser)},
		ExpectedStatus:        http.StatusOK,
		ExpectedContent:       []string{`"name":"Ultra"`},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
		AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
			record, err := app.FindFirstRecordByData("events", "name", "Ultra")
			if err != nil {
				t.Fatal(err)
			}
			if got := record.GetString("created_by"); got != "" {
				t.Errorf("created_by = %q, want empty", got)
			}
		},
	}).Test(t)
}
