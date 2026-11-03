package mcp_test

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/mcp"
	"courses/server/testutil"
)

// rideOf makes a ride that owner offers for an event, in the database: from Lyon,
// 3 places, on the day of the event.
func rideOf(t testing.TB, app core.App, event, owner *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "offers", map[string]any{
		"event": event.Id, "kind": "ride", "owner": owner.Id, "place": "Lyon", "seats": 3,
		"date": event.GetString("start_date"), "time": "06:30", "notes": "Départ devant la gare.",
	})
}

// lodgingOf makes a lodging that owner offers for an event, in the database: a
// gîte with no limit, from the day of the event to the next.
func lodgingOf(t testing.TB, app core.App, event, owner *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "offers", map[string]any{
		"event": event.Id, "kind": "lodging", "owner": owner.Id, "place": "Gîte des Lacs", "seats": 4,
		"date": event.GetString("start_date"), "end_date": "2026-09-06", "url": "https://example.org/gite", "notes": "Draps fournis.",
	})
}

// seatFor gives a runner a place in an offer, in the database.
func seatFor(t testing.TB, app core.App, offer, runner, addedBy *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "offer_members", map[string]any{"offer": offer.Id, "runner": runner.Id, "added_by": addedBy.Id})
}

// seatsOf are the places taken in an offer, as the database has them.
func seatsOf(t testing.TB, app core.App, offer *core.Record) []*core.Record {
	t.Helper()
	found, err := app.FindAllRecords("offer_members", dbx.HashExp{"offer": offer.Id})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// seatOf is the place of a runner in an offer; nil for none.
func seatOf(t testing.TB, app core.App, offer, runner *core.Record) *core.Record {
	t.Helper()
	for _, seat := range seatsOf(t, app, offer) {
		if seat.GetString("runner") == runner.Id {
			return seat
		}
	}
	return nil
}

// offerIn is the offer of an answer.
func offerIn(t testing.TB, result toolResult, key string) map[string]any {
	t.Helper()
	return participationIn(t, result, key)
}

// membersOf are the names of the people who have a place in the offer of an
// answer, in their order.
func membersOf(t testing.TB, offer map[string]any) []string {
	t.Helper()
	var names []string
	list, _ := offer["members"].([]any)
	for _, m := range list {
		runner, _ := m.(map[string]any)["runner"].(map[string]any)
		names = append(names, runner["name"].(string))
	}
	return names
}

// What an offer says, and what is left to the site: the seats of a car, the days,
// the time, and one offer of each kind for a runner.
func TestTools_AddOffer(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)
	// Each case has a race of its own: a runner has one offer of a kind per race.
	races := 0
	race := func() *core.Record {
		races++
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Foulées de "+strings.Repeat("x", races), "2026-09-05")
		return event
	}

	t.Run("Alice offers a ride: written at once, the owner is Alice, the day is the start of the race", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, alice, "add_offer", map[string]any{
			"event_id": fx.Event.Id, "kind": "ride", "place": "Lyon", "seats": 3, "time": "06:30", "notes": "Départ devant la gare.",
		}))
		if got := counted.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want one", got)
		}
		if got := counted.Total() - counted.Of(http.MethodGet) - counted.Of(http.MethodPost); got != 0 {
			t.Errorf("%d other writes, want none", got)
		}
		offer := offerIn(t, result, "offer")
		assertJSON(t, offer["owner"], runnerRef(fx.AliceRunner))
		if offer["kind"] != "ride" || offer["place"] != "Lyon" || offer["seats"] != float64(3) || offer["taken"] != float64(0) ||
			offer["date"] != "2026-06-13" || offer["time"] != "06:30" || offer["notes"] != "Départ devant la gare." {
			t.Errorf("the offer is %v", offer)
		}
		if got := membersOf(t, offer); len(got) != 0 {
			t.Errorf("the members are %v, want none", got)
		}
		assertJSON(t, result.Structured["event"], map[string]any{"id": fx.Event.Id, "name": "Trail des Crêtes", "url": siteURL + "/evenements/" + fx.Event.Id})
		if _, warned := result.Structured["warnings"]; warned {
			t.Errorf("a ride with what a ride has is warned about: %v", result.Structured["warnings"])
		}
		noSecret(t, result, fx.Alice, fx.Bob)

		stored := storedRecord(t, app, "offers", offer["id"].(string))
		if stored == nil || stored.GetString("owner") != fx.AliceRunner.Id || stored.GetString("event") != fx.Event.Id || stored.GetString("date") != "2026-06-13" ||
			stored.GetInt("seats") != 3 || stored.GetString("time") != "06:30" {
			t.Errorf("the stored offer is %v", stored)
		}
	})

	t.Run("a day given is kept", func(t *testing.T) {
		result := isDone(t, callTool(t, app, bob, "add_offer", map[string]any{
			"event_id": fx.Event.Id, "kind": "ride", "place": "Grenoble", "seats": 2, "date": "2026-06-12",
		}))
		if got := offerIn(t, result, "offer")["date"]; got != "2026-06-12" {
			t.Errorf("the day is %v", got)
		}
	})

	t.Run("a ride without seats, or with nine: the site's words", func(t *testing.T) {
		event := race()
		for _, args := range []map[string]any{
			{"event_id": event.Id, "kind": "ride", "place": "Lyon"},
			{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 9},
		} {
			refused(t, app, bob, "add_offer", args, "places : indique le nombre de places, de 1 à 8. (offer_seats_required)")
		}
	})

	t.Run("a second ride for Alice in the race: refused", func(t *testing.T) {
		event := race()
		isDone(t, callTool(t, app, alice, "add_offer", map[string]any{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 3}))
		refused(t, app, alice, "add_offer", map[string]any{"event_id": event.Id, "kind": "ride", "place": "Paris", "seats": 2},
			"sorte : cette personne a déjà une place de cette sorte pour cet événement. (offer_already_member)")
		// A lodging is another kind.
		isDone(t, callTool(t, app, alice, "add_offer", map[string]any{"event_id": event.Id, "kind": "lodging", "place": "Gîte"}))
	})

	t.Run("a ride for somebody who has a place in another ride: refused", func(t *testing.T) {
		event := race()
		seatFor(t, app, rideOf(t, app, event, fx.AdminRunner), fx.BobRunner, fx.AdminRunner)
		refused(t, app, bob, "add_offer", map[string]any{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 3},
			"sorte : cette personne a déjà une place de cette sorte pour cet événement. (offer_already_member)")
	})

	t.Run("a lodging with a time: the site keeps no time, and the answer says so", func(t *testing.T) {
		event := race()
		result := isDone(t, callTool(t, app, bob, "add_offer", map[string]any{
			"event_id": event.Id, "kind": "lodging", "place": "Gîte des Lacs", "seats": 4, "time": "08:30",
			"date": "2026-09-05", "end_date": "2026-09-07", "url": "https://example.org/gite",
		}))
		offer := offerIn(t, result, "offer")
		if _, has := offer["time"]; has {
			t.Errorf("the offer has a time: %v", offer)
		}
		if offer["kind"] != "lodging" || offer["end_date"] != "2026-09-07" || offer["url"] != "https://example.org/gite" || offer["seats"] != float64(4) {
			t.Errorf("the offer is %v", offer)
		}
		warnings, _ := result.Structured["warnings"].([]any)
		if len(warnings) != 1 || !strings.Contains(warnings[0].(string), "un logement") || !strings.Contains(warnings[0].(string), "l'heure (time)") {
			t.Errorf("the warnings are %v, want one that says that the time of a lodging is not kept", warnings)
		}
		if got := storedRecord(t, app, "offers", offer["id"].(string)).GetString("time"); got != "" {
			t.Errorf("the stored time is %q", got)
		}
	})

	t.Run("a ride with a day of departure and a link: the site keeps neither, and the answer says so", func(t *testing.T) {
		event := race()
		result := isDone(t, callTool(t, app, bob, "add_offer", map[string]any{
			"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 2, "end_date": "2026-09-07", "url": "https://example.org/x",
		}))
		offer := offerIn(t, result, "offer")
		if _, has := offer["end_date"]; has {
			t.Errorf("the offer has an end date: %v", offer)
		}
		warnings, _ := result.Structured["warnings"].([]any)
		if len(warnings) != 1 || !strings.Contains(warnings[0].(string), "une voiture") ||
			!strings.Contains(warnings[0].(string), "le jour de départ (end_date)") || !strings.Contains(warnings[0].(string), "le lien (url)") {
			t.Errorf("the warnings are %v", warnings)
		}
	})

	t.Run("a lodging with no seats has no limit", func(t *testing.T) {
		event := race()
		result := isDone(t, callTool(t, app, bob, "add_offer", map[string]any{"event_id": event.Id, "kind": "lodging", "place": "Chez Marie, 3 rue des Lacs"}))
		offer := offerIn(t, result, "offer")
		if _, has := offer["seats"]; has {
			t.Errorf("the offer has seats: %v", offer)
		}
		if offer["date"] != "2026-09-05" {
			t.Errorf("the day is %v, want the start of the race", offer["date"])
		}
	})

	t.Run("the site's refusals: the end before the start, the time, the day, the link, the length", func(t *testing.T) {
		event := race()
		base := func(extra map[string]any) map[string]any {
			args := map[string]any{"event_id": event.Id, "kind": "lodging", "place": "Gîte"}
			for k, v := range extra {
				args[k] = v
			}
			return args
		}
		// The fields are named as the form of an offer of that kind names them: an
		// offer has no « date de l'épreuve ».
		refused(t, app, bob, "add_offer", base(map[string]any{"date": "2026-09-06", "end_date": "2026-09-05"}),
			"jour du départ : la date de fin est avant la date de début. (end_before_start)")
		refused(t, app, bob, "add_offer", map[string]any{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 2, "time": "7h"},
			"heure de départ : l'heure doit être de la forme 06:30. (time_invalid)")
		refused(t, app, bob, "add_offer", base(map[string]any{"date": "2026-13-45"}), "jour d'arrivée : cette date n'est pas valide. (date_invalid)")
		refused(t, app, bob, "add_offer", map[string]any{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 2, "date": "2026-13-45"},
			"jour du départ : cette date n'est pas valide. (date_invalid)")
		refused(t, app, bob, "add_offer", base(map[string]any{"url": "pas une adresse"}),
			"lien de l'annonce : cette adresse web n'est pas valide. (validation_invalid_url)")
		refused(t, app, bob, "add_offer", base(map[string]any{"notes": strings.Repeat("n", 1001)}),
			"notes : ce texte est trop long. (validation_max_text_constraint)")
		refused(t, app, bob, "add_offer", base(map[string]any{"place": "  "}), "lieu : ce champ est obligatoire. (validation_required)")
		// The site's most for a lodging, said in words.
		refused(t, app, bob, "add_offer", base(map[string]any{"seats": 31}), "places : 30 au plus. (validation_max_number_constraint)")
		for _, kind := range []string{"ride", "lodging"} {
			result := callTool(t, app, bob, "add_offer", map[string]any{"event_id": event.Id, "kind": kind, "place": "Lyon", "seats": 2, "date": "2026-13-45"})
			if strings.Contains(result.Text, "épreuve") {
				t.Errorf("the refusal of the day of a %s speaks of a race: %q", kind, result.Text)
			}
		}
	})

	t.Run("a race that is not there, or that is not an id", func(t *testing.T) {
		announced(t, app, bob, "add_offer", map[string]any{"event_id": "aaaaaaaaaaaaaaa", "kind": "ride", "place": "Lyon", "seats": 2}, "Introuvable : il a peut-être été supprimé.")
		announced(t, app, bob, "add_offer", map[string]any{"event_id": "nope", "kind": "ride", "place": "Lyon", "seats": 2}, "n'est pas un identifiant de course")
	})
}

