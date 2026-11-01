package participations_test

import (
	"errors"
	"net/http"
	"testing"
	"time"

	validation "ganigeorgiev.com/pocketbase/ozzo-validation/v4"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/apperr"
	hooks "courses/server/participations"
	"courses/server/testutil"
)

// paris is the time zone in which a race day is "today".
var paris = func() *time.Location {
	location, err := time.LoadLocation("Europe/Paris")
	if err != nil {
		panic(err)
	}
	return location
}()

// testDay is the day the tests run on, read once: a run that goes over midnight
// keeps the day it started on.
var testDay = time.Now().In(paris)

// theDay is the day that is that many days from today in Paris, as the text
// YYYY-MM-DD that the dates are stored as. The dates of the tests are relative
// to today: none of them is a date that will be past, or to come, some day.
func theDay(days int) string {
	year, month, day := testDay.Date()
	return time.Date(year, month, day+days, 0, 0, 0, 0, time.UTC).Format(time.DateOnly)
}

// fixClock makes the hooks read noon today, in Paris, until the test ends: what
// `theDay` calls today, whatever the time it is when the test runs.
func fixClock(t testing.TB) {
	t.Helper()
	year, month, day := testDay.Date()
	noon := time.Date(year, month, day, 12, 0, 0, 0, paris)
	hooks.SetNow(t, func() time.Time { return noon })
}

type before = func(testing.TB, *tests.TestApp, testutil.Fixture)

// raceOn puts the races of the fixture on days of the test. The event runs from
// start to end (a single day when end is empty), the 42 km takes place on f42
// (on the first day of the event when it is empty), and the 15 km never has a
// day of its own, so it takes place on the first day of the event. The 42 km
// loses its day before the event moves, which would be refused when the day is
// outside the new days of the event.
func raceOn(start, end, f42 string) before {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		save := func(r *core.Record, fields map[string]any) {
			t.Helper()
			for field, value := range fields {
				r.Set(field, value)
			}
			if err := app.Save(r); err != nil {
				t.Fatal(err)
			}
		}
		save(fx.F42, map[string]any{"date": ""})
		save(fx.Event, map[string]any{"start_date": start, "end_date": end})
		save(fx.F42, map[string]any{"date": f42})
	}
}

// finishedAndMoved is a Before: the race is over (it was yesterday) when Alice
// is given the status of hers, with a time, then the races move to the day that
// is that many days from today.
func finishedAndMoved(status string, days int) before {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		raceOn(theDay(-1), "", theDay(-1))(t, app, fx)
		fx.P1.Set("status", status)
		fx.P1.Set("finish_time_s", 15130)
		if err := app.Save(fx.P1); err != nil {
			t.Fatal(err)
		}
		raceOn(theDay(days), "", theDay(days))(t, app, fx)
	}
}

