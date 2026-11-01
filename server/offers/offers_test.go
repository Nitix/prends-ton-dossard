package offers_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/testutil"
)

// record picks a record of the fixture.
type record = func(testutil.Fixture) *core.Record

// ref gives an id, or any other text, once the fixture exists.
type ref = func(testutil.Fixture) string

// check is a step of a test on the database of a test application: a Before
// that sets data up, or an After that asserts on it.
type check = func(testing.TB, *tests.TestApp, testutil.Fixture)

func event(fx testutil.Fixture) *core.Record       { return fx.Event }
func event2(fx testutil.Fixture) *core.Record      { return fx.Event2 }
func adminRunner(fx testutil.Fixture) *core.Record { return fx.AdminRunner }
func aliceRunner(fx testutil.Fixture) *core.Record { return fx.AliceRunner }
func bobRunner(fx testutil.Fixture) *core.Record   { return fx.BobRunner }
func samRunner(fx testutil.Fixture) *core.Record   { return fx.SamRunner }

// target is the offer that the Before of a row sets up, and that its request is
// about. other is a second offer, which the request is not about. seatOf holds
// the places that the Befores saved in target, by the name of the runner. zoe is
// a runner that has nothing but a place. The rows run one after the other, and
// each Before sets them again.
var (
	target, other, zoe *core.Record
	seatOf             = map[string]*core.Record{}
)

func id(of record) ref { return func(fx testutil.Fixture) string { return of(fx).Id } }

func theTarget(testutil.Fixture) string { return target.Id }

// body builds a JSON request body, the %q verbs being the ids.
func body(tmpl string, ids ...ref) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string {
		args := make([]any, len(ids))
		for i, id := range ids {
			args[i] = id(fx)
		}
		return fmt.Sprintf(tmpl, args...)
	}
}

// fieldError is how the API reports a refused field: data.<field>.code.
func fieldError(field, code string) string {
	return fmt.Sprintf(`"%s":{"code":"%s"`, field, code)
}

// offersURL builds the URL of the offers, or of the one that Before saved.
func offersURL(one bool) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		url := "/api/collections/offers/records"
		if one {
			url += "/" + target.Id
		}
		return url
	}
}

// seatsURL builds the URL of the places.
func seatsURL(testutil.Fixture) string { return "/api/collections/offer_members/records" }

// seatURL builds the URL of the place that a Before saved for that runner.
func seatURL(name string) func(testutil.Fixture) string {
	return func(testutil.Fixture) string {
		return "/api/collections/offer_members/records/" + seatOf[name].Id
	}
}

func eventURL(of record) func(testutil.Fixture) string {
	return func(fx testutil.Fixture) string { return "/api/collections/events/records/" + of(fx).Id }
}

func batchURL(testutil.Fixture) string { return "/api/batch" }

// save saves a record as the code of the application does, without a request:
// the request hooks do not run, so the owner and the author are the ones given.
func save(t testing.TB, app core.App, collection string, values map[string]any) *core.Record {
	t.Helper()
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		t.Fatal(err)
	}
	r := core.NewRecord(c)
	for field, value := range values {
		r.Set(field, value)
	}
	if err := app.Save(r); err != nil {
		t.Fatalf("saving a record of %s: %v", collection, err)
	}
	return r
}

// offer saves an offer of owner on event.
func offer(t testing.TB, app core.App, on, owner *core.Record, kind string, seats int) *core.Record {
	t.Helper()
	place := "Lyon, Part-Dieu"
	if kind == "lodging" {
		place = "Gîte des Crêtes"
	}
	return save(t, app, "offers", map[string]any{
		"event": on.Id, "kind": kind, "owner": owner.Id, "place": place, "seats": seats,
	})
}

// seat saves a place of runner in the offer, which the runner took.
func seat(t testing.TB, app core.App, of, runner *core.Record) *core.Record {
	t.Helper()
	return save(t, app, "offer_members", map[string]any{
		"offer": of.Id, "runner": runner.Id, "added_by": runner.Id,
	})
}

// newRunner saves a runner who has no account and is on no race.
func newRunner(t testing.TB, app core.App, name string) *core.Record {
	t.Helper()
	return save(t, app, "runners", map[string]any{"name": name})
}

// offerOn is the Before that sets target up: an offer of the kind, by that
// owner, on that event, with that many seats.
func offerOn(on, by record, kind string, seats int) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		target = offer(t, app, on(fx), by(fx), kind, seats)
		seatOf = map[string]*core.Record{}
	}
}

// The offers that most rows start from.
var (
	bobsCar     = offerOn(event, bobRunner, "ride", 3)
	bobsLodging = offerOn(event, bobRunner, "lodging", 0)
)

// bobsCarOf is the car of Bob on Event with that many seats.
func bobsCarOf(seats int) check { return offerOn(event, bobRunner, "ride", seats) }

// inTarget is the Before that puts the runners in target, each one having
// taken the place.
func inTarget(runners ...record) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		for _, of := range runners {
			runner := of(fx)
			seatOf[runner.GetString("name")] = seat(t, app, target, runner)
		}
	}
}

// otherOffer is the Before that sets other up: an offer that the request is not
// about.
func otherOffer(on, by record, kind string, seats int) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		other = offer(t, app, on(fx), by(fx), kind, seats)
	}
}

// inOther puts the runner in other.
func inOther(runner record) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		seat(t, app, other, runner(fx))
	}
}

// all runs the checks one after the other: the Befores of a row, or its Afters.
func all(list ...check) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		for _, step := range list {
			step(t, app, fx)
		}
	}
}

// aliceTookBobsCar: Alice is a passenger of the car of Bob.
var aliceTookBobsCar = all(bobsCar, inTarget(aliceRunner))

