package participations_test

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
	"courses/server/testutil"
)

// record picks a record of the fixture.
type record = func(testutil.Fixture) *core.Record

func p1(fx testutil.Fixture) *core.Record          { return fx.P1 }
func p2(fx testutil.Fixture) *core.Record          { return fx.P2 }
func p3(fx testutil.Fixture) *core.Record          { return fx.P3 }
func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func bobRunner(fx testutil.Fixture) *core.Record   { return fx.BobRunner }
func samRunner(fx testutil.Fixture) *core.Record   { return fx.SamRunner }
func adminRunner(fx testutil.Fixture) *core.Record { return fx.AdminRunner }
func f42(fx testutil.Fixture) *core.Record         { return fx.F42 }
func f15(fx testutil.Fixture) *core.Record         { return fx.F15 }
func fLyon(fx testutil.Fixture) *core.Record       { return fx.FLyon }
func event(fx testutil.Fixture) *core.Record       { return fx.Event }
func event2(fx testutil.Fixture) *core.Record      { return fx.Event2 }

// participations builds the URL of the participations, or of one of them.
func participations(of ...record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		url := "/api/collections/participations/records"
		if len(of) > 0 {
			url += "/" + of[0](fx).Id
		}
		return url
	}
}

// body builds a JSON request body, the %q verbs being the ids of the records.
func body(tmpl string, ids ...record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id(fx).Id
		}
		return fmt.Sprintf(tmpl, args...)
	}
}

type check = func(testing.TB, *tests.TestApp, testutil.Fixture)

// stored returns the participation with that id as it is in the database.
func stored(t testing.TB, app core.App, id string) *core.Record {
	t.Helper()
	r, err := app.FindRecordById("participations", id)
	if err != nil {
		t.Fatalf("the participation %s is not in the database: %v", id, err)
	}
	return r
}

// assertStored fails when a field of the stored record differs from the want.
func assertStored(t testing.TB, got *core.Record, want map[string]any) {
	t.Helper()
	for field, value := range want {
		switch v := value.(type) {
		case bool:
			if got.GetBool(field) != v {
				t.Errorf("%s = %v, want %v", field, got.GetBool(field), v)
			}
		case string:
			if got.GetString(field) != v {
				t.Errorf("%s = %q, want %q", field, got.GetString(field), v)
			}
		default:
			t.Fatalf("unsupported expectation on %s: %v", field, value)
		}
	}
}

// unchanged asserts that the participation is in the database as it was before
// the request (or as the fixture record says, when Before changed it).
func unchanged(of record) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		want := of(fx)
		assertStored(t, stored(t, app, want.Id), map[string]any{
			"runner":    want.GetString("runner"),
			"event":     want.GetString("event"),
			"format":    want.GetString("format"),
			"status":    want.GetString("status"),
			"added_by":  want.GetString("added_by"),
			"confirmed": want.GetBool("confirmed"),
		})
	}
}

// storedIs asserts some fields of the participation, which are the strings and
// the booleans of want, and the ids of the records that want names.
func storedIs(of record, want func(testutil.Fixture) map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		assertStored(t, stored(t, app, of(fx).Id), want(fx))
	}
}

// createdIs asserts the participation of that runner in that format, which the
// request has just created.
func createdIs(runner, format record, want func(testutil.Fixture) map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		r, err := app.FindFirstRecordByFilter("participations", "runner = {:runner} && format = {:format}",
			dbx.Params{"runner": runner(fx).Id, "format": format(fx).Id})
		if err != nil {
			t.Fatalf("the participation was not created: %v", err)
		}
		assertStored(t, r, want(fx))
	}
}

// undecided saves a participation of runner in the event only, without a
// format, as the fixture does, and returns it.
func undecided(t testing.TB, app core.App, runner, event, addedBy *core.Record, confirmed bool) *core.Record {
	t.Helper()
	return inTheEventOnly(t, app, "interested", runner, event, addedBy, confirmed)
}

// inTheEventOnly saves a participation of runner in the event only, without a
// format, with that status, and returns it.
func inTheEventOnly(t testing.TB, app core.App, status string, runner, event, addedBy *core.Record, confirmed bool) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	r.Set("runner", runner.Id)
	r.Set("event", event.Id)
	r.Set("status", status)
	r.Set("added_by", addedBy.Id)
	r.Set("confirmed", confirmed)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	return r
}

