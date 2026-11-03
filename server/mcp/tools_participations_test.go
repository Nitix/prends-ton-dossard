package mcp_test

import (
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// caseApp is a fresh application with the fixture and the token of Alice, for a
// case that changes what the others read.
func caseApp(t *testing.T) (*tests.TestApp, testutil.Fixture, string) {
	t.Helper()
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	return app, fx, newToken(t, app, fx.Alice)
}

// newRace makes a race of its own in the database, for a test that needs one in a
// state of its own: an event on that day, created by creator, with one trail of 10
// km. It returns the event and its format.
func newRace(t testing.TB, app core.App, fx testutil.Fixture, creator *core.Record, name, day string) (event, format *core.Record) {
	t.Helper()
	event = create(t, app, "events", map[string]any{"name": name, "location": "Annecy", "start_date": day, "created_by": creator.Id})
	format = create(t, app, "formats", map[string]any{"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 10})
	return event, format
}

// joined puts a runner on a format, in the database.
func joined(t testing.TB, app core.App, runner, format *core.Record, status string, confirmed bool, addedBy *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "participations", map[string]any{
		"runner": runner.Id, "format": format.Id, "status": status, "confirmed": confirmed, "added_by": addedBy.Id,
	})
}

// joinedEvent puts a runner on an event alone (« format à choisir », or supporter),
// in the database.
func joinedEvent(t testing.TB, app core.App, runner, event *core.Record, status string, confirmed bool, addedBy *core.Record) *core.Record {
	t.Helper()
	return create(t, app, "participations", map[string]any{
		"runner": runner.Id, "event": event.Id, "status": status, "confirmed": confirmed, "added_by": addedBy.Id,
	})
}

// participationOf is the participation of the runner on the format, as the
// database has it; nil for none. A format "" is the event alone.
func participationOf(t testing.TB, app core.App, runner, format *core.Record) *core.Record {
	t.Helper()
	found, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runner.Id, "format": format.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(found) == 0 {
		return nil
	}
	return found[0]
}

// onEventAlone is the participations of the runner that are on the event alone.
func onEventAlone(t testing.TB, app core.App, runner, event *core.Record) []*core.Record {
	t.Helper()
	found, err := app.FindAllRecords("participations", dbx.HashExp{"runner": runner.Id, "event": event.Id, "format": ""})
	if err != nil {
		t.Fatal(err)
	}
	return found
}

// participationIn is the participation of an answer.
func participationIn(t testing.TB, result toolResult, key string) map[string]any {
	t.Helper()
	p, ok := result.Structured[key].(map[string]any)
	if !ok {
		t.Fatalf("no %s in %.300s", key, redact(result.Text))
	}
	return p
}

// storedStatus is the status and the confirmation of a participation, as the
// database has them.
func storedStatus(t testing.TB, app core.App, p *core.Record) (status string, confirmed bool) {
	t.Helper()
	stored := storedRecord(t, app, "participations", p.Id)
	if stored == nil {
		t.Fatalf("the participation %s is gone", p.Id)
	}
	return stored.GetString("status"), stored.GetBool("confirmed")
}

// A runner is added to a race: at once, whoever it is. What the person agreed to
// does not change with who is added; what the site does (who added it, whether
// the runner confirmed it) is said in the answer.
func TestTools_AddParticipation_Confirmation(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	alice := newToken(t, app, fx.Alice)

	t.Run("herself: written at once, and confirmed", func(t *testing.T) {
		counted := mcp.CountInnerRequests(t)
		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"format_id": fx.FLyon.Id, "status": "interested"}))
		if got := counted.Of(http.MethodPost); got != 1 {
			t.Errorf("%d POST, want one", got)
		}
		if got := counted.Total() - counted.Of(http.MethodGet) - counted.Of(http.MethodPost); got != 0 {
			t.Errorf("%d other writes, want none", got)
		}
		p := participationIn(t, result, "participation")
		assertJSON(t, p["runner"], runnerRef(fx.AliceRunner))
		assertJSON(t, p["added_by"], runnerRef(fx.AliceRunner))
		if p["status"] != "interested" || p["status_label"] != "Intéressé" || p["confirmed"] != true {
			t.Errorf("the participation is %v, want interested, « Intéressé », confirmed", p)
		}
		assertJSON(t, result.Structured["event"], map[string]any{"id": fx.Event2.Id, "name": "10 km de Lyon", "url": siteURL + "/evenements/" + fx.Event2.Id})
		if result.Structured["format_title"] != "Route 10 km" {
			t.Errorf("format_title = %v", result.Structured["format_title"])
		}
		if strings.Contains(summaryOfResult(result), "non confirmé") {
			t.Errorf("the summary of her own participation says it is not confirmed: %q", summaryOfResult(result))
		}
		// Nobody is given more than a name: no email, no account.
		for _, secret := range []string{"@", "email", "\"user\"", fx.Alice.Id, fx.Bob.Id} {
			if strings.Contains(result.Text, secret) {
				t.Errorf("the answer holds %q: %.300s", secret, result.Text)
			}
		}
		stored := participationOf(t, app, fx.AliceRunner, fx.FLyon)
		if stored == nil || !stored.GetBool("confirmed") || stored.GetString("added_by") != fx.AliceRunner.Id || stored.GetString("event") != fx.Event2.Id {
			t.Errorf("the stored participation is %v", stored)
		}
	})

	t.Run("somebody with an account: written at once, not confirmed, and the summary says where to confirm", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"runner": "bob", "format_id": fx.FLyon.Id, "status": "interested"}))
		p := participationIn(t, result, "participation")
		assertJSON(t, p["runner"], runnerRef(fx.BobRunner))
		assertJSON(t, p["added_by"], runnerRef(fx.AliceRunner))
		if p["confirmed"] != false {
			t.Errorf("confirmed = %v, want false", p["confirmed"])
		}
		if want := "non confirmé : Bob le verra dans « À confirmer »"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		stored := participationOf(t, app, fx.BobRunner, fx.FLyon)
		if stored == nil || stored.GetBool("confirmed") || stored.GetString("added_by") != fx.AliceRunner.Id {
			t.Errorf("the stored participation is %v, want unconfirmed, added by Alice", stored)
		}
	})

	t.Run("somebody with no account: it stays unconfirmed, and the summary says why", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"runner": fx.SamRunner.Id, "format_id": fx.FLyon.Id, "status": "registered"}))
		if want := "Sam n'a pas de compte : sa participation reste non confirmée"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		if strings.Contains(summaryOfResult(result), "À confirmer") {
			t.Errorf("the summary sends Sam to a page that he has no account for: %q", summaryOfResult(result))
		}
		if participationIn(t, result, "participation")["confirmed"] != false {
			t.Error("the participation of Sam is confirmed")
		}
	})

	t.Run("a race given by its id and its format: the same", func(t *testing.T) {
		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{
			"runner": fx.AdminRunner.Id, "event_id": fx.Event2.Id, "format_id": fx.FLyon.Id, "status": "dns",
		}))
		if participationIn(t, result, "participation")["status_label"] != "Non partant" {
			t.Errorf("the participation is %v", result.Structured["participation"])
		}
	})
}