// lodgingForFive is a lodging of Bob without a limit, where five people sleep.
func lodgingForFive(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	bobsLodging(t, app, fx)
	for _, runner := range []*core.Record{
		fx.AdminRunner, fx.SamRunner,
		newRunner(t, app, "Julie"), newRunner(t, app, "Léa"), newRunner(t, app, "Nina"),
	} {
		seatOf[runner.GetString("name")] = seat(t, app, target, runner)
	}
}

// zoeInBobsCar: Zoé, who has no account and is on no race, is in the car of Bob.
func zoeInBobsCar(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	bobsCar(t, app, fx)
	zoe = newRunner(t, app, "Zoé")
	seatOf["Zoé"] = seat(t, app, target, zoe)
}

// storedOffers returns every offer in the database.
func storedOffers(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	offers, err := app.FindAllRecords("offers")
	if err != nil {
		t.Fatal(err)
	}
	return offers
}

// storedSeats returns every place in the database.
func storedSeats(t testing.TB, app core.App) []*core.Record {
	t.Helper()
	seats, err := app.FindAllRecords("offer_members")
	if err != nil {
		t.Fatal(err)
	}
	return seats
}

// noOffer asserts that the database holds no offer.
func noOffer(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
	t.Helper()
	if got := len(storedOffers(t, app)); got != 0 {
		t.Errorf("%d offers in the database, want none", got)
	}
}

// noSeat asserts that the database holds no place.
func noSeat(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
	t.Helper()
	if got := len(storedSeats(t, app)); got != 0 {
		t.Errorf("%d places in the database, want none", got)
	}
}

// noOfferNoSeat asserts that nothing is left: the offers went, and their places.
func noOfferNoSeat(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
	t.Helper()
	noOffer(t, app, fx)
	noSeat(t, app, fx)
}

// seatCount asserts how many places the database holds.
func seatCount(want int) check {
	return func(t testing.TB, app *tests.TestApp, _ testutil.Fixture) {
		t.Helper()
		if got := len(storedSeats(t, app)); got != want {
			t.Errorf("%d places in the database, want %d", got, want)
		}
	}
}

// fieldsAre compares the fields of a record with the wanted values: a text, a
// number, or a record of the fixture, which stands for its id.
func fieldsAre(t testing.TB, got *core.Record, want map[string]any, fx testutil.Fixture) {
	t.Helper()
	for field, value := range want {
		if of, ok := value.(record); ok {
			value = of(fx).Id
		}
		if g, w := fmt.Sprint(got.Get(field)), fmt.Sprint(value); g != w {
			t.Errorf("%s = %q, want %q", field, g, w)
		}
	}
}

// offerIs asserts the fields of target, as they are in the database.
func offerIs(want map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		got, err := app.FindRecordById("offers", target.Id)
		if err != nil {
			t.Fatalf("the offer is not in the database: %v", err)
		}
		fieldsAre(t, got, want, fx)
	}
}

// createdOffer asserts the fields of the only offer, which the request has just
// created.
func createdOffer(want map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		offers := storedOffers(t, app)
		if len(offers) != 1 {
			t.Fatalf("%d offers in the database, want 1", len(offers))
		}
		fieldsAre(t, offers[0], want, fx)
	}
}

// createdSeat asserts the fields of the only place, which the request has just
// created.
func createdSeat(want map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		seats := storedSeats(t, app)
		if len(seats) != 1 {
			t.Fatalf("%d places in the database, want 1", len(seats))
		}
		fieldsAre(t, seats[0], want, fx)
	}
}

// seatIs asserts that the place of that runner is in the database, in target.
func seatIs(name string, want map[string]any) check {
	return func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
		t.Helper()
		got, err := app.FindRecordById("offer_members", seatOf[name].Id)
		if err != nil {
			t.Fatalf("the place of %s is not in the database: %v", name, err)
		}
		fieldsAre(t, got, want, fx)
	}
}