// undecidedBy is a Before that makes the runner interested in the event
// without a format, added by the runner (so confirmed) or by somebody else.
func undecidedBy(runner, event, addedBy record, confirmed bool) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		undecided(t, app, runner(fx), event(fx), addedBy(fx), confirmed)
	}
}

// inEvent returns the participations of the runner in the event, whatever
// their format.
func inEvent(t testing.TB, app core.App, runner, event *core.Record) []*core.Record {
	t.Helper()
	found, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runner.Id, "event": event.Id})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// onlyIn asserts that the runner has exactly one participation in the event,
// and that it is on that format (without a format when the format is nil).
func onlyIn(runner, event, format record) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		found := inEvent(t, app, runner(fx), event(fx))
		if len(found) != 1 {
			t.Fatalf("%d participations in the event, want 1", len(found))
		}
		want := ""
		if format != nil {
			want = format(fx).Id
		}
		assertStored(t, found[0], map[string]any{"format": want})
	}
}

// createdUndecidedIs asserts the participation of that runner in that event
// without a format, which the request has just created.
func createdUndecidedIs(runner, event record, want func(testutil.Fixture) map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		r, err := app.FindFirstRecordByFilter("participations", "runner = {:runner} && event = {:event} && format = ''",
			dbx.Params{"runner": runner(fx).Id, "event": event(fx).Id})
		if err != nil {
			t.Fatalf("the participation without a format was not created: %v", err)
		}
		assertStored(t, r, want(fx))
	}
}

// count asserts how many participations there are: the 3 of the fixture, plus
// the ones that a request has created.
func count(want int) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		got, err := app.CountRecords("participations")
		if err != nil {
			t.Fatal(err)
		}
		if int(got) != want {
			t.Errorf("%d participations, want %d", got, want)
		}
	}
}

// both runs the checks, one after the other.
func both(checks ...check) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		for _, c := range checks {
			c(t, app, fx)
		}
	}
}

// confirmed is a Before that makes the runner confirm the participation.
func confirmed(of record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		// The fixture record is the one that unchanged compares to.
		r := of(fx)
		r.Set("confirmed", true)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
}

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return fmt.Sprintf(`"%s":{"code":"%s"`, field, code)
}

func TestParticipations_Create(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "bob adds himself: it is confirmed and he added it",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"registered"}`, bobRunner, f15),
			Status: http.StatusOK,
			After: createdIs(bobRunner, f15, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": true, "added_by": fx.BobRunner.Id, "status": "registered"}
			}),
		},
		{
			Name:   "bob adds alice: it is not confirmed, whatever he sends",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body: body(`{"runner":%q,"format":%q,"status":"interested","confirmed":true,"added_by":%q}`,
				aliceRunner, f15, aliceRunner),
			Status: http.StatusOK,
			After: createdIs(aliceRunner, f15, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": false, "added_by": fx.BobRunner.Id}
			}),
		},
		{
			Name:   "bob adds sam, who has no account: it is not confirmed",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"interested","confirmed":true}`, samRunner, f42),
			Status: http.StatusOK,
			After: createdIs(samRunner, f42, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": false, "added_by": fx.BobRunner.Id}
			}),
		},
		{
			Name:   "an admin adds herself: it is confirmed",
			As:     "admin",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"interested"}`, adminRunner, f42),
			Status: http.StatusOK,
			After: createdIs(adminRunner, f42, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": true, "added_by": fx.AdminRunner.Id}
			}),
		},
		{
			Name:   "an admin adds bob: it is not confirmed",
			As:     "admin",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"interested","confirmed":true}`, bobRunner, f15),
			Status: http.StatusOK,
			After: createdIs(bobRunner, f15, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": false, "added_by": fx.AdminRunner.Id}
			}),
		},
		{
			Name:   "the status is interested when the request has none",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q}`, aliceRunner, f15),
			Status: http.StatusOK,
			// The response and the database both say it.
			Contains: []string{`"status":"interested"`},
			After: createdIs(aliceRunner, f15, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "interested"}
			}),
		},
		{
			Name:   "a status that is not one of the five is refused",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"won"}`, aliceRunner, f15),
			Status: http.StatusBadRequest,
			After:  count(3),
		},
		{
			Name:   "a second participation of the same runner in the same format",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			// With a status, so that the only thing wrong is the duplicate.
			Body:     body(`{"runner":%q,"format":%q,"status":"interested"}`, aliceRunner, f42),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_not_unique"},
			After:    both(count(3), unchanged(p1)),
		},
		{
			Name:   "an unknown runner is a validation error, not a failure",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":"doesnotexist000","format":%q,"status":"interested"}`, f15),
			Status: http.StatusBadRequest,
			After:  count(3),
		},
		{
			Name:     "no runner is a validation error",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"format":%q,"status":"interested"}`, f15),
			Status:   http.StatusBadRequest,
			Contains: []string{`"runner":{"code":"validation_required"`},
			After:    count(3),
		},
		{
			Name:   "an anonymous caller cannot add one",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"interested"}`, samRunner, f42),
			Status: http.StatusBadRequest,
			After:  count(3),
		},
		{
			// The batch route runs the same handlers, so the same hooks.
			Name:   "a batch cannot forge confirmed and added_by either",
			As:     "bob",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/batch" },
			Body: body(`{"requests":[{"method":"POST","url":"/api/collections/participations/records",`+
				`"body":{"runner":%q,"format":%q,"status":"interested","confirmed":true,"added_by":%q}}]}`,
				aliceRunner, f15, aliceRunner),
			Status:   http.StatusOK,
			Contains: []string{`"status":200`},
			After: createdIs(aliceRunner, f15, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": false, "added_by": fx.BobRunner.Id}
			}),
		},
	})
}