// A runner cannot finish a race, or give up, before its day: the status is
// refused with status_before_race, whoever asks. The day itself counts, and so
// does the day of the format, which beats the first day of the event. A
// participation that already has the status is not held against its race.
func TestParticipations_StatusBeforeRace(t *testing.T) {
	fixClock(t)
	create := func(status string) func(testutil.Fixture) string {
		return body(`{"runner":%q,"event":%q,"format":%q,"status":"`+status+`"}`, aliceRunner, event, f15)
	}
	change := func(status string) func(testutil.Fixture) string {
		return body(`{"status":"` + status + `"}`)
	}
	// What a refused creation leaves: the 3 participations of the fixture.
	notCreated := count(3)
	created := func(status string) check {
		return createdIs(aliceRunner, f15, func(testutil.Fixture) map[string]any {
			return map[string]any{"status": status}
		})
	}
	statusIs := func(of record, status string) check {
		return storedIs(of, func(testutil.Fixture) map[string]any {
			return map[string]any{"status": status}
		})
	}
	beforeRace := []string{fieldError("status", apperr.CodeStatusBeforeRace)}

	testutil.RunRows(t, []testutil.Row{
		// creating a participation
		{
			Name:     "finished is refused for a race tomorrow",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   raceOn(theDay(1), "", ""),
			Body:     create("finished"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    notCreated,
		},
		{
			Name:     "dnf is refused for a race tomorrow",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   raceOn(theDay(1), "", ""),
			Body:     create("dnf"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    notCreated,
		},
		{
			Name:   "finished is accepted on the day of the race",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: raceOn(theDay(0), "", ""),
			Body:   create("finished"),
			Status: http.StatusOK,
			After:  created("finished"),
		},
		{
			Name:   "dnf is accepted on the day of the race",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: raceOn(theDay(0), "", ""),
			Body:   create("dnf"),
			Status: http.StatusOK,
			After:  created("dnf"),
		},
		{
			Name:   "finished is accepted for a race that was yesterday",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: raceOn(theDay(-1), "", ""),
			Body:   create("finished"),
			Status: http.StatusOK,
			After:  created("finished"),
		},
		{
			Name:   "the other statuses do not wait for the race",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: raceOn(theDay(1), "", ""),
			Body:   create("dns"),
			Status: http.StatusOK,
			After:  created("dns"),
		},
		{
			Name:     "an admin is refused the same way",
			As:       "admin",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   raceOn(theDay(1), "", ""),
			Body:     body(`{"runner":%q,"event":%q,"format":%q,"status":"finished"}`, adminRunner, event, f15),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    notCreated,
		},

		// changing the status of a participation
		{
			Name:     "registered to finished is refused for a race tomorrow",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Before:   raceOn(theDay(-1), theDay(3), theDay(1)),
			Body:     change("finished"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    statusIs(p1, "registered"),
		},
		{
			Name:     "registered to dnf is refused for a race tomorrow",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Before:   raceOn(theDay(-1), theDay(3), theDay(1)),
			Body:     change("dnf"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    statusIs(p1, "registered"),
		},
		{
			Name:   "registered to finished is accepted on the day of the race",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: raceOn(theDay(-1), theDay(3), theDay(0)),
			Body:   change("finished"),
			Status: http.StatusOK,
			After:  statusIs(p1, "finished"),
		},
		{
			Name:   "registered to dns is accepted for a race tomorrow",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: raceOn(theDay(1), "", ""),
			Body:   change("dns"),
			Status: http.StatusOK,
			After:  statusIs(p1, "dns"),
		},
		{
			Name:     "the status of somebody else is refused the same way",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p2),
			Before:   raceOn(theDay(-1), theDay(3), theDay(1)),
			Body:     change("finished"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    unchanged(p2),
		},
		{
			Name:     "a result sent with the status does not get it past the check",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Before:   raceOn(theDay(1), "", ""),
			Body:     body(`{"status":"finished","finish_time_s":15130,"rank":12,"rank_of":340}`),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    statusIs(p1, "registered"),
		},

		// which day is the day of the race
		{
			Name:     "a format without a day takes place on the first day of the event: tomorrow",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p3),
			Before:   raceOn(theDay(1), theDay(2), ""),
			Body:     change("finished"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    unchanged(p3),
		},
		{
			Name:   "a format without a day takes place on the first day of the event: yesterday",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p3),
			Before: raceOn(theDay(-1), theDay(2), ""),
			Body:   change("finished"),
			Status: http.StatusOK,
			After:  statusIs(p3, "finished"),
		},
		{
			// The event has started, its second race has not.
			Name:     "the day of the format beats the first day of the event",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Before:   raceOn(theDay(-1), theDay(3), theDay(1)),
			Body:     change("finished"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    statusIs(p1, "registered"),
		},
		{
			Name:   "the first race of an event that has started does not wait for the second",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p3),
			Before: raceOn(theDay(-1), theDay(3), theDay(1)),
			Body:   change("finished"),
			Status: http.StatusOK,
			After:  statusIs(p3, "finished"),
		},

		// a status that is already finished or dnf is not held against the race
		{
			Name:   "an existing finished status is kept when the race moves later: the note changes",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: finishedAndMoved("finished", 30),
			Body:   body(`{"result_note":"3e V1H"}`),
			Status: http.StatusOK,
			After: storedIs(p1, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "finished", "finish_time_s": 15130, "result_note": "3e V1H"}
			}),
		},
		{
			Name:   "an existing finished status is kept when the race moves later: the status is sent again",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: finishedAndMoved("finished", 30),
			Body:   body(`{"status":"finished","finish_time_s":15200,"rank":12,"rank_of":340}`),
			Status: http.StatusOK,
			After: storedIs(p1, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "finished", "finish_time_s": 15200, "rank": 12, "rank_of": 340}
			}),
		},
		{
			Name:   "an existing dnf status is kept when the race moves later",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: finishedAndMoved("dnf", 30),
			Body:   body(`{"status":"dnf","result_note":"crampes"}`),
			Status: http.StatusOK,
			After: storedIs(p1, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "dnf", "result_note": "crampes"}
			}),
		},
		{
			Name:     "from finished to dnf is a new status: refused when the race moved later",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Before:   finishedAndMoved("finished", 30),
			Body:     change("dnf"),
			Status:   http.StatusBadRequest,
			Contains: beforeRace,
			After:    statusIs(p1, "finished"),
		},
		{
			Name:   "from finished back to registered is not held against the race",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Before: finishedAndMoved("finished", 30),
			Body:   change("registered"),
			Status: http.StatusOK,
			After:  statusIs(p1, "registered"),
		},
	})
}