func TestOffers(t *testing.T) {
	const carPlace = "Lyon, Part-Dieu"
	longText := func(n int) string { return strings.Repeat("é", n) }

	testutil.RunRows(t, []testutil.Row{
		// Offering a car or a lodging: what the server sets, and what it empties.
		{
			Name:   "the owner is the runner of the caller, whatever the body says",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body: body(`{"event":%q,"kind":"ride","owner":%q,"place":"Lyon","seats":3,`+
				`"date":"2026-06-12","time":"18:00"}`, id(event), id(bobRunner)),
			Status: http.StatusOK,
			After: createdOffer(map[string]any{
				"owner": aliceRunner, "event": event, "kind": "ride", "place": "Lyon",
				"seats": 3, "date": "2026-06-12", "time": "18:00",
			}),
		},
		{
			Name:     "a car needs its seats",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_required")},
			After:    noOffer,
		},
		{
			Name:     "a car of 0 seats is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":0}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_required")},
			After:    noOffer,
		},
		{
			Name:     "a car of 9 seats is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":9}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_required")},
			After:    noOffer,
		},
		{
			Name:   "a car of 8 seats is kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":8}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"seats": 8}),
		},
		{
			Name:   "a car of 1 seat is kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":1}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"seats": 1}),
		},
		{
			Name:   "a car loses the end date and the link of a lodging",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body: body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,`+
				`"end_date":"2026-06-14","url":"https://example.test/annonce"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"end_date": "", "url": "", "seats": 3}),
		},
		{
			// Emptied before the validation: what a car does not have is not
			// held against it.
			Name:   "what a car does not have is not checked",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body: body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,`+
				`"end_date":"n'importe quoi","url":"pas une adresse"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"end_date": "", "url": ""}),
		},
		{
			Name:   "a lodging loses the time, and has no seats by default",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"lodging","place":"Gîte","time":"18:00"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"time": "", "seats": 0, "kind": "lodging", "place": "Gîte"}),
		},
		{
			Name:   "a lodging keeps its end date and its link",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body: body(`{"event":%q,"kind":"lodging","place":"Gîte","seats":4,"date":"2026-06-12",`+
				`"end_date":"2026-06-14","url":"https://example.test/annonce","notes":"Draps fournis"}`, id(event)),
			Status: http.StatusOK,
			After: createdOffer(map[string]any{
				"seats": 4, "date": "2026-06-12", "end_date": "2026-06-14",
				"url": "https://example.test/annonce", "notes": "Draps fournis",
			}),
		},
		{
			Name:   "a lodging of 30 seats is kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"lodging","place":"Gîte","seats":30}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"seats": 30}),
		},
		{
			Name:     "a lodging of 31 seats is refused by the field",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Gîte","seats":31}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "validation_max_number_constraint")},
			After:    noOffer,
		},
		{
			Name:     "a car needs a place",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","seats":3}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("place", "validation_required")},
			After:    noOffer,
		},
		{
			Name:   "a place of 120 characters is kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","seats":3,"place":"`+longText(120)+`"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"place": longText(120)}),
		},
		{
			Name:     "a place of 121 characters is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","seats":3,"place":"`+longText(121)+`"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("place", "validation_max_text_constraint")},
			After:    noOffer,
		},
		{
			Name:   "notes of 1000 characters are kept",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","seats":3,"place":"Lyon","notes":"`+longText(1000)+`"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"notes": longText(1000)}),
		},
		{
			Name:     "notes of 1001 characters are refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","seats":3,"place":"Lyon","notes":"`+longText(1001)+`"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("notes", "validation_max_text_constraint")},
			After:    noOffer,
		},
		{
			Name:     "the link of a lodging is an address",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Gîte","url":"pas une adresse"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("url", "validation_invalid_url")},
			After:    noOffer,
		},
		{
			Name:     "an event is required",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"kind":"ride","place":"Lyon","seats":3}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("event", "validation_required")},
			After:    noOffer,
		},
		{
			Name:     "a kind is required",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"place":"Lyon","seats":3}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("kind", "validation_required")},
			After:    noOffer,
		},
		{
			Name:     "a kind is one of the two",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"boat","place":"Lyon","seats":3}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{`"kind":{"code":"validation_`},
			After:    noOffer,
		},
		{
			Name:   "an anonymous caller cannot offer",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3}`, id(event)),
			Status: http.StatusBadRequest,
			After:  noOffer,
		},

		// Dates and times.
		{
			Name:     "a time that is not HH:MM is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"6h30"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("time", "time_invalid")},
			After:    noOffer,
		},
		{
			Name:     "a time of one digit for the hour is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"6:30"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("time", "time_invalid")},
			After:    noOffer,
		},
		{
			Name:     "24:00 is not a time",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"24:00"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("time", "time_invalid")},
			After:    noOffer,
		},
		{
			Name:     "a time with a minute over 59 is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"12:60"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("time", "time_invalid")},
			After:    noOffer,
		},
		{
			Name:   "23:59 and 00:00 are times",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"23:59"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"time": "23:59"}),
		},
		{
			Name:   "00:00 is a time",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"time":"00:00"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"time": "00:00"}),
		},
		{
			Name:     "a lodging cannot end before it starts",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Gîte","date":"2026-06-13","end_date":"2026-06-12"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("end_date", "end_before_start")},
			After:    noOffer,
		},
		{
			Name:   "a lodging can start and end the same day",
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"lodging","place":"Gîte","date":"2026-06-13","end_date":"2026-06-13"}`, id(event)),
			Status: http.StatusOK,
			After:  createdOffer(map[string]any{"date": "2026-06-13", "end_date": "2026-06-13"}),
		},
		{
			Name:     "a day written like 13/06/2026 is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"date":"13/06/2026"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "date_invalid")},
			After:    noOffer,
		},
		{
			Name:     "a day that does not exist is refused",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3,"date":"2026-02-30"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "date_invalid")},
			After:    noOffer,
		},
		{
			Name:     "the end date of a lodging is a day too",
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Gîte","date":"2026-06-13","end_date":"2026-6-14"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("end_date", "date_invalid")},
			After:    noOffer,
		},

		// One offer of each kind for a runner and an event.
		{
			Name:     "a runner offers one car per event",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Grenoble","seats":2}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("kind", "offer_already_member")},
			After:    createdOffer(map[string]any{"place": carPlace}),
		},
		{
			Name:     "a runner offers one lodging per event",
			Before:   bobsLodging,
			As:       "bob",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Un autre gîte"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("kind", "offer_already_member")},
		},
		{
			Name:   "a runner offers a lodging as well as a car",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"lodging","place":"Gîte"}`, id(event)),
			Status: http.StatusOK,
		},
		{
			Name:   "a runner offers a car for each event",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Lyon","seats":3}`, id(event2)),
			Status: http.StatusOK,
		},
		{
			Name:     "a passenger of a car does not offer another one",
			Before:   aliceTookBobsCar,
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","place":"Annecy","seats":2}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("kind", "offer_already_member")},
		},
		{
			Name:     "a guest of a lodging does not offer another one",
			Before:   all(bobsLodging, inTarget(aliceRunner)),
			As:       "alice",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"lodging","place":"Gîte"}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("kind", "offer_already_member")},
		},
		{
			Name:   "a passenger of a car offers a lodging",
			Before: aliceTookBobsCar,
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"lodging","place":"Gîte"}`, id(event)),
			Status: http.StatusOK,
		},
		{
			Name:   "a passenger in the car of another event offers a car",
			Before: all(offerOn(event2, bobRunner, "ride", 3), inTarget(aliceRunner)),
			As:     "alice",
			Method: http.MethodPost,
			URL:    offersURL(false),
			Body:   body(`{"event":%q,"kind":"ride","place":"Annecy","seats":2}`, id(event)),
			Status: http.StatusOK,
		},
		{
			Name: "a batch cannot offer two cars of one runner",
			As:   "alice", Method: http.MethodPost, URL: batchURL,
			Body: body(`{"requests":[`+
				`{"method":"POST","url":"/api/collections/offers/records","body":{"event":%[1]q,"kind":"ride","place":"Lyon","seats":3}},`+
				`{"method":"POST","url":"/api/collections/offers/records","body":{"event":%[1]q,"kind":"ride","place":"Annecy","seats":2}}]}`, id(event)),
			Status:   http.StatusBadRequest,
			Contains: []string{`"code":"batch_request_failed"`},
			After:    noOffer,
		},
		{
			// The batch route runs the same handlers, so the same hooks.
			Name:   "a batch cannot forge the owner of an offer",
			As:     "alice",
			Method: http.MethodPost,
			URL:    batchURL,
			Body: body(`{"requests":[{"method":"POST","url":"/api/collections/offers/records",`+
				`"body":{"event":%q,"kind":"ride","owner":%q,"place":"Lyon","seats":3}}]}`, id(event), id(bobRunner)),
			Status:   http.StatusOK,
			Contains: []string{`"status":200`},
			After:    createdOffer(map[string]any{"owner": aliceRunner}),
		},

		// Changing an offer: the owner and the admins, never its owner, event or kind.
		{
			Name:   "alice cannot change the car of bob",
			Before: bobsCar,
			As:     "alice",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"x"}`),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"place": carPlace}),
		},
		{
			Name:   "bob changes his car",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"Lyon Perrache"}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"place": "Lyon Perrache", "owner": bobRunner}),
		},
		{
			Name:   "an admin changes the car of a member",
			Before: bobsCar,
			As:     "admin",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"x"}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"place": "x", "owner": bobRunner}),
		},
		{
			Name:   "an anonymous caller changes nothing",
			Before: bobsCar,
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"x"}`),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"place": carPlace}),
		},
		{
			// The owner is empty for a runner without account, and so is the
			// account of an anonymous caller: only the signed-in guard tells
			// them apart.
			Name:   "an anonymous caller changes no offer of a runner without account",
			Before: offerOn(event, samRunner, "ride", 3),
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"x"}`),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"place": carPlace}),
		},
		{
			Name:   "a member changes no offer of a runner without account",
			Before: offerOn(event, samRunner, "ride", 3),
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"x"}`),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"place": carPlace}),
		},
		{
			Name:   "an offer keeps its kind",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"kind":"lodging"}`),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"kind": "ride"}),
		},
		{
			Name:   "an offer keeps its owner",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"owner":%q}`, id(aliceRunner)),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"owner": bobRunner}),
		},
		{
			Name:   "an offer stays in its event",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"event":%q}`, id(event2)),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"event": event}),
		},
		{
			Name:   "an admin cannot move an offer either",
			Before: bobsCar,
			As:     "admin",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"event":%q,"owner":%q}`, id(event2), id(adminRunner)),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"event": event, "owner": bobRunner}),
		},
		{
			Name:     "a batch cannot move an offer to another event",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPost,
			URL:      batchURL,
			Body:     body(`{"requests":[{"method":"PATCH","url":"/api/collections/offers/records/%s","body":{"event":%q}}]}`, theTarget, id(event2)),
			Status:   http.StatusBadRequest,
			Contains: []string{`"code":"batch_request_failed"`},
			After:    offerIs(map[string]any{"event": event}),
		},
		{
			Name:   "a car loses what only a lodging has when it is edited",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"url":"https://example.test/annonce","end_date":"2026-06-14"}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"url": "", "end_date": ""}),
		},
		{
			Name:     "an edit that breaks the date is refused",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      offersURL(true),
			Body:     body(`{"date":"2026-02-30"}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("date", "date_invalid")},
			After:    offerIs(map[string]any{"date": ""}),
		},

		// Changing the seats of an offer that has people in it.
		{
			Name:     "the seats of a car do not go below the passengers",
			Before:   all(bobsCar, inTarget(aliceRunner, samRunner)),
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      offersURL(true),
			Body:     body(`{"seats":1}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_below_members")},
			After:    offerIs(map[string]any{"seats": 3}),
		},
		{
			Name:   "the seats of a car go down to the passengers",
			Before: all(bobsCar, inTarget(aliceRunner, samRunner)),
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"seats":2}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"seats": 2}),
		},
		{
			Name:     "a car keeps at least one seat when it is edited",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      offersURL(true),
			Body:     body(`{"seats":0}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_required")},
			After:    offerIs(map[string]any{"seats": 3}),
		},
		{
			Name:     "a car keeps at most eight seats when it is edited",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      offersURL(true),
			Body:     body(`{"seats":9}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_required")},
			After:    offerIs(map[string]any{"seats": 3}),
		},
		{
			Name:   "a lodging with five guests loses its limit",
			Before: lodgingForFive,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"seats":0}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"seats": 0}),
		},
		{
			Name:     "a lodging with five guests does not go to three seats",
			Before:   lodgingForFive,
			As:       "bob",
			Method:   http.MethodPatch,
			URL:      offersURL(true),
			Body:     body(`{"seats":3}`),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("seats", "offer_seats_below_members")},
			After:    offerIs(map[string]any{"seats": 0}),
		},
		{
			Name:   "a lodging with five guests goes to five seats",
			Before: lodgingForFive,
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"seats":5}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"seats": 5}),
		},
		{
			Name:   "the other fields change whatever the number of passengers",
			Before: all(bobsCar, inTarget(aliceRunner, samRunner)),
			As:     "bob",
			Method: http.MethodPatch,
			URL:    offersURL(true),
			Body:   body(`{"place":"Lyon Perrache","time":"07:15"}`),
			Status: http.StatusOK,
			After:  offerIs(map[string]any{"place": "Lyon Perrache", "time": "07:15", "seats": 3}),
		},

		// Reading.
		{
			Name:        "an anonymous caller lists nothing",
			Before:      bobsCar,
			Method:      http.MethodGet,
			URL:         offersURL(false),
			Status:      http.StatusOK,
			Contains:    []string{`"items":[]`},
			NotContains: []string{carPlace},
		},
		{
			Name:        "an anonymous caller cannot view one",
			Before:      bobsCar,
			Method:      http.MethodGet,
			URL:         offersURL(true),
			Status:      http.StatusNotFound,
			NotContains: []string{carPlace},
		},
		{
			Name:     "alice lists the offers",
			Before:   bobsCar,
			As:       "alice",
			Method:   http.MethodGet,
			URL:      offersURL(false),
			Status:   http.StatusOK,
			Contains: []string{carPlace},
		},
		{
			Name:     "alice views the car of bob",
			Before:   bobsCar,
			As:       "alice",
			Method:   http.MethodGet,
			URL:      offersURL(true),
			Status:   http.StatusOK,
			Contains: []string{carPlace},
		},
		{
			Name:        "an anonymous caller lists no place",
			Before:      aliceTookBobsCar,
			Method:      http.MethodGet,
			URL:         seatsURL,
			Status:      http.StatusOK,
			Contains:    []string{`"items":[]`},
			NotContains: []string{"added_by"},
		},
		{
			Name:     "alice lists the places",
			Before:   aliceTookBobsCar,
			As:       "alice",
			Method:   http.MethodGet,
			URL:      seatsURL,
			Status:   http.StatusOK,
			Contains: []string{`"added_by"`},
		},

		// Taking a place.
		{
			Name:   "alice takes a place for herself",
			Before: bobsCar,
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status: http.StatusOK,
			After:  createdSeat(map[string]any{"runner": aliceRunner, "added_by": aliceRunner}),
		},
		{
			Name:   "the one who places somebody is the one who added them, whatever the body says",
			Before: bobsCar,
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q,"added_by":%q}`, theTarget, id(aliceRunner), id(bobRunner)),
			Status: http.StatusOK,
			After:  createdSeat(map[string]any{"runner": aliceRunner, "added_by": aliceRunner}),
		},
		{
			Name:   "bob places Sam in his car",
			Before: bobsCar,
			As:     "bob",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(samRunner)),
			Status: http.StatusOK,
			After:  createdSeat(map[string]any{"runner": samRunner, "added_by": bobRunner}),
		},
		{
			Name:   "an admin places Sam in the car of a member",
			Before: bobsCar,
			As:     "admin",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(samRunner)),
			Status: http.StatusOK,
			After:  createdSeat(map[string]any{"runner": samRunner, "added_by": adminRunner}),
		},
		{
			Name:   "alice cannot place Sam in the car of bob",
			Before: bobsCar,
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(samRunner)),
			Status: http.StatusBadRequest,
			After:  noSeat,
		},
		{
			Name:   "an anonymous caller takes no place",
			Before: bobsCar,
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(samRunner)),
			Status: http.StatusBadRequest,
			After:  noSeat,
		},
		{
			Name:   "a batch cannot forge the one who added a place",
			Before: bobsCar,
			As:     "alice",
			Method: http.MethodPost,
			URL:    batchURL,
			Body: body(`{"requests":[{"method":"POST","url":"/api/collections/offer_members/records",`+
				`"body":{"offer":%q,"runner":%q,"added_by":%q}}]}`, theTarget, id(aliceRunner), id(bobRunner)),
			Status:   http.StatusOK,
			Contains: []string{`"status":200`},
			After:    createdSeat(map[string]any{"runner": aliceRunner, "added_by": aliceRunner}),
		},
		{
			Name:     "the owner takes no place in his own offer",
			Before:   bobsCar,
			As:       "bob",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(bobRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "offer_owner_member")},
			After:    noSeat,
		},
		{
			Name:     "an admin does not place the owner in his own offer",
			Before:   bobsCar,
			As:       "admin",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(bobRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "offer_owner_member")},
			After:    noSeat,
		},
		{
			Name:     "a car that is full takes nobody",
			Before:   all(bobsCarOf(1), inTarget(samRunner)),
			As:       "alice",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("offer", "offer_full")},
			After:    seatCount(1),
		},
		{
			Name:   "the last seat of a car is taken",
			Before: all(bobsCarOf(2), inTarget(samRunner)),
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status: http.StatusOK,
			After:  seatCount(2),
		},
		{
			Name:   "a lodging without a limit takes one more",
			Before: lodgingForFive,
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status: http.StatusOK,
			After:  seatCount(6),
		},
		{
			Name:     "a runner has one place of each kind per event",
			Before:   all(bobsCar, otherOffer(event, adminRunner, "ride", 3), inOther(aliceRunner)),
			As:       "alice",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "offer_already_member")},
			After:    seatCount(1),
		},
		{
			Name:     "an owner takes no place in a car of the same event",
			Before:   all(bobsCar, otherOffer(event, aliceRunner, "ride", 3)),
			As:       "alice",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "offer_already_member")},
			After:    noSeat,
		},
		{
			Name:     "the owner of a car does not place somebody who has a car",
			Before:   all(bobsCar, otherOffer(event, aliceRunner, "ride", 3)),
			As:       "bob",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "offer_already_member")},
			After:    noSeat,
		},
		{
			Name:   "a lodging and a car do not exclude one another",
			Before: all(bobsCar, otherOffer(event, adminRunner, "lodging", 0), inOther(aliceRunner)),
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status: http.StatusOK,
			After:  seatCount(2),
		},
		{
			Name:   "the car of another event does not count",
			Before: all(bobsCar, otherOffer(event2, adminRunner, "ride", 3), inOther(aliceRunner)),
			As:     "alice",
			Method: http.MethodPost,
			URL:    seatsURL,
			Body:   body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status: http.StatusOK,
			After:  seatCount(2),
		},
		{
			Name:     "nobody takes the same place twice",
			Before:   aliceTookBobsCar,
			As:       "alice",
			Method:   http.MethodPost,
			URL:      seatsURL,
			Body:     body(`{"offer":%q,"runner":%q}`, theTarget, id(aliceRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("runner", "validation_not_unique")},
			After:    seatCount(1),
		},

		// Changing a place: nobody does. To move somebody, free the place and take another.
		{
			Name:   "a member does not change a place",
			Before: aliceTookBobsCar,
			As:     "alice",
			Method: http.MethodPatch,
			URL:    seatURL("Alice"),
			Body:   body(`{"runner":%q}`, id(samRunner)),
			Status: http.StatusForbidden,
			After:  seatIs("Alice", map[string]any{"runner": aliceRunner}),
		},
		{
			Name:   "an admin does not change a place either",
			Before: aliceTookBobsCar,
			As:     "admin",
			Method: http.MethodPatch,
			URL:    seatURL("Alice"),
			Body:   body(`{"runner":%q}`, id(samRunner)),
			Status: http.StatusForbidden,
			After:  seatIs("Alice", map[string]any{"runner": aliceRunner}),
		},

		// Freeing a place.
		{
			Name:   "alice frees her place",
			Before: aliceTookBobsCar,
			As:     "alice",
			Method: http.MethodDelete,
			URL:    seatURL("Alice"),
			Status: http.StatusNoContent,
			After:  noSeat,
		},
		{
			Name:   "the owner frees the place of Alice",
			Before: aliceTookBobsCar,
			As:     "bob",
			Method: http.MethodDelete,
			URL:    seatURL("Alice"),
			Status: http.StatusNoContent,
			After:  noSeat,
		},
		{
			Name:   "an admin frees the place of Alice",
			Before: aliceTookBobsCar,
			As:     "admin",
			Method: http.MethodDelete,
			URL:    seatURL("Alice"),
			Status: http.StatusNoContent,
			After:  noSeat,
		},
		{
			Name:   "alice does not free the place of Sam",
			Before: all(bobsCar, inTarget(samRunner)),
			As:     "alice",
			Method: http.MethodDelete,
			URL:    seatURL("Sam"),
			Status: http.StatusNotFound,
			After:  seatCount(1),
		},
		{
			Name:   "the owner frees the place of Sam, who has no account",
			Before: all(bobsCar, inTarget(samRunner)),
			As:     "bob",
			Method: http.MethodDelete,
			URL:    seatURL("Sam"),
			Status: http.StatusNoContent,
			After:  noSeat,
		},
		{
			Name:   "an anonymous caller frees no place of a runner without account",
			Before: all(bobsCar, inTarget(samRunner)),
			Method: http.MethodDelete,
			URL:    seatURL("Sam"),
			Status: http.StatusNotFound,
			After:  seatCount(1),
		},
		{
			Name:   "an anonymous caller frees no place",
			Before: aliceTookBobsCar,
			Method: http.MethodDelete,
			URL:    seatURL("Alice"),
			Status: http.StatusNotFound,
			After:  seatCount(1),
		},

		// Deleting an offer: the owner and the admins.
		{
			Name:   "alice does not delete the car of bob",
			Before: aliceTookBobsCar,
			As:     "alice",
			Method: http.MethodDelete,
			URL:    offersURL(true),
			Status: http.StatusNotFound,
			After:  all(offerIs(map[string]any{"place": carPlace}), seatCount(1)),
		},
		{
			Name:   "an anonymous caller deletes no offer of a runner without account",
			Before: offerOn(event, samRunner, "ride", 3),
			Method: http.MethodDelete,
			URL:    offersURL(true),
			Status: http.StatusNotFound,
			After:  offerIs(map[string]any{"place": carPlace}),
		},
		{
			Name:   "bob deletes his car, and the places go with it",
			Before: aliceTookBobsCar,
			As:     "bob",
			Method: http.MethodDelete,
			URL:    offersURL(true),
			Status: http.StatusNoContent,
			After:  noOfferNoSeat,
		},
		{
			Name:   "an admin deletes the car of a member",
			Before: aliceTookBobsCar,
			As:     "admin",
			Method: http.MethodDelete,
			URL:    offersURL(true),
			Status: http.StatusNoContent,
			After:  noOfferNoSeat,
		},

		// The event and the runners.
		{
			Name:   "the offers and their places go with their event",
			Before: aliceTookBobsCar,
			As:     "alice",
			Method: http.MethodDelete,
			URL:    eventURL(event),
			Status: http.StatusNoContent,
			After:  noOfferNoSeat,
		},
		{
			Name:   "the offers of another event stay",
			Before: all(offerOn(event2, bobRunner, "ride", 3), inTarget(aliceRunner)),
			As:     "alice",
			Method: http.MethodDelete,
			URL:    eventURL(event),
			Status: http.StatusNoContent,
			After:  all(offerIs(map[string]any{"event": event2}), seatCount(1)),
		},
		{
			Name:   "the place of a runner who is deleted goes with them",
			Before: zoeInBobsCar,
			As:     "admin",
			Method: http.MethodDelete,
			URL: func(testutil.Fixture) string {
				return "/api/collections/runners/records/" + zoe.Id
			},
			Status: http.StatusNoContent,
			After:  all(noSeat, offerIs(map[string]any{"owner": bobRunner})),
		},
	})
}