func TestParticipations_Update(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		// confirmed
		{
			Name:   "alice changes the status of bob's participation: it stays unconfirmed",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"status":"registered"}`),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "registered", "confirmed": false}
			}),
		},
		{
			Name:   "alice cannot confirm bob's participation",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"confirmed":true}`),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": false}
			}),
		},
		{
			Name:   "bob changes his own participation: it is confirmed",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"status":"registered"}`),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "registered", "confirmed": true}
			}),
		},
		{
			Name:   "an admin cannot unconfirm a participation",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"confirmed":false}`),
			Before: confirmed(p2),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"confirmed": true}
			}),
		},
		{
			Name:   "an admin changing a participation does not confirm it",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"status":"registered"}`),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "registered", "confirmed": false}
			}),
		},
		{
			Name:   "alice cannot unconfirm her own participation",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"confirmed":false,"status":"finished"}`),
			Status: http.StatusOK,
			After: storedIs(p1, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "finished", "confirmed": true}
			}),
		},

		// who may edit
		{
			Name:   "bob cannot change alice's confirmed participation",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"status":"dns"}`),
			Status: http.StatusNotFound,
			After:  unchanged(p1),
		},
		{
			Name:   "an admin changes a confirmed participation",
			As:     "admin",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"status":"dns"}`),
			Status: http.StatusOK,
			After: storedIs(p1, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "dns", "confirmed": true}
			}),
		},
		{
			Name:   "alice cannot change bob's participation once he confirmed it",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"status":"registered"}`),
			Before: confirmed(p2),
			Status: http.StatusNotFound,
			After:  unchanged(p2),
		},
		{
			Name:   "bob changes his participation after he confirmed it",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"status":"finished"}`),
			Before: confirmed(p2),
			Status: http.StatusOK,
			After: storedIs(p2, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "finished", "confirmed": true}
			}),
		},
		{
			Name:   "bob changes the participation of sam, who has no account",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(p3),
			Body:   body(`{"status":"registered"}`),
			Status: http.StatusOK,
			After: storedIs(p3, func(testutil.Fixture) map[string]any {
				return map[string]any{"status": "registered", "confirmed": false}
			}),
		},
		{
			Name:   "an anonymous caller cannot change the participation of sam",
			Method: http.MethodPatch,
			URL:    participations(p3),
			Body:   body(`{"status":"registered"}`),
			Status: http.StatusNotFound,
			After:  unchanged(p3),
		},

		// runner and added_by never change
		{
			Name:   "alice cannot give her participation to bob",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"runner":%q}`, bobRunner),
			Status: http.StatusNotFound,
			After:  unchanged(p1),
		},
		{
			Name:   "alice cannot take bob's participation",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"runner":%q}`, aliceRunner),
			Status: http.StatusNotFound,
			After:  unchanged(p2),
		},
		{
			Name:   "the runner does not change through a modifier either",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"runner+":%q}`, aliceRunner),
			Status: http.StatusNotFound,
			After:  unchanged(p2),
		},
		{
			Name:   "alice cannot change who added a participation",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"added_by":%q}`, bobRunner),
			Status: http.StatusNotFound,
			After:  unchanged(p2),
		},
		{
			Name:   "added_by does not change through a modifier either",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"added_by+":%q}`, bobRunner),
			Status: http.StatusNotFound,
			After:  unchanged(p2),
		},

		// format
		{
			Name:     "the format cannot move to another event",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Body:     body(`{"format":%q}`, fLyon),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("format", apperr.CodeFormatOtherEvent)},
			After:    unchanged(p1),
		},
		{
			Name:   "the format can move inside the event",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"format":%q}`, f15),
			Status: http.StatusOK,
			After: storedIs(p1, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"format": fx.F15.Id, "confirmed": true}
			}),
		},
		{
			Name:   "the same format is not a change",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"format":%q,"status":"finished"}`, f42),
			Status: http.StatusOK,
			After: storedIs(p1, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"format": fx.F42.Id, "status": "finished"}
			}),
		},
		{
			Name:   "moving to a format that the runner already has is a duplicate",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"format":%q}`, f15),
			// Another participation of Alice, in F15.
			Before:   addParticipation(aliceRunner, f15),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_not_unique"},
			After:    unchanged(p1),
		},
		{
			Name:     "a status that is not one of the five is refused",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Body:     body(`{"status":"won"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{`"status"`},
			After:    unchanged(p1),
		},
	})
}

// addParticipation is a Before that adds a participation, as the fixture does.
func addParticipation(runner, format record) func(testing.TB, *tests.TestApp, testutil.Fixture) {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		r.Set("runner", runner(fx).Id)
		r.Set("format", format(fx).Id)
		r.Set("status", "interested")
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	}
}

func TestParticipations_Delete(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:   "bob cannot delete alice's confirmed participation",
			As:     "bob",
			Method: http.MethodDelete,
			URL:    participations(p1),
			Status: http.StatusNotFound,
			After:  both(count(3), unchanged(p1)),
		},
		{
			Name:   "bob deletes the participation of sam, who has no account",
			As:     "bob",
			Method: http.MethodDelete,
			URL:    participations(p3),
			Status: http.StatusNoContent,
			After:  count(2),
		},
		{
			Name:   "alice deletes her participation",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    participations(p1),
			Status: http.StatusNoContent,
			After:  count(2),
		},
		{
			Name:   "an admin deletes a confirmed participation",
			As:     "admin",
			Method: http.MethodDelete,
			URL:    participations(p1),
			Status: http.StatusNoContent,
			After:  count(2),
		},
		{
			Name:   "alice deletes the participation she added for bob, until he confirms it",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    participations(p2),
			Status: http.StatusNoContent,
			After:  count(2),
		},
		{
			Name:   "alice cannot delete bob's participation once he confirmed it",
			As:     "alice",
			Method: http.MethodDelete,
			URL:    participations(p2),
			Before: confirmed(p2),
			Status: http.StatusNotFound,
			After:  both(count(3), unchanged(p2)),
		},
		{
			Name:   "bob deletes his participation after he confirmed it",
			As:     "bob",
			Method: http.MethodDelete,
			URL:    participations(p2),
			Before: confirmed(p2),
			Status: http.StatusNoContent,
			After:  count(2),
		},
		{
			Name:   "an anonymous caller cannot delete the participation of sam",
			Method: http.MethodDelete,
			URL:    participations(p3),
			Status: http.StatusNotFound,
			After:  both(count(3), unchanged(p3)),
		},
	})
}

func TestParticipations_Read(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name:     "an anonymous caller lists nothing",
			Method:   http.MethodGet,
			URL:      participations(),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":0`},
		},
		{
			Name:     "an anonymous caller cannot view one",
			Method:   http.MethodGet,
			URL:      participations(p3),
			Status:   http.StatusNotFound,
			Contains: []string{`"status":404`},
		},
		{
			Name:     "a member lists them all",
			As:       "bob",
			Method:   http.MethodGet,
			URL:      participations(),
			Status:   http.StatusOK,
			Contains: []string{`"totalItems":3`},
		},
		{
			Name:     "a member views one of someone else",
			As:       "bob",
			Method:   http.MethodGet,
			URL:      participations(p1),
			Status:   http.StatusOK,
			Contains: []string{`"status":"registered"`, `"confirmed":true`},
		},
	})
}