// The people of an offer: who may take a place for whom, what the site refuses
// (full, the owner, one place of a kind), and the confirmation that freeing a
// place asks.
func TestTools_OfferPlace(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)
	races := 0
	// aRide is a ride of Alice in a race of its own, with no passenger.
	aRide := func() (*core.Record, *core.Record) {
		races++
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course de covoiturage "+strings.Repeat("x", races), "2026-09-05")
		return event, rideOf(t, app, event, fx.AliceRunner)
	}

	t.Run("Bob takes a place: written at once, and the answer counts the places", func(t *testing.T) {
		event, ride := aRide()
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take"}))
		if got := counted.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want one", got)
		}
		if got := counted.Total() - counted.Of(http.MethodGet) - counted.Of(http.MethodPost); got != 0 {
			t.Errorf("%d other writes, want none", got)
		}
		offer := offerIn(t, result, "offer")
		if offer["id"] != ride.Id || offer["taken"] != float64(1) || offer["seats"] != float64(3) {
			t.Errorf("the offer is %v", offer)
		}
		members, _ := offer["members"].([]any)
		if len(members) != 1 {
			t.Fatalf("the members are %v", members)
		}
		member := members[0].(map[string]any)
		assertJSON(t, member["runner"], runnerRef(fx.BobRunner))
		assertJSON(t, member["added_by"], runnerRef(fx.BobRunner))
		if member["place_id"] == "" {
			t.Errorf("the member has no place id: %v", member)
		}
		assertJSON(t, offer["owner"], runnerRef(fx.AliceRunner))
		assertJSON(t, result.Structured["event"], map[string]any{"id": event.Id, "name": event.GetString("name"), "url": siteURL + "/evenements/" + event.Id})
		if want := "1 place prise sur 3"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		if !strings.Contains(summaryOfResult(result), "Bob") {
			t.Errorf("the summary does not name Bob: %q", summaryOfResult(result))
		}
		noSecret(t, result, fx.Alice, fx.Bob)
		seat := seatOf(t, app, ride, fx.BobRunner)
		if seat == nil || seat.GetString("added_by") != fx.BobRunner.Id {
			t.Errorf("the stored place is %v", seat)
		}
	})

	t.Run("Bob places Sam in the ride of Alice: refused, and announced", func(t *testing.T) {
		_, ride := aRide()
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take", "runner": "Sam"},
			"Seule la personne qui propose cette offre, Alice, ou un admin peut y placer quelqu'un d'autre.")
		if got := len(seatsOf(t, app, ride)); got != 0 {
			t.Errorf("%d places taken", got)
		}
	})

	// A runner who has an account, and is neither the caller nor the owner: the
	// refusal is announced, for taking a place as for freeing one.
	t.Run("Bob places Alice in the ride of the admin, or frees her place there: refused, and announced", func(t *testing.T) {
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course de covoiturage de l'admin", "2026-09-05")
		ride := rideOf(t, app, event, fx.AdminRunner)
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take", "runner": "Alice"},
			"Seule la personne qui propose cette offre, Admin, ou un admin peut y placer quelqu'un d'autre.")
		seatFor(t, app, ride, fx.AliceRunner, fx.AdminRunner)
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": "Alice"},
			"Seule la personne qui propose cette offre, Admin, ou un admin peut en retirer quelqu'un d'autre.")
		if seatOf(t, app, ride, fx.AliceRunner) == nil {
			t.Error("Alice lost her place")
		}
	})

	t.Run("Alice places Sam, and the admin places anybody: written, added by the one who placed", func(t *testing.T) {
		_, ride := aRide()
		result := isDone(t, callTool(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take", "runner": "Sam"}))
		seat := seatOf(t, app, ride, fx.SamRunner)
		if seat == nil || seat.GetString("added_by") != fx.AliceRunner.Id {
			t.Errorf("the stored place is %v", seat)
		}
		if got := membersOf(t, offerIn(t, result, "offer")); len(got) != 1 || got[0] != "Sam" {
			t.Errorf("the members are %v", got)
		}
		isDone(t, callTool(t, app, admin, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take", "runner": fx.BobRunner.Id}))
		if seat := seatOf(t, app, ride, fx.BobRunner); seat == nil || seat.GetString("added_by") != fx.AdminRunner.Id {
			t.Errorf("the stored place is %v", seat)
		}
	})

	t.Run("the ride is full: the site's words", func(t *testing.T) {
		races++
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course pleine "+strings.Repeat("x", races), "2026-09-05")
		ride := create(t, app, "offers", map[string]any{"event": event.Id, "kind": "ride", "owner": fx.AliceRunner.Id, "place": "Lyon", "seats": 2, "date": "2026-09-05"})
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		refused(t, app, admin, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take"}, "offre : il n'y a plus de place. (offer_full)")
	})

	t.Run("Alice takes a place in her own ride: the site's words", func(t *testing.T) {
		_, ride := aRide()
		refused(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take"}, "coureur : tu proposes déjà ces places. (offer_owner_member)")
	})

	t.Run("a place in a second ride of the race: the site's words", func(t *testing.T) {
		event, ride := aRide()
		other := rideOf(t, app, event, fx.AdminRunner)
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		refused(t, app, bob, "offer_place", map[string]any{"offer_id": other.Id, "action": "take"},
			"coureur : cette personne a déjà une place de cette sorte pour cet événement. (offer_already_member)")
	})

	t.Run("a place that the runner has already: announced, with nothing written", func(t *testing.T) {
		_, ride := aRide()
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take"}, "Bob a déjà une place dans cette offre")
	})

	t.Run("a lodging with no limit counts people, not places", func(t *testing.T) {
		races++
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course au logement "+strings.Repeat("x", races), "2026-09-05")
		lodging := create(t, app, "offers", map[string]any{"event": event.Id, "kind": "lodging", "owner": fx.AliceRunner.Id, "place": "Chez Marie", "date": "2026-09-05"})
		isDone(t, callTool(t, app, bob, "offer_place", map[string]any{"offer_id": lodging.Id, "action": "take"}))
		result := isDone(t, callTool(t, app, alice, "offer_place", map[string]any{"offer_id": lodging.Id, "action": "take", "runner": "Sam"}))
		if want := "2 personnes, places non précisées"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
	})

	t.Run("freeing: Bob frees his place, after a confirmation that names him and the ride", func(t *testing.T) {
		event, ride := aRide()
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		args := map[string]any{"offer_id": ride.Id, "action": "free"}

		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, bob, "offer_place", args))
			mentions(t, message, details, "Bob", "perdrait sa place", "la voiture d'Alice (départ de « Lyon »)", "« "+event.GetString("name")+" »")
			if all := message + strings.Join(details, ""); strings.Contains(all, "Sam") {
				t.Errorf("the confirmation names Sam, who keeps his place: %s", all)
			}
		})
		if seatOf(t, app, ride, fx.BobRunner) == nil {
			t.Fatal("the place is gone before the confirmation")
		}
		result := confirmAndCall(t, app, bob, "offer_place", args)
		if seatOf(t, app, ride, fx.BobRunner) != nil {
			t.Error("the place is still there")
		}
		if seatOf(t, app, ride, fx.SamRunner) == nil {
			t.Error("the place of Sam went with it")
		}
		offer := offerIn(t, result, "offer")
		if got := membersOf(t, offer); len(got) != 1 || got[0] != "Sam" || offer["taken"] != float64(1) {
			t.Errorf("the offer is %v", offer)
		}
		if want := "1 place prise sur 3"; !strings.Contains(summaryOfResult(result), want) || !strings.Contains(summaryOfResult(result), "Bob") {
			t.Errorf("the summary is %q, want it to name Bob and say %q", summaryOfResult(result), want)
		}
	})

	t.Run("freeing: the owner frees the place of Sam, and the admin that of anybody", func(t *testing.T) {
		_, ride := aRide()
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": "Sam"}))
			mentions(t, message, details, "Sam", "perdrait sa place", "ajoutée par Alice")
		})
		confirmAndCall(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": "Sam"})
		confirmAndCall(t, app, admin, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": fx.BobRunner.Id})
		if got := len(seatsOf(t, app, ride)); got != 0 {
			t.Errorf("%d places left", got)
		}
	})

	t.Run("freeing: Bob does not free the place of Sam: announced, whoever else is in", func(t *testing.T) {
		_, ride := aRide()
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": "Sam"},
			"Seule la personne qui propose cette offre, Alice, ou un admin peut en retirer quelqu'un d'autre.")
	})

	t.Run("freeing a place that nobody has: announced", func(t *testing.T) {
		_, ride := aRide()
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free"}, "Bob n'a pas de place dans cette offre.")
		announced(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "free", "runner": "Sam"}, "Sam n'a pas de place dans cette offre.")
	})

	t.Run("an offer that is not there, a runner that is not one, an id that is not one", func(t *testing.T) {
		_, ride := aRide()
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": "aaaaaaaaaaaaaaa", "action": "take"}, "Introuvable : il a peut-être été supprimé.")
		announced(t, app, bob, "offer_place", map[string]any{"offer_id": "nope", "action": "take"}, "n'est pas un identifiant d'offre")
		announced(t, app, alice, "offer_place", map[string]any{"offer_id": ride.Id, "action": "take", "runner": "Personne"}, "Coureur inconnu : « Personne ».")
	})
}