// An account that has no runner is a data error, but it must not let an offer
// through with nobody as its owner: the request is refused, whatever owner the
// body names.
func TestOffers_AccountWithoutRunner(t *testing.T) {
	testutil.RunRows(t, []testutil.Row{
		{
			Name: "a caller without a runner has no owner",
			Before: func(t testing.TB, app *tests.TestApp, fx testutil.Fixture) {
				t.Helper()
				// The runner of Admin is not deleted when it has an account (the
				// hooks of the accounts package refuse it): it loses the link.
				fx.AdminRunner.Set("user", "")
				if err := app.Save(fx.AdminRunner); err != nil {
					t.Fatal(err)
				}
			},
			As:       "admin",
			Method:   http.MethodPost,
			URL:      offersURL(false),
			Body:     body(`{"event":%q,"kind":"ride","owner":%q,"place":"Lyon","seats":3}`, id(event), id(bobRunner)),
			Status:   http.StatusBadRequest,
			Contains: []string{fieldError("owner", "validation_required")},
			After:    noOffer,
		},
	})
}

// The checks are model hooks: they also hold for what the code of the
// application writes, without a request. (The batch route is covered by rows
// of TestOffers.)
func TestOffers_ModelHooks(t *testing.T) {
	setup := func(t *testing.T) (*tests.TestApp, testutil.Fixture) {
		t.Helper()
		app := testutil.NewApp(t)
		return app, testutil.Seed(t, app)
	}
	collection := func(t *testing.T, app core.App, name string) *core.Collection {
		t.Helper()
		c, err := app.FindCollectionByNameOrId(name)
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	// refused saves the record and asserts that it is refused, with an error
	// that is about that field.
	refused := func(t *testing.T, app core.App, r *core.Record, field string) {
		t.Helper()
		err := app.Save(r)
		if err == nil || !strings.Contains(err.Error(), field) {
			t.Errorf("saving: error = %v, want one about %q", err, field)
		}
	}
	newOffer := func(t *testing.T, app core.App, fx testutil.Fixture, kind string) *core.Record {
		t.Helper()
		r := core.NewRecord(collection(t, app, "offers"))
		r.Set("event", fx.Event.Id)
		r.Set("kind", kind)
		r.Set("owner", fx.BobRunner.Id)
		r.Set("place", "Lyon")
		return r
	}

	t.Run("a car loses what only a lodging has, and a lodging the time", func(t *testing.T) {
		app, fx := setup(t)

		car := newOffer(t, app, fx, "ride")
		car.Set("seats", 3)
		car.Set("end_date", "2026-06-14")
		car.Set("url", "https://example.test/annonce")
		if err := app.Save(car); err != nil {
			t.Fatal(err)
		}
		gite := newOffer(t, app, fx, "lodging")
		gite.Set("owner", fx.AliceRunner.Id)
		gite.Set("time", "18:00")
		if err := app.Save(gite); err != nil {
			t.Fatal(err)
		}

		for _, c := range []struct {
			offer  *core.Record
			field  string
			stored string
		}{{car, "end_date", ""}, {car, "url", ""}, {gite, "time", ""}} {
			got, err := app.FindRecordById("offers", c.offer.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got.GetString(c.field) != c.stored {
				t.Errorf("%s = %q, want %q", c.field, got.GetString(c.field), c.stored)
			}
		}
	})

	t.Run("a car without seats is refused", func(t *testing.T) {
		app, fx := setup(t)
		refused(t, app, newOffer(t, app, fx, "ride"), "seats")
		if got := len(storedOffers(t, app)); got != 0 {
			t.Errorf("%d offers in the database, want none", got)
		}
	})

	t.Run("two cars of a runner for an event are refused", func(t *testing.T) {
		app, fx := setup(t)
		offer(t, app, fx.Event, fx.BobRunner, "ride", 3)

		second := newOffer(t, app, fx, "ride")
		second.Set("seats", 2)
		refused(t, app, second, "kind")
		if got := len(storedOffers(t, app)); got != 1 {
			t.Errorf("%d offers in the database, want 1", got)
		}
	})

	t.Run("a place in a full car is refused", func(t *testing.T) {
		app, fx := setup(t)
		car := offer(t, app, fx.Event, fx.BobRunner, "ride", 1)
		seat(t, app, car, fx.SamRunner)

		full := core.NewRecord(collection(t, app, "offer_members"))
		full.Set("offer", car.Id)
		full.Set("runner", fx.AliceRunner.Id)
		refused(t, app, full, "offer")
		if got := len(storedSeats(t, app)); got != 1 {
			t.Errorf("%d places in the database, want 1", got)
		}
	})

	t.Run("a place for the owner is refused", func(t *testing.T) {
		app, fx := setup(t)
		car := offer(t, app, fx.Event, fx.BobRunner, "ride", 3)

		own := core.NewRecord(collection(t, app, "offer_members"))
		own.Set("offer", car.Id)
		own.Set("runner", fx.BobRunner.Id)
		refused(t, app, own, "runner")
	})

	t.Run("a second place of a kind is refused", func(t *testing.T) {
		app, fx := setup(t)
		car := offer(t, app, fx.Event, fx.BobRunner, "ride", 3)
		other := offer(t, app, fx.Event, fx.AdminRunner, "ride", 3)
		seat(t, app, other, fx.AliceRunner)

		second := core.NewRecord(collection(t, app, "offer_members"))
		second.Set("offer", car.Id)
		second.Set("runner", fx.AliceRunner.Id)
		refused(t, app, second, "runner")
	})

	t.Run("the seats of an offer go down to its people at most, from Go too", func(t *testing.T) {
		app, fx := setup(t)
		car := offer(t, app, fx.Event, fx.BobRunner, "ride", 3)
		seat(t, app, car, fx.AliceRunner)
		seat(t, app, car, fx.SamRunner)

		car.Set("seats", 1)
		refused(t, app, car, "seats")
		car.Set("seats", 2)
		if err := app.Save(car); err != nil {
			t.Errorf("2 seats for 2 people: %v", err)
		}
	})
}

// An offer is never left without its owner: the relation has no cascade, so a
// runner who owns one cannot be deleted. (An account's runner is never deleted
// anyway, and a runner who is on a participation neither: this is the case of a
// runner without account, who has no participation.)
func TestOffers_OwnerIsNotDeleted(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	julie := newRunner(t, app, "Julie")
	car := offer(t, app, fx.Event, julie, "ride", 3)
	seat(t, app, car, fx.AliceRunner)

	if err := app.Delete(julie); err == nil {
		t.Error("deleting the owner of an offer: want an error")
	}
	if _, err := app.FindRecordById("runners", julie.Id); err != nil {
		t.Errorf("the owner is gone: %v", err)
	}
	if _, err := app.FindRecordById("offers", car.Id); err != nil {
		t.Errorf("the offer is gone: %v", err)
	}

	// Once the offer is gone, nothing holds the runner back.
	if err := app.Delete(car); err != nil {
		t.Fatal(err)
	}
	if err := app.Delete(julie); err != nil {
		t.Errorf("deleting a runner without offers: %v", err)
	}
}

// Whoever added a place is not what holds it: the runner who did can be deleted,
// and the place stays, added by nobody.
func TestOffers_TheOneWhoAddedAPlaceCanBeDeleted(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	julie := newRunner(t, app, "Julie")
	car := offer(t, app, fx.Event, fx.BobRunner, "ride", 3)
	place := save(t, app, "offer_members", map[string]any{
		"offer": car.Id, "runner": fx.SamRunner.Id, "added_by": julie.Id,
	})

	if err := app.Delete(julie); err != nil {
		t.Fatalf("deleting the runner who added a place: %v", err)
	}
	got, err := app.FindRecordById("offer_members", place.Id)
	if err != nil {
		t.Fatalf("the place went with the one who added it: %v", err)
	}
	if got.GetString("added_by") != "" {
		t.Errorf("added_by = %q, want it emptied", got.GetString("added_by"))
	}
}

// A superuser (the dashboard) goes through the same request hooks, and has no
// runner: the owner that it names does not count, and an offer needs one. The
// rules do not bind it, so the hooks are what keep the owner, the event and the
// kind of an offer, and what keep the place of a superuser from being added by a
// runner it names.
func TestOffers_Superuser(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	c, err := app.FindCollectionByNameOrId(core.CollectionNameSuperusers)
	if err != nil {
		t.Fatal(err)
	}
	superuser := core.NewRecord(c)
	superuser.SetEmail("root@example.test")
	superuser.SetPassword(testutil.Password)
	if err := app.Save(superuser); err != nil {
		t.Fatal(err)
	}
	headers := map[string]string{"Authorization": testutil.Token(t, superuser)}

	scenario := func(method, url, payload string, status int, contains string, after func(testing.TB, *tests.TestApp)) *tests.ApiScenario {
		return &tests.ApiScenario{
			Method:                method,
			URL:                   url,
			Body:                  strings.NewReader(payload),
			Headers:               headers,
			ExpectedStatus:        status,
			ExpectedContent:       []string{contains},
			TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
			DisableTestAppCleanup: true,
			AfterTestFunc: func(t testing.TB, app *tests.TestApp, _ *http.Response) {
				after(t, app)
			},
		}
	}

	scenario(http.MethodPost, "/api/collections/offers/records",
		fmt.Sprintf(`{"event":%q,"kind":"ride","owner":%q,"place":"Lyon","seats":3}`, fx.Event.Id, fx.BobRunner.Id),
		http.StatusBadRequest, fieldError("owner", "validation_required"),
		func(t testing.TB, app *tests.TestApp) {
			if got := len(storedOffers(t, app)); got != 0 {
				t.Errorf("%d offers in the database, want none", got)
			}
		}).Test(t)

	car := offer(t, app, fx.Event, fx.BobRunner, "ride", 3)
	scenario(http.MethodPatch, "/api/collections/offers/records/"+car.Id,
		fmt.Sprintf(`{"event":%q,"owner":%q,"kind":"lodging","place":"y"}`, fx.Event2.Id, fx.AliceRunner.Id),
		http.StatusOK, `"place":"y"`,
		func(t testing.TB, app *tests.TestApp) {
			got, err := app.FindRecordById("offers", car.Id)
			if err != nil {
				t.Fatal(err)
			}
			if got.GetString("event") != fx.Event.Id || got.GetString("owner") != fx.BobRunner.Id ||
				got.GetString("kind") != "ride" || got.GetString("place") != "y" {
				t.Errorf("after the update: event %q, owner %q, kind %q, place %q; want Event, Bob, ride and %q",
					got.GetString("event"), got.GetString("owner"), got.GetString("kind"), got.GetString("place"), "y")
			}
		}).Test(t)

	scenario(http.MethodPost, "/api/collections/offer_members/records",
		fmt.Sprintf(`{"offer":%q,"runner":%q,"added_by":%q}`, car.Id, fx.SamRunner.Id, fx.BobRunner.Id),
		http.StatusOK, `"runner":"`+fx.SamRunner.Id+`"`,
		func(t testing.TB, app *tests.TestApp) {
			seats := storedSeats(t, app)
			if len(seats) != 1 {
				t.Fatalf("%d places in the database, want 1", len(seats))
			}
			if got := seats[0].GetString("added_by"); got != "" {
				t.Errorf("added_by = %q, want nobody: a superuser has no runner", got)
			}
		}).Test(t)
}