// A superuser (the dashboard) goes through the same request hooks, but has no
// runner: nothing is added by anybody, and nothing is confirmed.
func TestParticipations_Superuser(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	superusers, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(superusers)
	superuser.SetEmail("root@example.test")
	superuser.SetPassword(testutil.Password)
	if err := app.Save(superuser); err != nil {
		t.Fatal(err)
	}
	token, err := superuser.NewAuthToken()
	if err != nil {
		t.Fatal(err)
	}

	(&tests.ApiScenario{
		Name:   "a superuser adds a participation",
		Method: http.MethodPost,
		URL:    "/api/collections/participations/records",
		Body: strings.NewReader(fmt.Sprintf(
			`{"runner":%q,"format":%q,"status":"interested","confirmed":true,"added_by":%q}`,
			fx.BobRunner.Id, fx.F15.Id, fx.AliceRunner.Id)),
		Headers:         map[string]string{"Authorization": token},
		ExpectedStatus:  http.StatusOK,
		ExpectedContent: []string{`"confirmed":false`, `"added_by":""`},
		TestAppFactory:  func(testing.TB) *tests.TestApp { return app },
		// NewApp already registered the cleanup.
		DisableTestAppCleanup: true,
	}).Test(t)
}

// The format rule is a model hook: it also holds for the writes that do not
// come from the API.
func TestParticipations_FormatStaysInEvent(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	codeOf := func(err error, field string) string {
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

	t.Run("another event", func(t *testing.T) {
		r := stored(t, app, fx.P1.Id)
		r.Set("format", fx.FLyon.Id)
		if got := codeOf(app.Save(r), "format"); got != apperr.CodeFormatOtherEvent {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatOtherEvent)
		}
		assertStored(t, stored(t, app, fx.P1.Id), map[string]any{"format": fx.F42.Id})
	})

	t.Run("the same event", func(t *testing.T) {
		r := stored(t, app, fx.P1.Id)
		r.Set("format", fx.F15.Id)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a record saved again without being loaded", func(t *testing.T) {
		// Its original state is blank, as it is for any record that this
		// process has just created.
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		r.Set("runner", fx.AdminRunner.Id)
		r.Set("format", fx.F42.Id)
		r.Set("status", "interested")
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}

		r.Set("format", fx.FLyon.Id)
		if got := codeOf(app.Save(r), "format"); got != apperr.CodeFormatOtherEvent {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatOtherEvent)
		}
		r.Set("format", fx.F15.Id)
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a new participation in any format", func(t *testing.T) {
		// Without an event, the event is the one of the format.
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		r.Set("runner", fx.AliceRunner.Id)
		r.Set("format", fx.FLyon.Id)
		r.Set("status", "interested")
		if err := app.Save(r); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("a new participation whose format is of another event than its event", func(t *testing.T) {
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		r := core.NewRecord(c)
		r.Set("runner", fx.SamRunner.Id)
		r.Set("event", fx.Event.Id)
		r.Set("format", fx.FLyon.Id)
		r.Set("status", "interested")
		if got := codeOf(app.Save(r), "format"); got != apperr.CodeFormatOtherEvent {
			t.Errorf("code = %q, want %q", got, apperr.CodeFormatOtherEvent)
		}
		// Sam is still on F15 only (P3): nothing was added.
		if got, err := app.CountRecords("participations", dbx.HashExp{"runner": fx.SamRunner.Id}); err != nil || got != 1 {
			t.Errorf("Sam has %d participations (%v), want his 1", got, err)
		}
	})
}