// Changing an offer: the owner and the admins; what is announced, what is
// written, and what the person is asked about first.
func TestTools_UpdateOffer(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)
	races := 0
	race := func() *core.Record {
		races++
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course des offres "+strings.Repeat("x", races), "2026-09-05")
		return event
	}

	t.Run("the owner changes a value into another: written at once, with one PATCH", func(t *testing.T) {
		event := race()
		ride := rideOf(t, app, event, fx.AliceRunner)
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "place": "Villeurbanne", "seats": 4, "time": "07:00"}))
		if got := counted.Of(http.MethodPatch); got != 1 {
			t.Errorf("%d PATCH, want one", got)
		}
		offer := offerIn(t, result, "offer")
		if offer["place"] != "Villeurbanne" || offer["seats"] != float64(4) || offer["time"] != "07:00" || offer["taken"] != float64(1) {
			t.Errorf("the offer is %v", offer)
		}
		if got := membersOf(t, offer); len(got) != 1 || got[0] != "Bob" {
			t.Errorf("the members are %v, want the offer with its passengers", got)
		}
		assertJSON(t, offer["owner"], runnerRef(fx.AliceRunner))
		assertJSON(t, result.Structured["event"], map[string]any{"id": event.Id, "name": event.GetString("name"), "url": siteURL + "/evenements/" + event.Id})
		stored := storedRecord(t, app, "offers", ride.Id)
		if stored.GetString("place") != "Villeurbanne" || stored.GetInt("seats") != 4 || stored.GetString("owner") != fx.AliceRunner.Id ||
			stored.GetString("kind") != "ride" || stored.GetString("event") != event.Id || stored.GetString("date") != "2026-09-05" {
			t.Errorf("the stored offer is %v", stored)
		}
		for _, name := range []string{"le lieu", "les places", "l'heure de départ"} {
			if !strings.Contains(summaryOfResult(result), name) {
				t.Errorf("the summary does not say that %s changed: %q", name, summaryOfResult(result))
			}
		}
		if strings.Contains(summaryOfResult(result), "notes") {
			t.Errorf("the summary says that the notes changed: %q", summaryOfResult(result))
		}
		if got := stored.GetString("notes"); got != "Départ devant la gare." {
			t.Errorf("the notes are %q, want them as they were", got)
		}
	})

	t.Run("notes where there were none, and a day: written at once", func(t *testing.T) {
		event := race()
		ride := create(t, app, "offers", map[string]any{"event": event.Id, "kind": "ride", "owner": fx.AliceRunner.Id, "place": "Lyon", "seats": 3})
		isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "notes": "Pas de fumeurs.", "date": "2026-09-04"}))
		if stored := storedRecord(t, app, "offers", ride.Id); stored.GetString("notes") != "Pas de fumeurs." || stored.GetString("date") != "2026-09-04" {
			t.Errorf("the stored offer is %v", stored)
		}
	})

	t.Run("nothing changes: nothing is written, and it is said", func(t *testing.T) {
		ride := rideOf(t, app, race(), fx.AliceRunner)
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "place": " Lyon ", "seats": 3, "notes": "Départ devant la gare."}))
			if !strings.Contains(summaryOfResult(result), "Rien à changer") {
				t.Errorf("the summary is %q", summaryOfResult(result))
			}
			if offerIn(t, result, "offer")["place"] != "Lyon" {
				t.Errorf("the offer is %v", result.Structured["offer"])
			}
		})
		writesNothing(t, app, func() {
			isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id}))
		})
		// The admin, on the offer of somebody else, with nothing to change: nothing to confirm either.
		writesNothing(t, app, func() {
			isDone(t, callTool(t, app, admin, "update_offer", map[string]any{"offer_id": ride.Id, "seats": 3}))
		})
	})

	t.Run("Bob does not change the offer of Alice: announced", func(t *testing.T) {
		ride := rideOf(t, app, race(), fx.AliceRunner)
		announced(t, app, bob, "update_offer", map[string]any{"offer_id": ride.Id, "place": "Paris"},
			"Seule la personne qui propose cette offre, Alice, ou un admin peut la modifier.")
	})

	t.Run("the seats go below the passengers: the site's words, nothing written", func(t *testing.T) {
		ride := rideOf(t, app, race(), fx.AliceRunner)
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "seats": 1}, "places : plus de personnes ont déjà une place. (offer_seats_below_members)")
		// A ride cannot be left with no seats: the site says so, with no confirmation first.
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "seats": 0}, "(offer_seats_required)")
	})

	t.Run("the end before the start, a link that is not one: the site's words", func(t *testing.T) {
		lodging := lodgingOf(t, app, race(), fx.AliceRunner)
		// The fields are named as the form of an offer names them.
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "end_date": "2026-09-04"}, "jour du départ : la date de fin est avant la date de début. (end_before_start)")
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "date": "2026-13-45"}, "jour d'arrivée : cette date n'est pas valide. (date_invalid)")
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "url": "nope"}, "lien de l'annonce : cette adresse web n'est pas valide. (validation_invalid_url)")
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "seats": 31}, "places : 30 au plus. (validation_max_number_constraint)")
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "place": ""}, "lieu : ce champ est obligatoire. (validation_required)")
		ride := rideOf(t, app, race(), fx.AliceRunner)
		refused(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "date": "2026-13-45"}, "jour du départ : cette date n'est pas valide. (date_invalid)")
	})

	// What the form refuses is refused before anything is asked, even with a field
	// that would ask for a confirmation: the place cleared, a car without seats.
	t.Run("a required field cleared with a risky one: refused at once, nothing asked", func(t *testing.T) {
		ride := rideOf(t, app, race(), fx.AliceRunner)
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "place": "", "notes": ""}, "lieu : ce champ est obligatoire. (validation_required)")
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "seats": 0, "time": ""}, "places : indique le nombre de places, de 1 à 8. (offer_seats_required)")
		lodging := lodgingOf(t, app, race(), fx.AliceRunner)
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "place": " ", "url": ""}, "lieu : ce champ est obligatoire. (validation_required)")
	})

	// What a kind of offer does not have is not kept by the site: it is no change,
	// and the answer says that it was left out.
	t.Run("a field that the kind does not have: nothing to change, and said", func(t *testing.T) {
		lodging := lodgingOf(t, app, race(), fx.AliceRunner)
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "time": "07:00"}))
			if got := summaryOfResult(result); got != "Rien à changer : le logement d'Alice (« Gîte des Lacs ») est déjà ainsi." {
				t.Errorf("the summary is %q", got)
			}
			assertJSON(t, result.Structured["warnings"], []string{"Pour un logement, le site ne garde pas : l'heure (time)."})
		})
		ride := rideOf(t, app, race(), fx.AliceRunner)
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "end_date": "2026-09-07", "url": "https://example.org"}))
			assertJSON(t, result.Structured["warnings"], []string{"Pour une voiture, le site ne garde pas : le jour de départ (end_date), le lien (url)."})
		})
		// With a change besides: written, and the field left out is said.
		result := isDone(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "time": "07:00", "seats": 5}))
		if got := summaryOfResult(result); got != "Offre modifiée : le logement d'Alice (« Gîte des Lacs »), pour « "+storedRecord(t, app, "events", lodging.GetString("event")).GetString("name")+" » (les places)." {
			t.Errorf("the summary is %q", got)
		}
		assertJSON(t, result.Structured["warnings"], []string{"Pour un logement, le site ne garde pas : l'heure (time)."})
		if got := storedRecord(t, app, "offers", lodging.Id).GetInt("seats"); got != 5 {
			t.Errorf("the seats are %d, want 5", got)
		}
	})

	// The message of a confirmation is a sentence to show the person, for a car
	// and for a lodging.
	t.Run("the message of a confirmation, whole", func(t *testing.T) {
		event := race()
		name := event.GetString("name")
		ride := rideOf(t, app, event, fx.AliceRunner)
		token, message, _ := asked(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": ride.Id, "notes": ""}))
		if want := "Rien n'a été fait. Modifier la voiture d'Alice (départ de « Lyon »), pour « " + name + " », touche ce qu'une personne a saisi : " +
			"Les notes seraient effacées (actuellement : « Départ devant la gare. »). Demande son accord à la personne ; si elle accepte, " +
			`rappelle update_offer avec les mêmes arguments et confirmation: "` + token + `" (valable 10 minutes, une seule fois).`; message != want {
			t.Errorf("the message is\n%s\nwant\n%s", redact(message), redact(want))
		}

		lodging := lodgingOf(t, app, event, fx.BobRunner)
		token, message, _ = asked(t, callTool(t, app, admin, "update_offer", map[string]any{"offer_id": lodging.Id, "place": "Chalet"}))
		if want := "Rien n'a été fait. Modifier le logement de Bob (« Gîte des Lacs »), pour « " + name + " », touche ce qu'une personne a saisi : " +
			"C'est l'offre d'un autre coureur : Bob. Demande son accord à la personne ; si elle accepte, " +
			`rappelle update_offer avec les mêmes arguments et confirmation: "` + token + `" (valable 10 minutes, une seule fois).`; message != want {
			t.Errorf("the message is\n%s\nwant\n%s", redact(message), redact(want))
		}
	})

	t.Run("notes that close their quotation: they stay quoted", func(t *testing.T) {
		lodging := create(t, app, "offers", map[string]any{"event": race().Id, "kind": "lodging", "owner": fx.AliceRunner.Id, "place": "Gîte « du » lac", "notes": "Draps » fournis"})
		_, message, details := asked(t, callTool(t, app, alice, "update_offer", map[string]any{"offer_id": lodging.Id, "notes": ""}))
		mentions(t, message, details, "le logement d'Alice (« Gîte ‹ du › lac »)", "Les notes seraient effacées (actuellement : « Draps › fournis »).")
		// The place of a car is not quoted: its marks are made single all the same.
		ride := create(t, app, "offers", map[string]any{"event": race().Id, "kind": "ride", "owner": fx.AliceRunner.Id, "place": "Lyon » gare", "seats": 2})
		_, message, details = asked(t, callTool(t, app, alice, "delete_offer", map[string]any{"offer_id": ride.Id}))
		mentions(t, message, details, "la voiture d'Alice (départ de « Lyon › gare »)")
	})

	t.Run("a filled field cleared: a confirmation that names it, then it is cleared", func(t *testing.T) {
		for _, row := range []struct {
			name   string
			kind   string
			args   map[string]any
			want   []string
			stored string
		}{
			{"the notes of a ride", "ride", map[string]any{"notes": ""}, []string{"Les notes seraient effacées", "Départ devant la gare."}, "notes"},
			{"the time of a ride", "ride", map[string]any{"time": ""}, []string{"L'heure de départ serait effacée", "06:30"}, "time"},
			{"the day of a ride", "ride", map[string]any{"date": ""}, []string{"Le jour du départ serait effacé", "2026-09-05"}, "date"},
			{"the day of arrival of a lodging", "lodging", map[string]any{"date": ""}, []string{"Le jour d'arrivée serait effacé", "2026-09-05"}, "date"},
			{"the link of a lodging", "lodging", map[string]any{"url": ""}, []string{"Le lien de l'annonce serait effacé", "https://example.org/gite"}, "url"},
			{"the day of departure of a lodging", "lodging", map[string]any{"end_date": ""}, []string{"Le jour du départ serait effacé", "2026-09-06"}, "end_date"},
			{"the seats of a lodging: it has no limit any more", "lodging", map[string]any{"seats": 0}, []string{"Les places seraient effacées", "4", "sans limite"}, "seats"},
		} {
			t.Run(row.name, func(t *testing.T) {
				event := race()
				offer := rideOf(t, app, event, fx.AliceRunner)
				if row.kind == "lodging" {
					offer = lodgingOf(t, app, event, fx.AliceRunner)
				}
				args := map[string]any{"offer_id": offer.Id}
				for k, v := range row.args {
					args[k] = v
				}
				writesNothing(t, app, func() {
					_, message, details := asked(t, callTool(t, app, alice, "update_offer", args))
					mentions(t, message, details, row.want...)
				})
				confirmAndCall(t, app, alice, "update_offer", args)
				got := storedRecord(t, app, "offers", offer.Id)
				if row.stored == "seats" {
					if got.GetInt("seats") != 0 {
						t.Errorf("the seats are %d, want 0", got.GetInt("seats"))
					}
				} else if got.GetString(row.stored) != "" {
					t.Errorf("the %s is %q, want it cleared", row.stored, got.GetString(row.stored))
				}
			})
		}
	})

	t.Run("notes replaced: a confirmation that gives the notes it replaces", func(t *testing.T) {
		ride := rideOf(t, app, race(), fx.AliceRunner)
		args := map[string]any{"offer_id": ride.Id, "notes": "Rendez-vous au parking."}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_offer", args))
			mentions(t, message, details, "Les notes seraient remplacées", "Départ devant la gare.")
		})
		confirmAndCall(t, app, alice, "update_offer", args)
		if got := storedRecord(t, app, "offers", ride.Id).GetString("notes"); got != "Rendez-vous au parking." {
			t.Errorf("the notes are %q", got)
		}
	})

	t.Run("the admin changes the offer of Alice: a confirmation that names her, then it is written", func(t *testing.T) {
		event := race()
		ride := rideOf(t, app, event, fx.AliceRunner)
		args := map[string]any{"offer_id": ride.Id, "place": "Villeurbanne"}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, admin, "update_offer", args))
			mentions(t, message, details, "d'un autre coureur", "la voiture d'Alice (départ de « Lyon »)")
		})
		result := confirmAndCall(t, app, admin, "update_offer", args)
		if got := storedRecord(t, app, "offers", ride.Id); got.GetString("place") != "Villeurbanne" || got.GetString("owner") != fx.AliceRunner.Id {
			t.Errorf("the stored offer is %v", got)
		}
		assertJSON(t, offerIn(t, result, "offer")["owner"], runnerRef(fx.AliceRunner))
	})

	t.Run("an offer that is not there, or not an id", func(t *testing.T) {
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": "aaaaaaaaaaaaaaa", "place": "x"}, "Introuvable : il a peut-être été supprimé.")
		announced(t, app, alice, "update_offer", map[string]any{"offer_id": "nope", "place": "x"}, "n'est pas un identifiant d'offre")
	})
}