// The check is a model hook: the writes that do not come from the API, such as
// the code of the application, are refused too. The merge of two runners moves
// the rows with SQL, and never reaches it.
func TestParticipations_StatusBeforeRaceOutsideTheAPI(t *testing.T) {
	fixClock(t)
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	raceOn(theDay(2), "", "")(t, app, fx)

	r := stored(t, app, fx.P1.Id)
	r.Set("status", "finished")
	var errs validation.Errors
	if err := app.Save(r); !errors.As(err, &errs) {
		t.Fatalf("want validation errors, got %v", err)
	}
	if fieldErr, ok := errs["status"].(validation.Error); !ok || fieldErr.Code() != apperr.CodeStatusBeforeRace {
		t.Errorf("errors = %v, want status: %s", errs, apperr.CodeStatusBeforeRace)
	}
	assertStored(t, stored(t, app, fx.P1.Id), map[string]any{"status": "registered"})
}

// The day of a race is the day it is in Paris, not in UTC: half an hour after
// midnight there, it is still the day before in UTC, and the race of the day
// has started.
func TestParticipations_StatusBeforeRace_ParisDay(t *testing.T) {
	raceDay := theDay(1)
	midnight, err := time.ParseInLocation(time.DateOnly, raceDay, paris)
	if err != nil {
		t.Fatal(err)
	}

	for _, tt := range []struct {
		name   string
		now    time.Time
		status int
	}{
		{"half an hour after midnight in Paris, the race of the day has started", midnight.Add(30 * time.Minute), http.StatusOK},
		{"half an hour before midnight in Paris, it has not", midnight.Add(-30 * time.Minute), http.StatusBadRequest},
	} {
		t.Run(tt.name, func(t *testing.T) {
			// The clock gives UTC: the hook has to convert it.
			clock := tt.now.UTC()
			if tt.status == http.StatusOK && clock.Format(time.DateOnly) == raceDay {
				t.Fatalf("%s is on the day of the race in UTC too: it tells nothing about Paris", clock)
			}
			hooks.SetNow(t, func() time.Time { return clock })

			row := testutil.Row{
				Name:   "finished",
				As:     "alice",
				Method: http.MethodPatch,
				URL:    participations(p1),
				Before: raceOn(raceDay, "", ""),
				Body:   body(`{"status":"finished"}`),
				Status: tt.status,
			}
			if tt.status == http.StatusBadRequest {
				row.Contains = []string{fieldError("status", apperr.CodeStatusBeforeRace)}
			}
			testutil.RunRows(t, []testutil.Row{row})
		})
	}
}