// What the tool announces before the site would refuse it (the site's own
// words), what it leaves to the site, and what it writes. Each case has an
// application of its own.
func TestTools_AddParticipation(t *testing.T) {
	t.Run("Bob is on the race already: the message gives his participation", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		announced(t, app, alice, "add_participation", map[string]any{"runner": "Bob", "format_id": fx.F42.Id, "status": "registered"},
			"Bob a déjà une participation à « Trail 42 km » (Intéressé, id "+fx.P2.Id+") : change-la avec update_participation.")
	})

	t.Run("the runner is on the event alone already", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		existing := joinedEvent(t, app, fx.AdminRunner, fx.Event, "interested", false, fx.AliceRunner)
		announced(t, app, alice, "add_participation", map[string]any{"runner": "Admin", "event_id": fx.Event.Id, "status": "supporter"},
			"Admin a déjà une participation à la course seule « Trail des Crêtes » (Intéressé, id "+existing.Id+") : change-la avec update_participation.")
	})

	t.Run("interested with no race, on a race that has one: refused with its id and its title", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		announced(t, app, alice, "add_participation", map[string]any{"event_id": fx.Event2.Id, "status": "interested"},
			"Cette course n'a qu'une épreuve (« Route 10 km », id "+fx.FLyon.Id+") : ajoute le coureur à cette épreuve.")
	})

	t.Run("a supporter has no race: he is in the supporters of the race", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"runner": fx.AdminRunner.Id, "event_id": fx.Event.Id, "status": "supporter"}))
		if participationIn(t, result, "participation")["status_label"] != "Supporteur" {
			t.Errorf("the participation is %v", result.Structured["participation"])
		}
		if _, ok := result.Structured["format_title"]; ok {
			t.Errorf("a participation on the event alone has the format title %v", result.Structured["format_title"])
		}
		stored := onEventAlone(t, app, fx.AdminRunner, fx.Event)
		if len(stored) != 1 || stored[0].GetString("status") != "supporter" || stored[0].GetString("event") != fx.Event.Id {
			t.Fatalf("the stored participations are %v", stored)
		}
		event := succeeded(t, callTool(t, app, alice, "get_event", map[string]any{"event_id": fx.Event.Id}))
		supporters, _ := event.Structured["supporters"].([]any)
		if len(supporters) != 1 || supporters[0].(map[string]any)["runner"].(map[string]any)["name"] != "Admin" {
			t.Errorf("the supporters are %v, want Admin", supporters)
		}
	})

	t.Run("a supporter with a race: the site refuses it", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		refused(t, app, alice, "add_participation", map[string]any{"format_id": fx.F15.Id, "status": "supporter"},
			"un supporteur ne court pas d'épreuve. (supporter_with_format)")
	})

	t.Run("finished on a race that has not taken place: the site refuses it", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		_, future := newRace(t, app, fx, fx.AliceRunner, "Ultra du futur", "2099-06-13")
		refused(t, app, alice, "add_participation", map[string]any{"format_id": future.Id, "status": "finished"},
			"la course n'a pas encore eu lieu. (status_before_race)")
	})

	t.Run("registered with no race: the site refuses it", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		refused(t, app, alice, "add_participation", map[string]any{"event_id": fx.Event.Id, "status": "registered"},
			"il faut choisir une épreuve. (format_required)")
	})

	t.Run("the format of another race: announced", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		announced(t, app, alice, "add_participation", map[string]any{"event_id": fx.Event.Id, "format_id": fx.FLyon.Id, "status": "interested"},
			"épreuve : cette épreuve appartient à un autre événement. (format_other_event)")
	})

	t.Run("a runner that nobody knows: the names of the group", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		announced(t, app, alice, "add_participation", map[string]any{"runner": "Zoé", "format_id": fx.F42.Id, "status": "interested"},
			"Coureur inconnu : « Zoé ». Les coureurs du groupe : Admin, Alice, Bob, Sam.")
	})

	t.Run("a call that names no race, or one that is not there", func(t *testing.T) {
		app, _, alice := caseApp(t)
		for _, row := range []struct {
			name string
			args map[string]any
			want string
		}{
			{"no race", map[string]any{"status": "interested"}, "Il manque la course : donne event_id, ou format_id."},
			{"a race that is not an id", map[string]any{"event_id": "Trail des Crêtes", "status": "interested"}, "n'est pas un identifiant de course"},
			{"a format that is not an id", map[string]any{"format_id": "Trail 42 km", "status": "interested"}, "n'est pas un identifiant d'épreuve"},
			{"a format that is not there", map[string]any{"format_id": "aaaaaaaaaaaaaaa", "status": "interested"}, "Introuvable : il a peut-être été supprimé."},
			{"a race that is not there", map[string]any{"event_id": "aaaaaaaaaaaaaaa", "status": "supporter"}, "Introuvable : il a peut-être été supprimé."},
		} {
			t.Run(row.name, func(t *testing.T) {
				announced(t, app, alice, "add_participation", row.args, row.want)
			})
		}
	})

	t.Run("an account with no runner", func(t *testing.T) {
		app, fx, _ := caseApp(t)
		lonely := create(t, app, "users", map[string]any{"email": "lonely@example.test", "password": testutil.Password, "role": "member", "verified": true})
		announced(t, app, newToken(t, app, lonely), "add_participation", map[string]any{"format_id": fx.F15.Id, "status": "interested"},
			"Ton compte n'a pas de coureur : demande à un admin.")
	})
}