// Deleting an offer: always asked, and the people who lose their place are named.
func TestTools_DeleteOffer(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)

	t.Run("Alice deletes her ride: a confirmation that names Bob and Sam, then it is gone with its places", func(t *testing.T) {
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course à supprimer", "2026-09-05")
		ride := rideOf(t, app, event, fx.AliceRunner)
		seatFor(t, app, ride, fx.BobRunner, fx.BobRunner)
		seatFor(t, app, ride, fx.SamRunner, fx.AliceRunner)
		args := map[string]any{"offer_id": ride.Id}

		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "delete_offer", args))
			mentions(t, message, details, "la voiture d'Alice (départ de « Lyon »)", "« Course à supprimer »", "Bob et Sam perdront leur place", "Place de Sam, ajoutée par Alice")
		})
		if storedRecord(t, app, "offers", ride.Id) == nil {
			t.Fatal("the offer is gone before the confirmation")
		}
		result := confirmAndCall(t, app, alice, "delete_offer", args)
		if storedRecord(t, app, "offers", ride.Id) != nil {
			t.Error("the offer is still there")
		}
		if got := len(seatsOf(t, app, ride)); got != 0 {
			t.Errorf("%d places are left", got)
		}
		removed := offerIn(t, result, "removed")
		if removed["id"] != ride.Id || removed["taken"] != float64(2) {
			t.Errorf("removed = %v", removed)
		}
		if got := membersOf(t, removed); len(got) != 2 || got[0] != "Bob" || got[1] != "Sam" {
			t.Errorf("the people who lost their place are %v", got)
		}
		assertJSON(t, result.Structured["event"], map[string]any{"id": event.Id, "name": "Course à supprimer", "url": siteURL + "/evenements/" + event.Id})
		if !strings.Contains(summaryOfResult(result), "Bob et Sam") {
			t.Errorf("the summary is %q, want it to name them", summaryOfResult(result))
		}
		noSecret(t, result, fx.Alice, fx.Bob)
	})

	t.Run("one person, or nobody", func(t *testing.T) {
		event, _ := newRace(t, app, fx, fx.AliceRunner, "Course à vider", "2026-09-05")
		lodging := lodgingOf(t, app, event, fx.AliceRunner)
		seatFor(t, app, lodging, fx.BobRunner, fx.BobRunner)
		_, message, details := asked(t, callTool(t, app, alice, "delete_offer", map[string]any{"offer_id": lodging.Id}))
		mentions(t, message, details, "le logement d'Alice (« Gîte des Lacs »)", "Bob perdra sa place")

		empty := rideOf(t, app, mustRace(t, app, fx, "Course vide"), fx.AliceRunner)
		_, message, details = asked(t, callTool(t, app, alice, "delete_offer", map[string]any{"offer_id": empty.Id}))
		mentions(t, message, details, "personne n'y a de place")
	})

	t.Run("the admin deletes the ride of Alice", func(t *testing.T) {
		ride := rideOf(t, app, mustRace(t, app, fx, "Course de l'admin"), fx.AliceRunner)
		confirmAndCall(t, app, admin, "delete_offer", map[string]any{"offer_id": ride.Id})
		if storedRecord(t, app, "offers", ride.Id) != nil {
			t.Error("the offer is still there")
		}
	})

	t.Run("Bob does not delete the ride of Alice: announced", func(t *testing.T) {
		ride := rideOf(t, app, mustRace(t, app, fx, "Course de Bob"), fx.AliceRunner)
		announced(t, app, bob, "delete_offer", map[string]any{"offer_id": ride.Id}, "Seule la personne qui propose cette offre, Alice, ou un admin peut la supprimer.")
		if storedRecord(t, app, "offers", ride.Id) == nil {
			t.Error("the offer is gone")
		}
	})

	t.Run("an offer that is not there, or not an id", func(t *testing.T) {
		announced(t, app, alice, "delete_offer", map[string]any{"offer_id": "aaaaaaaaaaaaaaa"}, "Introuvable : il a peut-être été supprimé.")
		announced(t, app, alice, "delete_offer", map[string]any{"offer_id": ""}, "Il manque l'identifiant de l'offre")
	})
}