// The default status is a model hook too.
func TestParticipations_DefaultStatus(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	c, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	r.Set("runner", fx.AliceRunner.Id)
	r.Set("format", fx.F15.Id)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	assertStored(t, stored(t, app, r.Id), map[string]any{"status": "interested"})
}

// The event of a participation that has a format and no event is the one of
// its format, also for the writes that do not come from the API (the clients
// of the v1 never sent an event).
func TestParticipations_EventFilledFromFormat(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	c, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	r.Set("runner", fx.AdminRunner.Id)
	r.Set("format", fx.F15.Id)
	if err := app.Save(r); err != nil {
		t.Fatal(err)
	}
	assertStored(t, stored(t, app, r.Id), map[string]any{"event": fx.Event.Id, "format": fx.F15.Id})
}

// A participation can be for an event only, without a format ("interested,
// format to be chosen"): that is what the first rows create. When the runner
// is given a format of the event, the participation to the event is replaced
// by the new one, in the same transaction.
func TestParticipations_Undecided(t *testing.T) {
	// The participation without a format that some rows add to the database,
	// before the request, and then ask about.
	var pending *core.Record
	pendingOf := func(testutil.Fixture) *core.Record { return pending }
	bobPending := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		pending = undecided(t, app, fx.BobRunner, fx.Event2, fx.BobRunner, true)
	}
	// bobAndAdminPending adds the one of Bob, and the one of Admin.
	bobAndAdminPending := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		bobPending(t, app, fx)
		undecided(t, app, fx.AdminRunner, fx.Event2, fx.AdminRunner, true)
	}
	// bobOnTheFormatAndPending leaves the database in a state that the hooks
	// refuse to create: Bob is on FLyon, and still has a participation to the
	// event. The second one is added without validation.
	bobOnTheFormatAndPending := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		addParticipation(bobRunner, fLyon)(t, app, fx)
		c, err := app.FindCollectionByNameOrId("participations")
		if err != nil {
			t.Fatal(err)
		}
		pending = core.NewRecord(c)
		pending.Set("runner", fx.BobRunner.Id)
		pending.Set("event", fx.Event2.Id)
		pending.Set("status", "interested")
		if err := app.SaveNoValidate(pending); err != nil {
			t.Fatal(err)
		}
	}
	// stillThere asserts that the participation without a format of the runner
	// is in the database.
	stillThere := func(runner record) check {
		return createdUndecidedIs(runner, event2, func(testutil.Fixture) map[string]any {
			return map[string]any{"format": ""}
		})
	}

	testutil.RunRows(t, []testutil.Row{
		// creation without a format
		{
			Name:   "bob says he is interested in an event: confirmed, by him",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"event":%q,"status":"interested"}`, bobRunner, event2),
			Status: http.StatusOK,
			After: createdUndecidedIs(bobRunner, event2, func(fx testutil.Fixture) map[string]any {
				return map[string]any{
					"format": "", "event": fx.Event2.Id, "confirmed": true, "added_by": fx.BobRunner.Id,
				}
			}),
		},
		{
			Name:   "the event is the one of the format when the request has none",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"format":%q,"status":"registered"}`, samRunner, fLyon),
			Status: http.StatusOK,
			After: createdIs(samRunner, fLyon, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"event": fx.Event2.Id, "status": "registered"}
			}),
		},
		{
			Name:     "a format of another event than the event of the request is refused",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"event":%q,"format":%q,"status":"interested"}`, bobRunner, event, fLyon),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("format", apperr.CodeFormatOtherEvent)},
			After:    count(3),
		},
		{
			Name:     "without a format, the status can only be interested",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"event":%q,"status":"registered"}`, bobRunner, event2),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeFormatRequired)},
			After:    count(3),
		},
		{
			Name:     "neither an event nor a format is a validation error",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"status":"interested"}`, bobRunner),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("event", "validation_required")},
			After:    count(3),
		},
		{
			Name:   "an unknown event is a validation error, not a failure",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"event":"doesnotexist000","status":"interested"}`, bobRunner),
			Status: http.StatusBadRequest,
			After:  count(3),
		},
		{
			Name:     "a runner who is on a format of the event cannot be interested in the event only",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"event":%q,"status":"interested"}`, aliceRunner, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("format", apperr.CodeFormatRequired)},
			After:    both(count(3), unchanged(p1)),
		},
		{
			Name:     "a second participation to the same event, without a format",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   bobPending,
			Body:     body(`{"runner":%q,"event":%q,"status":"interested"}`, bobRunner, event2),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_not_unique"},
			After:    both(count(4), unchanged(pendingOf)),
		},

		// conversion
		{
			Name:   "bob chooses a format: his participation to the event is replaced",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Before: bobPending,
			Body:   body(`{"runner":%q,"format":%q,"status":"registered"}`, bobRunner, fLyon),
			Status: http.StatusOK,
			After: both(
				onlyIn(bobRunner, event2, fLyon),
				createdIs(bobRunner, fLyon, func(fx testutil.Fixture) map[string]any {
					return map[string]any{"event": fx.Event2.Id, "confirmed": true, "status": "registered"}
				}),
			),
		},
		{
			Name:   "alice chooses a format for bob: it replaces his, and it is not confirmed",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: bobPending,
			Body:   body(`{"runner":%q,"format":%q,"status":"interested"}`, bobRunner, fLyon),
			Status: http.StatusOK,
			After: both(
				onlyIn(bobRunner, event2, fLyon),
				createdIs(bobRunner, fLyon, func(fx testutil.Fixture) map[string]any {
					return map[string]any{"confirmed": false, "added_by": fx.AliceRunner.Id}
				}),
			),
		},
		{
			Name:   "the conversion leaves the participations of the other runners",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Before: bobAndAdminPending,
			Body:   body(`{"runner":%q,"format":%q}`, bobRunner, fLyon),
			Status: http.StatusOK,
			After:  both(onlyIn(bobRunner, event2, fLyon), stillThere(adminRunner)),
		},
		{
			// The new participation is refused by the unique index, which is
			// after the delete of the participation to the event.
			Name:     "the conversion is undone when the new participation is refused",
			As:       "bob",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   bobOnTheFormatAndPending,
			Body:     body(`{"runner":%q,"format":%q}`, bobRunner, fLyon),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_not_unique"},
			After: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				t.Helper()
				stillThere(bobRunner)(t, app, fx)
				if got := len(inEvent(t, app, fx.BobRunner, fx.Event2)); got != 2 {
					t.Errorf("%d participations of Bob in the event, want his 2", got)
				}
			},
		},
		{
			Name:   "a batch that is interested, then chooses a format, leaves the format",
			As:     "bob",
			Method: http.MethodPost,
			URL:    func(testutil.Fixture) string { return "/api/batch" },
			Body: body(`{"requests":[`+
				`{"method":"POST","url":"/api/collections/participations/records",`+
				`"body":{"runner":%q,"event":%q,"status":"interested"}},`+
				`{"method":"POST","url":"/api/collections/participations/records",`+
				`"body":{"runner":%q,"format":%q,"status":"registered"}}]}`,
				bobRunner, event2, bobRunner, fLyon),
			Status:   http.StatusOK,
			Contains: []string{`"status":200`},
			After:    onlyIn(bobRunner, event2, fLyon),
		},

		// modification
		{
			Name:   "bob gives a format to his participation to the event",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(pendingOf),
			Before: bobPending,
			Body:   body(`{"format":%q,"status":"registered"}`, fLyon),
			Status: http.StatusOK,
			After: storedIs(pendingOf, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"format": fx.FLyon.Id, "event": fx.Event2.Id, "status": "registered"}
			}),
		},
		{
			Name:     "without a format, the status cannot change to anything but interested",
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      participations(pendingOf),
			Before:   bobPending,
			Body:     body(`{"status":"registered"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{apperr.CodeFormatRequired},
			After:    unchanged(pendingOf),
		},
		{
			Name:     "a participation cannot lose its format while it is registered",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(p1),
			Body:     body(`{"format":""}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeFormatRequired)},
			After:    unchanged(p1),
		},
		{
			Name:   "a participation that is only interested can lose its format",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(p2),
			Body:   body(`{"format":"","status":"interested"}`),
			Status: http.StatusOK,
			After: storedIs(p2, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"format": "", "event": fx.Event.Id, "status": "interested"}
			}),
		},

		// the event never changes through the API
		{
			Name:   "alice cannot move her participation to another event",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"event":%q}`, event2),
			Status: http.StatusNotFound,
			After: both(unchanged(p1), storedIs(p1, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"event": fx.Event.Id}
			})),
		},
		{
			Name:   "the event cannot be sent again with the same value",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(p1),
			Body:   body(`{"event":%q}`, event),
			Status: http.StatusNotFound,
			After:  unchanged(p1),
		},
		{
			Name:   "an anonymous caller cannot change the event of a participation either",
			Method: http.MethodPatch,
			URL:    participations(p3),
			Body:   body(`{"event":%q}`, event2),
			Status: http.StatusNotFound,
			After:  unchanged(p3),
		},
	})
}