// A participation to a race replaces the one of the same runner to the race
// alone: for somebody else, the person is asked first; for oneself, the summary
// says it.
func TestTools_AddParticipation_ReplacesAnotherRunnersChoice(t *testing.T) {
	t.Run("another runner's: a confirmation names what is replaced, then it is replaced", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		replaced := joinedEvent(t, app, fx.AdminRunner, fx.Event, "interested", false, fx.AliceRunner)
		args := map[string]any{"runner": "Admin", "format_id": fx.F15.Id, "status": "registered"}

		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "add_participation", args))
			mentions(t, message, details, "Admin (Intéressé, non confirmé)", "course seule « Trail des Crêtes »", "ajoutée par Alice", "« Trail 15 km »", "Inscrit")
		})
		if storedRecord(t, app, "participations", replaced.Id) == nil {
			t.Fatal("the participation to the event alone is gone, before the confirmation")
		}

		result := confirmAndCall(t, app, alice, "add_participation", args)
		if storedRecord(t, app, "participations", replaced.Id) != nil {
			t.Error("the participation to the event alone is still there")
		}
		stored := participationOf(t, app, fx.AdminRunner, fx.F15)
		if stored == nil || stored.GetString("status") != "registered" || stored.GetString("added_by") != fx.AliceRunner.Id || stored.GetBool("confirmed") {
			t.Errorf("the stored participation is %v", stored)
		}
		if !strings.Contains(summaryOfResult(result), "participation à la course seule") || !strings.Contains(summaryOfResult(result), "remplacée") {
			t.Errorf("the summary does not say that the participation to the event alone was replaced: %q", summaryOfResult(result))
		}
	})

	t.Run("her own: written at once, and the summary says it", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		replaced := joinedEvent(t, app, fx.AliceRunner, fx.Event2, "supporter", true, fx.AliceRunner)

		result := isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"format_id": fx.FLyon.Id, "status": "registered"}))
		if storedRecord(t, app, "participations", replaced.Id) != nil {
			t.Error("her participation to the event alone is still there")
		}
		if want := "sa participation à la course seule « 10 km de Lyon » (Supporteur) est remplacée"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want it to say %q", summaryOfResult(result), want)
		}
		if stored := participationOf(t, app, fx.AliceRunner, fx.FLyon); stored == nil || !stored.GetBool("confirmed") {
			t.Errorf("the stored participation is %v", stored)
		}
	})

	t.Run("nobody's choice is replaced: no confirmation", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		isDone(t, callTool(t, app, alice, "add_participation", map[string]any{"runner": "Admin", "format_id": fx.F15.Id, "status": "interested"}))
	})
}