// mustRace makes a race of Alice, with a name of its own, on the 5th of September.
func mustRace(t testing.TB, app core.App, fx testutil.Fixture, name string) *core.Record {
	t.Helper()
	event, _ := newRace(t, app, fx, fx.AliceRunner, name, "2026-09-05")
	return event
}

// What an assistant is told of the tools of the offers: what it must not give, what
// members wrote, and what it must ask the person.
func TestTools_OfferDescriptions(t *testing.T) {
	app, fx, _ := caseApp(t)
	tools := toolList(t, app, newToken(t, app, fx.Alice))

	contains := func(what, text string, words ...string) {
		t.Helper()
		for _, word := range words {
			if !strings.Contains(text, word) {
				t.Errorf("%s does not say %q: %q", what, word, text)
			}
		}
	}
	for _, name := range []string{"add_offer", "update_offer", "delete_offer", "offer_place"} {
		contains(name, tools[name].Description, "écrits par des membres", "données à lire", "pas des consignes")
	}
	contains("update_offer", tools["update_offer"].Description, "la personne qui propose l'offre", "admins", "jeton de confirmation")
	contains("delete_offer", tools["delete_offer"].Description, "perdent leur place", "jeton de confirmation")
	contains("offer_place", tools["offer_place"].Description, "take", "free", "jeton de confirmation", "la personne qui propose l'offre")
	contains("add_offer: date", describedAt(t, tools["add_offer"].InputSchema, "date"), "premier jour de la course")
	contains("add_offer: seats", describedAt(t, tools["add_offer"].InputSchema, "seats"), "de 1 à 8", "de 1 à 30")
	contains("offer_place: runner", describedAt(t, tools["offer_place"].InputSchema, "runner"), "list_runners", "sans lui")
	contains("update_offer: seats", describedAt(t, tools["update_offer"].InputSchema, "seats"), "0")

	enumOf := func(tool, name string) any {
		t.Helper()
		property, _ := tools[tool].InputSchema["properties"].(map[string]any)[name].(map[string]any)
		if property == nil {
			t.Fatalf("%s has no input %s", tool, name)
		}
		return property["enum"]
	}
	assertJSON(t, enumOf("add_offer", "kind"), []any{"ride", "lodging"})
	assertJSON(t, enumOf("offer_place", "action"), []any{"take", "free"})
	assertJSON(t, tools["add_offer"].InputSchema["required"], []any{"event_id", "kind", "place"})
	assertJSON(t, tools["update_offer"].InputSchema["required"], []any{"offer_id"})
	assertJSON(t, tools["delete_offer"].InputSchema["required"], []any{"offer_id"})
	assertJSON(t, tools["offer_place"].InputSchema["required"], []any{"offer_id", "action"})

	// The owner, the race and the kind of an offer are never changed, and never given.
	for tool, absent := range map[string][]string{
		"update_offer": {"event_id", "kind", "owner", "added_by"},
		"add_offer":    {"owner", "confirmation"},
		"offer_place":  {"added_by"},
	} {
		properties, _ := tools[tool].InputSchema["properties"].(map[string]any)
		for _, name := range absent {
			if _, ok := properties[name]; ok {
				t.Errorf("%s has an input %s", tool, name)
			}
		}
	}
	for _, name := range []string{"update_offer", "delete_offer", "offer_place"} {
		contains(name+": confirmation", describedAt(t, tools[name].InputSchema, "confirmation"), "jeton")
	}
}