// A supporter is a participation to the event, without a format, whose status
// is "supporter": the runner comes to cheer. It keeps everything of the
// participation to the event: the unique index, the conversion when the runner
// is given a format, and the refusal when the runner is already on one. It is
// the only status other than "interested" that goes without a format, and it
// cannot be on a format.
func TestParticipations_Supporter(t *testing.T) {
	// The participation that the rows add to the database before the request,
	// and then ask about.
	var pending *core.Record
	pendingOf := func(testutil.Fixture) *core.Record { return pending }
	// aliceSupports makes Alice a supporter of the event of Lyon.
	aliceSupports := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		pending = inTheEventOnly(t, app, "supporter", fx.AliceRunner, fx.Event2, fx.AliceRunner, true)
	}
	bobIsInterested := func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		pending = undecided(t, app, fx.BobRunner, fx.Event2, fx.BobRunner, true)
	}

	testutil.RunRows(t, []testutil.Row{
		// creation
		{
			Name:   "alice comes to cheer: confirmed, by her",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"event":%q,"status":"supporter"}`, aliceRunner, event2),
			Status: http.StatusOK,
			After: createdUndecidedIs(aliceRunner, event2, func(fx testutil.Fixture) map[string]any {
				return map[string]any{
					"format": "", "status": "supporter", "confirmed": true, "added_by": fx.AliceRunner.Id,
				}
			}),
		},
		{
			Name:   "bob adds alice as a supporter: not confirmed",
			As:     "bob",
			Method: http.MethodPost,
			URL:    participations(),
			Body:   body(`{"runner":%q,"event":%q,"status":"supporter"}`, aliceRunner, event2),
			Status: http.StatusOK,
			After: createdUndecidedIs(aliceRunner, event2, func(fx testutil.Fixture) map[string]any {
				return map[string]any{
					"format": "", "status": "supporter", "confirmed": false, "added_by": fx.BobRunner.Id,
				}
			}),
		},
		{
			Name:     "a supporter does not run a race",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"event":%q,"format":%q,"status":"supporter"}`, aliceRunner, event, f15),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeSupporterWithFormat)},
			After:    count(3),
		},
		{
			Name:     "a runner who is on a format of the event cannot be a supporter of it",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Body:     body(`{"runner":%q,"event":%q,"status":"supporter"}`, aliceRunner, event),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("format", apperr.CodeFormatRequired)},
			After:    both(count(3), unchanged(p1)),
		},
		{
			Name:     "a runner is a supporter of the event only once",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      participations(),
			Before:   aliceSupports,
			Body:     body(`{"runner":%q,"event":%q,"status":"supporter"}`, aliceRunner, event2),
			Status:   http.StatusBadRequest,
			Contains: []string{"validation_not_unique"},
			After:    both(count(4), unchanged(pendingOf)),
		},

		// conversion
		{
			Name:   "a supporter who is given a format becomes a runner: the supporter is replaced",
			As:     "alice",
			Method: http.MethodPost,
			URL:    participations(),
			Before: aliceSupports,
			Body:   body(`{"runner":%q,"event":%q,"format":%q,"status":"registered"}`, aliceRunner, event2, fLyon),
			Status: http.StatusOK,
			After: both(
				onlyIn(aliceRunner, event2, fLyon),
				createdIs(aliceRunner, fLyon, func(testutil.Fixture) map[string]any {
					return map[string]any{"status": "registered", "confirmed": true}
				}),
			),
		},

		// modification
		{
			Name:   "a supporter becomes interested in the event",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(pendingOf),
			Before: aliceSupports,
			Body:   body(`{"status":"interested"}`),
			Status: http.StatusOK,
			After: storedIs(pendingOf, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"status": "interested", "format": "", "event": fx.Event2.Id}
			}),
		},
		{
			Name:   "a runner who is interested in the event becomes a supporter",
			As:     "bob",
			Method: http.MethodPatch,
			URL:    participations(pendingOf),
			Before: bobIsInterested,
			Body:   body(`{"status":"supporter"}`),
			Status: http.StatusOK,
			After: storedIs(pendingOf, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"status": "supporter", "format": "", "event": fx.Event2.Id}
			}),
		},
		{
			Name:     "without a format, a supporter cannot be registered",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(pendingOf),
			Before:   aliceSupports,
			Body:     body(`{"status":"registered"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeFormatRequired)},
			After:    unchanged(pendingOf),
		},
		{
			Name:   "a supporter is given a format, and a status that goes with it",
			As:     "alice",
			Method: http.MethodPatch,
			URL:    participations(pendingOf),
			Before: aliceSupports,
			Body:   body(`{"format":%q,"status":"interested"}`, fLyon),
			Status: http.StatusOK,
			After: storedIs(pendingOf, func(fx testutil.Fixture) map[string]any {
				return map[string]any{"format": fx.FLyon.Id, "status": "interested", "event": fx.Event2.Id}
			}),
		},
		{
			Name:     "a supporter cannot be given a format and stay a supporter",
			As:       "alice",
			Method:   http.MethodPatch,
			URL:      participations(pendingOf),
			Before:   aliceSupports,
			Body:     body(`{"format":%q}`, fLyon),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeSupporterWithFormat)},
			After:    unchanged(pendingOf),
		},
		{
			Name:     "a participation to a format cannot become a supporter",
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      participations(p2),
			Body:     body(`{"status":"supporter"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("status", apperr.CodeSupporterWithFormat)},
			After:    unchanged(p2),
		},
	})
}