// Only the runner confirms a participation, and nothing is erased by that: no
// confirmation of § 6.13.
func TestTools_UpdateParticipation_OnlyTheRunnerConfirms(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)

	announced(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P2.Id}, "Seule la personne concernée, Bob, peut confirmer sa participation.")
	if _, confirmed := storedStatus(t, app, fx.P2); confirmed {
		t.Fatal("Alice confirmed the participation of Bob")
	}

	counted := mcp.CountInnerRequests(t)
	result := isDone(t, callTool(t, app, bob, "update_participation", map[string]any{"participation_id": fx.P2.Id}))
	if got := counted.Of(http.MethodPatch); got != 1 {
		t.Errorf("%d PATCH, want one", got)
	}
	p := participationIn(t, result, "participation")
	if p["confirmed"] != true || p["status"] != "interested" {
		t.Errorf("the participation is %v, want the same status, confirmed", p)
	}
	if !strings.Contains(summaryOfResult(result), "confirmée") {
		t.Errorf("the summary is %q", summaryOfResult(result))
	}
	if _, confirmed := storedStatus(t, app, fx.P2); !confirmed {
		t.Error("the participation of Bob is not confirmed in the database")
	}

	// Confirmed already: there is nothing to write.
	writesNothing(t, app, func() {
		again := isDone(t, callTool(t, app, bob, "update_participation", map[string]any{"participation_id": fx.P2.Id}))
		if !strings.Contains(summaryOfResult(again), "déjà confirmée") {
			t.Errorf("the summary is %q, want it to say that the participation is confirmed already", summaryOfResult(again))
		}
	})
}

// The participation of somebody else, and a status that would erase a result,
// are what the person is asked about; what the site would refuse is announced.
func TestTools_UpdateParticipation(t *testing.T) {
	t.Run("somebody else's: a confirmation, then it is written, and still not confirmed", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		admin := newToken(t, app, fx.Admin)
		args := map[string]any{"participation_id": fx.P2.Id, "status": "registered"}

		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_participation", args))
			mentions(t, message, details, "Bob (Intéressé, non confirmé)", "« Trail 42 km »", "d'un autre coureur", "de « Intéressé » à « Inscrit »")
		})
		result := confirmAndCall(t, app, alice, "update_participation", args)
		p := participationIn(t, result, "participation")
		if p["status"] != "registered" || p["confirmed"] != false {
			t.Errorf("the participation is %v, want registered, not confirmed", p)
		}
		if want := "non confirmé : Bob le verra dans « À confirmer »"; !strings.Contains(summaryOfResult(result), want) {
			t.Errorf("the summary is %q, want %q", summaryOfResult(result), want)
		}
		if status, confirmed := storedStatus(t, app, fx.P2); status != "registered" || confirmed {
			t.Errorf("the stored participation is %s, confirmed %v", status, confirmed)
		}

		// Bob confirms it: a member may not change it any more, an admin may.
		update(t, app, fx.P2, map[string]any{"confirmed": true})
		announced(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P2.Id, "status": "dns"},
			"Bob a confirmé cette participation : elle ne peut plus être changée que par Bob ou par un admin.")
		confirmAndCall(t, app, admin, "update_participation", map[string]any{"participation_id": fx.P2.Id, "status": "dns"})
		if status, confirmed := storedStatus(t, app, fx.P2); status != "dns" || !confirmed {
			t.Errorf("the stored participation is %s, confirmed %v, want dns, still confirmed", status, confirmed)
		}
	})

	t.Run("her own: written at once, and she may move to another race or choose one", func(t *testing.T) {
		app, fx, alice := caseApp(t)

		result := isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P1.Id, "status": "dns"}))
		if participationIn(t, result, "participation")["status_label"] != "Non partant" {
			t.Errorf("the participation is %v", result.Structured["participation"])
		}
		if status, confirmed := storedStatus(t, app, fx.P1); status != "dns" || !confirmed {
			t.Errorf("the stored participation is %s, confirmed %v", status, confirmed)
		}

		result = isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P1.Id, "format_id": fx.F15.Id}))
		if result.Structured["format_title"] != "Trail 15 km" {
			t.Errorf("format_title = %v", result.Structured["format_title"])
		}
		if stored := storedRecord(t, app, "participations", fx.P1.Id); stored.GetString("format") != fx.F15.Id {
			t.Errorf("the participation is on %s, want F15", stored.GetString("format"))
		}

		// « Intéressé, format à choisir »: she chooses the race.
		alone := joinedEvent(t, app, fx.AliceRunner, fx.Event2, "interested", true, fx.AliceRunner)
		isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": alone.Id, "format_id": fx.FLyon.Id}))
		if stored := storedRecord(t, app, "participations", alone.Id); stored.GetString("format") != fx.FLyon.Id || stored.GetString("event") != fx.Event2.Id {
			t.Errorf("the participation is on %s of %s, want FLyon of Event2", stored.GetString("format"), stored.GetString("event"))
		}
	})

	t.Run("somebody else's, to another race: a confirmation that names both", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		args := map[string]any{"participation_id": fx.P2.Id, "format_id": fx.F15.Id}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_participation", args))
			mentions(t, message, details, "Bob (Intéressé, non confirmé)", "« Trail 42 km »", "« Trail 15 km »")
		})
		confirmAndCall(t, app, alice, "update_participation", args)
		if stored := storedRecord(t, app, "participations", fx.P2.Id); stored.GetString("format") != fx.F15.Id {
			t.Errorf("the participation is on %s, want F15", stored.GetString("format"))
		}
	})

	t.Run("a change that changes nothing writes nothing", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		writesNothing(t, app, func() {
			result := isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P1.Id, "status": "registered", "format_id": fx.F42.Id}))
			if !strings.Contains(summaryOfResult(result), "Rien à changer") {
				t.Errorf("the summary is %q", summaryOfResult(result))
			}
		})
		// Somebody else's, as it is: nothing to ask either.
		writesNothing(t, app, func() {
			isDone(t, callTool(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P2.Id, "status": "interested"}))
		})
	})

	t.Run("a status that erases a result: a confirmation that names what is lost", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H"})

		// To dnf, the time and the rank go and the note stays.
		args := map[string]any{"participation_id": fx.P1.Id, "status": "dnf"}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_participation", args))
			mentions(t, message, details, "4h 12min 30s", "12e sur 340")
			if all := message + strings.Join(details, "\n"); strings.Contains(all, "3e V1H") || strings.Contains(all, "d'un autre coureur") {
				t.Errorf("the confirmation names the note, which stays, or says that the participation is somebody else's:\n%s", redact(all))
			}
		})
		confirmAndCall(t, app, alice, "update_participation", args)
		stored := storedRecord(t, app, "participations", fx.P1.Id)
		if stored.GetInt("finish_time_s") != 0 || stored.GetInt("rank") != 0 || stored.GetString("result_note") != "3e V1H" {
			t.Errorf("the result is %d s, %d, %q, want the note alone", stored.GetInt("finish_time_s"), stored.GetInt("rank"), stored.GetString("result_note"))
		}

		// To registered, the note goes too.
		update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H"})
		args = map[string]any{"participation_id": fx.P1.Id, "status": "registered"}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "update_participation", args))
			mentions(t, message, details, "4h 12min 30s", "12e sur 340", "3e V1H")
		})
		confirmAndCall(t, app, alice, "update_participation", args)
		if stored := storedRecord(t, app, "participations", fx.P1.Id); stored.GetInt("finish_time_s") != 0 || stored.GetString("result_note") != "" {
			t.Errorf("the result is still there: %d s, %q", stored.GetInt("finish_time_s"), stored.GetString("result_note"))
		}
	})

	t.Run("what the tool announces, and what it does not find", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		for _, row := range []struct {
			name string
			args map[string]any
			want string
		}{
			{"a race of another event", map[string]any{"participation_id": fx.P1.Id, "format_id": fx.FLyon.Id}, "(format_other_event)"},
			{"an id that is not one", map[string]any{"participation_id": "P1", "status": "dns"}, "n'est pas un identifiant de participation"},
			{"no id", map[string]any{"participation_id": " ", "status": "dns"}, "Il manque l'identifiant de la participation"},
			{"a participation that is not there", map[string]any{"participation_id": "aaaaaaaaaaaaaaa", "status": "dns"}, "Introuvable : il a peut-être été supprimé."},
		} {
			t.Run(row.name, func(t *testing.T) {
				announced(t, app, alice, "update_participation", row.args, row.want)
			})
		}
	})

	t.Run("what the site refuses: finished before the race, supporter on a race", func(t *testing.T) {
		app, fx, alice := caseApp(t)
		_, future := newRace(t, app, fx, fx.AliceRunner, "Ultra du futur", "2099-06-13")
		planned := joined(t, app, fx.AliceRunner, future, "interested", true, fx.AliceRunner)
		refused(t, app, alice, "update_participation", map[string]any{"participation_id": planned.Id, "status": "finished"},
			"la course n'a pas encore eu lieu. (status_before_race)")
		refused(t, app, alice, "update_participation", map[string]any{"participation_id": fx.P1.Id, "status": "supporter"},
			"un supporteur ne court pas d'épreuve. (supporter_with_format)")
	})
}

// What a status change erases is what the hook of the participations clears: the
// confirmation says what the hook then does, for every status.
func TestTools_UpdateParticipation_NamesWhatTheHookClears(t *testing.T) {
	app, fx, alice := caseApp(t)
	for _, status := range []string{"interested", "registered", "dnf", "dns"} {
		t.Run(status, func(t *testing.T) {
			_, format := newRace(t, app, fx, fx.AliceRunner, "Cross du "+status, "2026-03-07")
			p := joined(t, app, fx.AliceRunner, format, "finished", true, fx.AliceRunner)
			update(t, app, p, map[string]any{"finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H"})
			args := map[string]any{"participation_id": p.Id, "status": status}

			_, message, details := asked(t, callTool(t, app, alice, "update_participation", args))
			named := func(text string) bool { return strings.Contains(message+strings.Join(details, "\n"), text) }
			predicted := map[string]bool{"time": named("4h 12min 30s"), "rank": named("12e sur 340"), "note": named("3e V1H")}

			confirmAndCall(t, app, alice, "update_participation", args)
			stored := storedRecord(t, app, "participations", p.Id)
			actual := map[string]bool{"time": stored.GetInt("finish_time_s") == 0, "rank": stored.GetInt("rank") == 0 && stored.GetInt("rank_of") == 0, "note": stored.GetString("result_note") == ""}
			for part, lost := range actual {
				if predicted[part] != lost {
					t.Errorf("status %s: the confirmation names the %s as lost: %v; the site cleared it: %v", status, part, predicted[part], lost)
				}
			}
		})
	}
}

// Removing is always asked first: it says whose participation, on which race,
// with which status and what result goes with it.
func TestTools_RemoveParticipation(t *testing.T) {
	app, fx, alice := caseApp(t)
	bob := newToken(t, app, fx.Bob)
	admin := newToken(t, app, fx.Admin)

	t.Run("somebody else's, not confirmed: a confirmation, then it is gone", func(t *testing.T) {
		args := map[string]any{"participation_id": fx.P3.Id}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, alice, "remove_participation", args))
			mentions(t, message, details, "Sam (Intéressé, non confirmé)", "« Trail 15 km » (Trail des Crêtes)", "ajoutée par Alice")
		})
		if storedRecord(t, app, "participations", fx.P3.Id) == nil {
			t.Fatal("the participation is gone before the confirmation")
		}
		result := confirmAndCall(t, app, alice, "remove_participation", args)
		if storedRecord(t, app, "participations", fx.P3.Id) != nil {
			t.Error("the participation is still there")
		}
		removed := participationIn(t, result, "removed")
		if removed["id"] != fx.P3.Id {
			t.Errorf("removed = %v", removed)
		}
		assertJSON(t, removed["runner"], runnerRef(fx.SamRunner))
		assertJSON(t, result.Structured["event"], map[string]any{"id": fx.Event.Id, "name": "Trail des Crêtes", "url": siteURL + "/evenements/" + fx.Event.Id})
		if result.Structured["format_title"] != "Trail 15 km" || !strings.Contains(summaryOfResult(result), "Sam") {
			t.Errorf("format_title = %v, summary = %q", result.Structured["format_title"], summaryOfResult(result))
		}
	})

	t.Run("confirmed by its runner: a member is refused, with no confirmation", func(t *testing.T) {
		update(t, app, fx.P2, map[string]any{"confirmed": true})
		announced(t, app, alice, "remove_participation", map[string]any{"participation_id": fx.P2.Id},
			"Bob a confirmé cette participation : elle ne peut plus être retirée que par Bob ou par un admin.")
		if storedRecord(t, app, "participations", fx.P2.Id) == nil {
			t.Error("the participation of Bob is gone")
		}
	})

	t.Run("his own: a confirmation, then it is gone", func(t *testing.T) {
		confirmAndCall(t, app, bob, "remove_participation", map[string]any{"participation_id": fx.P2.Id})
		if storedRecord(t, app, "participations", fx.P2.Id) != nil {
			t.Error("the participation is still there")
		}
	})

	t.Run("an admin, on a participation that is confirmed: a confirmation, with the result it loses", func(t *testing.T) {
		update(t, app, fx.P1, map[string]any{"status": "finished", "finish_time_s": 15150, "rank": 12, "rank_of": 340, "result_note": "3e V1H"})
		args := map[string]any{"participation_id": fx.P1.Id}
		writesNothing(t, app, func() {
			_, message, details := asked(t, callTool(t, app, admin, "remove_participation", args))
			mentions(t, message, details, "Alice (Terminé · 4h 12min 30s · 12e sur 340 · 3e V1H)", "« Trail 42 km »", "résultat")
		})
		confirmAndCall(t, app, admin, "remove_participation", args)
		if storedRecord(t, app, "participations", fx.P1.Id) != nil {
			t.Error("the participation of Alice is still there")
		}
	})

	t.Run("one that is not there", func(t *testing.T) {
		announced(t, app, alice, "remove_participation", map[string]any{"participation_id": fx.P1.Id}, "Introuvable : il a peut-être été supprimé.")
		announced(t, app, alice, "remove_participation", map[string]any{"participation_id": "P1"}, "n'est pas un identifiant de participation")
	})
}

// What an assistant is told of these tools: what it must ask the person, what an
// unconfirmed participation means, and what to use instead of removing.
func TestTools_ParticipationDescriptions(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	tools := toolList(t, app, newToken(t, app, fx.Alice))

	contains := func(what, text string, words ...string) {
		t.Helper()
		for _, word := range words {
			if !strings.Contains(text, word) {
				t.Errorf("%s does not say %q: %q", what, word, text)
			}
		}
	}

	add := tools["add_participation"]
	contains("add_participation", add.Description, "non confirmée", "confirmed", "pas comme un fait", "Demande à la personne avant d'inscrire", "remplace")
	contains("add_participation: status", describedAt(t, add.InputSchema, "status"), "interested", "registered", "choisit", "demande")
	contains("add_participation: runner", describedAt(t, add.InputSchema, "runner"), "sans lui", "list_runners")
	for _, status := range []string{"interested", "registered", "finished", "dnf", "dns", "supporter"} {
		enum, _ := add.InputSchema["properties"].(map[string]any)["status"].(map[string]any)["enum"].([]any)
		found := false
		for _, value := range enum {
			found = found || value == status
		}
		if !found {
			t.Errorf("add_participation: the statuses are %v, want %s among them", enum, status)
		}
	}
	if required, _ := add.InputSchema["required"].([]any); len(required) != 1 || required[0] != "status" {
		t.Errorf("add_participation requires %v, want the status alone", required)
	}

	// What the inputs of the other tools take: the statuses, the numbers of a
	// ranking (1 or more), and what is required.
	schemaOf := func(tool string) map[string]any { return tools[tool].InputSchema }
	propertyOf := func(tool, name string) map[string]any {
		t.Helper()
		p, _ := schemaOf(tool)["properties"].(map[string]any)[name].(map[string]any)
		if p == nil {
			t.Fatalf("%s has no input %s", tool, name)
		}
		return p
	}
	assertJSON(t, propertyOf("set_result", "status")["enum"], []any{"finished", "dnf"})
	assertJSON(t, propertyOf("update_participation", "status")["enum"], []any{"interested", "registered", "finished", "dnf", "dns", "supporter"})
	for _, name := range []string{"rank", "rank_of"} {
		if p := propertyOf("set_result", name); p["minimum"] != float64(1) || p["type"] != "integer" {
			t.Errorf("set_result: %s is %v, want an integer of 1 or more", name, p)
		}
	}
	assertJSON(t, schemaOf("set_result")["required"], []any{"participation_id", "status"})
	assertJSON(t, schemaOf("update_participation")["required"], []any{"participation_id"})
	assertJSON(t, schemaOf("remove_participation")["required"], []any{"participation_id"})
	contains("set_result: finish_time", describedAt(t, schemaOf("set_result"), "finish_time"), "h:mm:ss", "4:12:30", "1:30 est une minute et demie", "1:30:00")
	contains("set_result", tools["set_result"].Description, "en entier", "effacé", "dnf", "confirmation")

	update := tools["update_participation"]
	contains("update_participation", update.Description, "Sans status ni format_id", "confirme", "seul", "non confirmée")
	remove := tools["remove_participation"]
	contains("remove_participation", remove.Description, "dns", "Non partant", "désinscription")
	contains("participation answers", describedAt(t, add.OutputSchema, "participation", "confirmed"), "attend sa confirmation")
	for _, name := range []string{"add_participation", "update_participation", "remove_participation", "set_result"} {
		contains(name+": confirmation", describedAt(t, tools[name].InputSchema, "confirmation"), "jeton")
	}
}
