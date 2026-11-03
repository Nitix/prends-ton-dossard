package mcp_test

import (
	"fmt"
	"io"
	"net/http"
	"strings"
	"testing"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tests"

	"courses/server/mcp"
	"courses/server/testutil"
)

// A token does what its owner could do on the site, and no more (spec § 5.3): the
// rules of the collections and the hooks decide, whoever the tool is called by.
// The table has a row for each write tool, each person and each state of what the
// call is about, and says what the site gives that person for the same thing:
// the rows of the matrix of the spec v1 (§ 6.1) for the races, their formats and
// their participations (anybody adds and edits; a race and a format are deleted by
// the author of the race or an admin; a participation of somebody else is
// changed or removed while its runner has not confirmed it, or by an admin).
//
// A call that asks for a confirmation is made again with it, as an assistant does
// once the person agrees: what is checked is what ends up in the database. The
// tasks that add write tools add their rows here (ruleRows).

// prepareRow makes in the database what a row works on (its own records, so that
// the rows do not depend on each other), and gives the arguments of the call and
// whether its write is there.
type prepareRow func(t *testing.T, app core.App, fx testutil.Fixture) (args map[string]any, written func() bool)

// siteRequest is the request that the site would be sent for the same thing, from
// the arguments of the tool.
type siteRequest func(args map[string]any) (method, path, body string)

// ruleRow is a call of a write tool by a person, and what the site gives that
// person.
type ruleRow struct {
	tool string
	// what is the state of what the call is about.
	what string
	// person is Alice, Bob or Admin.
	person string
	// allowed is what the site gives that person: the write, or a refusal.
	allowed bool
	prepare prepareRow
	// site is the request that the site is sent for a row that is refused: it
	// refuses it too.
	site siteRequest
}

// eachPerson is the three rows of a call by Alice, Bob and the admin.
func eachPerson(tool, what string, alice, bob, admin bool, prepare prepareRow, site siteRequest) []ruleRow {
	return []ruleRow{
		{tool, what, "Alice", alice, prepare, site},
		{tool, what, "Bob", bob, prepare, site},
		{tool, what, "Admin", admin, prepare, site},
	}
}

// The races that the rows make are told apart by their name: a counter, and a
// word of their own for the races that are created.
var (
	ruleRaces int
	ruleWords = []string{"Ardennes", "Bretagne", "Corse", "Dordogne"}
)

func ruleRaceName() string {
	ruleRaces++
	return fmt.Sprintf("Course de règle %d", ruleRaces)
}

// racePast is a race of Alice in the past, with the trail of its format: what
// the rows about participations work on.
func racePast(t *testing.T, app core.App, fx testutil.Fixture) *core.Record {
	t.Helper()
	_, format := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
	return format
}

// participationRows are the rows of the tools that change a participation, for
// each of the four states of what they change.
func participationRows(tool string, args func(p *core.Record) map[string]any, written func(t testing.TB, app core.App, p *core.Record) bool, site siteRequest) []ruleRow {
	state := func(what string, runner func(testutil.Fixture) *core.Record, confirmed bool, alice, bob, admin bool) []ruleRow {
		prepare := func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			p := joined(t, app, runner(fx), racePast(t, app, fx), "interested", confirmed, fx.AliceRunner)
			return args(p), func() bool { return written(t, app, p) }
		}
		return eachPerson(tool, what, alice, bob, admin, prepare, site)
	}
	var rows []ruleRow
	rows = append(rows, state("the participation of Bob, not confirmed yet", func(fx testutil.Fixture) *core.Record { return fx.BobRunner }, false, true, true, true)...)
	rows = append(rows, state("the participation of Bob, confirmed by him", func(fx testutil.Fixture) *core.Record { return fx.BobRunner }, true, false, true, true)...)
	rows = append(rows, state("the participation of Alice, confirmed by her", func(fx testutil.Fixture) *core.Record { return fx.AliceRunner }, true, true, false, true)...)
	rows = append(rows, state("the participation of Sam, who has no account", func(fx testutil.Fixture) *core.Record { return fx.SamRunner }, false, true, true, true)...)
	return rows
}

// participationSite is the request of the site that does to the participation of
// the arguments what the tool does.
func participationSite(method, body string) siteRequest {
	return func(args map[string]any) (string, string, string) {
		return method, "/api/collections/participations/records/" + args["participation_id"].(string), body
	}
}

func eventRows() []ruleRow {
	var rows []ruleRow

	// Each of the three has a word of its own in the name of its race: two races
	// that share a word within a month are taken for a duplicate.
	for i, person := range []string{"Alice", "Bob", "Admin"} {
		word := ruleWords[i]
		rows = append(rows, ruleRow{
			tool: "create_event", what: "a new race", person: person, allowed: true,
			prepare: func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
				name := "Trail de " + word
				return map[string]any{
					"name": name, "location": "Annecy", "start_date": "2031-01-10",
					"formats": []any{map[string]any{"race_type": "Trail", "distance_km": 20}},
				}, func() bool {
					_, err := app.FindFirstRecordByData("events", "name", name)
					return err == nil
				}
			},
		})
	}

	race := func(t *testing.T, app core.App, fx testutil.Fixture) (event, format *core.Record) {
		return newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
	}
	rows = append(rows, eachPerson("update_event", "a race that somebody else created", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, _ := race(t, app, fx)
			return map[string]any{"event_id": event.Id, "location": "Chamonix"}, func() bool {
				return storedRecord(t, app, "events", event.Id).GetString("location") == "Chamonix"
			}
		}, nil)...)

	rows = append(rows, eachPerson("delete_event", "a race of Alice", true, false, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, _ := race(t, app, fx)
			return map[string]any{"event_id": event.Id}, func() bool { return storedRecord(t, app, "events", event.Id) == nil }
		},
		func(args map[string]any) (string, string, string) {
			return http.MethodDelete, "/api/collections/events/records/" + args["event_id"].(string), ""
		})...)

	rows = append(rows, eachPerson("add_format", "a race that somebody else created", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, _ := race(t, app, fx)
			return map[string]any{"event_id": event.Id, "race_type": "Trail", "distance_km": 21}, func() bool {
				formats, err := app.FindAllRecords("formats", dbx.HashExp{"event": event.Id})
				return err == nil && len(formats) == 2
			}
		}, nil)...)

	rows = append(rows, eachPerson("update_format", "a format of a race that somebody else created", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			_, format := race(t, app, fx)
			return map[string]any{"format_id": format.Id, "price_eur": 12}, func() bool {
				return storedRecord(t, app, "formats", format.Id).GetFloat("price_eur") == 12
			}
		}, nil)...)

	rows = append(rows, eachPerson("delete_format", "a format of a race of Alice", true, false, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, format := race(t, app, fx)
			create(t, app, "formats", map[string]any{"event": event.Id, "race_type": fx.Trail.Id, "distance_km": 30})
			return map[string]any{"format_id": format.Id}, func() bool { return storedRecord(t, app, "formats", format.Id) == nil }
		},
		func(args map[string]any) (string, string, string) {
			return http.MethodDelete, "/api/collections/formats/records/" + args["format_id"].(string), ""
		})...)

	return rows
}

func participationToolRows() []ruleRow {
	var rows []ruleRow

	// Anybody adds anybody.
	rows = append(rows, eachPerson("add_participation", "Sam, who has no account", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			format := racePast(t, app, fx)
			return map[string]any{"runner": "Sam", "format_id": format.Id, "status": "interested"}, func() bool {
				return participationOf(t, app, fx.SamRunner, format) != nil
			}
		}, nil)...)

	rows = append(rows, participationRows("update_participation",
		func(p *core.Record) map[string]any { return map[string]any{"participation_id": p.Id, "status": "dns"} },
		func(t testing.TB, app core.App, p *core.Record) bool {
			status, _ := storedStatus(t, app, p)
			return status == "dns"
		},
		participationSite(http.MethodPatch, `{"status":"dns"}`))...)

	rows = append(rows, participationRows("remove_participation",
		func(p *core.Record) map[string]any { return map[string]any{"participation_id": p.Id} },
		func(t testing.TB, app core.App, p *core.Record) bool {
			return storedRecord(t, app, "participations", p.Id) == nil
		},
		participationSite(http.MethodDelete, ""))...)

	rows = append(rows, participationRows("set_result",
		func(p *core.Record) map[string]any {
			return map[string]any{"participation_id": p.Id, "status": "finished", "finish_time": "1:00:00"}
		},
		func(t testing.TB, app core.App, p *core.Record) bool {
			stored := storedRecord(t, app, "participations", p.Id)
			return stored != nil && stored.GetInt("finish_time_s") == 3600
		},
		participationSite(http.MethodPatch, `{"status":"finished","finish_time_s":3600}`))...)

	return rows
}

// The people of the table, as runners; Sam has no account, so nobody of the table
// is the owner of what Sam offers.
var rulePeople = map[string]func(fx testutil.Fixture) *core.Record{
	"Alice": func(fx testutil.Fixture) *core.Record { return fx.AliceRunner },
	"Bob":   func(fx testutil.Fixture) *core.Record { return fx.BobRunner },
	"Admin": func(fx testutil.Fixture) *core.Record { return fx.AdminRunner },
	"Sam":   func(fx testutil.Fixture) *core.Record { return fx.SamRunner },
}

// forEachPerson is a call by Alice, Bob and the admin, where what the call is
// about depends on the person (build gets the name of the person: Alice, Bob or
// Admin). allowed says what the site gives each of them.
func forEachPerson(tool, what string, allowed map[string]bool, build func(person string) (prepareRow, siteRequest)) []ruleRow {
	var rows []ruleRow
	for _, person := range []string{"Alice", "Bob", "Admin"} {
		prepare, site := build(person)
		rows = append(rows, ruleRow{tool: tool, what: what, person: person, allowed: allowed[person], prepare: prepare, site: site})
	}
	return rows
}

// ruleAuthors are the two authors of the comments of the table.
var ruleAuthors = []string{"Alice", "Bob"}

// commentToolRows are the rows of the comments: anybody comments; only the author
// edits (not even an admin); the author and the admins delete.
func commentToolRows() []ruleRow {
	var rows []ruleRow

	rows = append(rows, eachPerson("add_comment", "a race", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, _ := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
			return map[string]any{"event_id": event.Id, "body": "Courage !"}, func() bool {
				found, err := app.FindAllRecords("comments", dbx.HashExp{"event": event.Id})
				return err == nil && len(found) == 1 && found[0].GetString("body") == "Courage !"
			}
		}, nil)...)

	// by says what each of the three may do with a comment that an author wrote.
	by := func(tool string, allowed map[string]map[string]bool, args func(c *core.Record) map[string]any, written func(t testing.TB, app core.App, c *core.Record) bool, site siteRequest) {
		for _, author := range ruleAuthors {
			rows = append(rows, eachPerson(tool, "a comment of "+author, allowed[author]["Alice"], allowed[author]["Bob"], allowed[author]["Admin"],
				func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
					event, _ := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
					c := commentOn(t, app, event, rulePeople[author](fx), "Un mot de "+author+".")
					return args(c), func() bool { return written(t, app, c) }
				}, site)...)
		}
	}
	commentSite := func(method, body string) siteRequest {
		return func(args map[string]any) (string, string, string) {
			return method, "/api/collections/comments/records/" + args["comment_id"].(string), body
		}
	}
	by("update_comment", map[string]map[string]bool{
		"Alice": {"Alice": true, "Bob": false, "Admin": false},
		"Bob":   {"Alice": false, "Bob": true, "Admin": false},
	},
		func(c *core.Record) map[string]any {
			return map[string]any{"comment_id": c.Id, "body": "Corrigé par la règle."}
		},
		func(t testing.TB, app core.App, c *core.Record) bool {
			return storedRecord(t, app, "comments", c.Id).GetString("body") == "Corrigé par la règle."
		},
		commentSite(http.MethodPatch, `{"body":"Corrigé par la règle."}`))
	by("delete_comment", map[string]map[string]bool{
		"Alice": {"Alice": true, "Bob": false, "Admin": true},
		"Bob":   {"Alice": false, "Bob": true, "Admin": true},
	},
		func(c *core.Record) map[string]any { return map[string]any{"comment_id": c.Id} },
		func(t testing.TB, app core.App, c *core.Record) bool {
			return storedRecord(t, app, "comments", c.Id) == nil
		},
		commentSite(http.MethodDelete, ""))
	return rows
}

// offerToolRows are the rows of the rides and the lodgings: anybody offers; the
// owner and the admins change and delete an offer; a place is taken or freed by
// its runner, by the owner of the offer (for anybody) and by the admins.
func offerToolRows() []ruleRow {
	var rows []ruleRow

	rows = append(rows, eachPerson("add_offer", "a race", true, true, true,
		func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
			event, _ := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
			return map[string]any{"event_id": event.Id, "kind": "ride", "place": "Lyon", "seats": 3}, func() bool {
				found, err := app.FindAllRecords("offers", dbx.HashExp{"event": event.Id})
				return err == nil && len(found) == 1
			}
		}, nil)...)

	// owned says what each person may do with an offer that an owner made.
	owned := func(tool string, allowed map[string]map[string]bool, args func(o *core.Record) map[string]any, written func(t testing.TB, app core.App, o *core.Record) bool, site siteRequest) {
		for _, owner := range ruleAuthors {
			rows = append(rows, eachPerson(tool, "a ride of "+owner, allowed[owner]["Alice"], allowed[owner]["Bob"], allowed[owner]["Admin"],
				func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
					event, _ := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
					o := rideOf(t, app, event, rulePeople[owner](fx))
					return args(o), func() bool { return written(t, app, o) }
				}, site)...)
		}
	}
	offerSite := func(method, body string) siteRequest {
		return func(args map[string]any) (string, string, string) {
			return method, "/api/collections/offers/records/" + args["offer_id"].(string), body
		}
	}
	changes := map[string]map[string]bool{
		"Alice": {"Alice": true, "Bob": false, "Admin": true},
		"Bob":   {"Alice": false, "Bob": true, "Admin": true},
	}
	owned("update_offer", changes,
		func(o *core.Record) map[string]any { return map[string]any{"offer_id": o.Id, "place": "Villeurbanne"} },
		func(t testing.TB, app core.App, o *core.Record) bool {
			return storedRecord(t, app, "offers", o.Id).GetString("place") == "Villeurbanne"
		},
		offerSite(http.MethodPatch, `{"place":"Villeurbanne"}`))
	owned("delete_offer", changes,
		func(o *core.Record) map[string]any { return map[string]any{"offer_id": o.Id} },
		func(t testing.TB, app core.App, o *core.Record) bool {
			return storedRecord(t, app, "offers", o.Id) == nil
		},
		offerSite(http.MethodDelete, ""))

	// A place: the offer of an owner, and the runner that the place is for. A call
	// names the runner (name "" for the person's own, whom the tool finds).
	type placeCase struct {
		what  string
		owner string
		// runner is whose place it is.
		runner string
		// named is whether the call names the runner, or leaves it to the tool.
		named   bool
		allowed map[string]bool
	}
	place := func(action string, c placeCase) {
		rows = append(rows, forEachPerson("offer_place", action+": "+c.what, c.allowed, func(person string) (prepareRow, siteRequest) {
			var runnerID, seatID string
			prepare := func(t *testing.T, app core.App, fx testutil.Fixture) (map[string]any, func() bool) {
				event, _ := newRace(t, app, fx, fx.AliceRunner, ruleRaceName(), "2026-03-07")
				ride := rideOf(t, app, event, rulePeople[c.owner](fx))
				name := c.runner
				if name == "self" {
					name = person
				}
				who := rulePeople[name](fx)
				runnerID = who.Id
				args := map[string]any{"offer_id": ride.Id, "action": action}
				if c.named {
					args["runner"] = who.Id
				}
				if action == "take" {
					return args, func() bool { return seatOf(t, app, ride, who) != nil }
				}
				seat := seatFor(t, app, ride, who, fx.AdminRunner)
				seatID = seat.Id
				return args, func() bool { return storedRecord(t, app, "offer_members", seat.Id) == nil }
			}
			site := func(args map[string]any) (string, string, string) {
				if action == "take" {
					return http.MethodPost, "/api/collections/offer_members/records", fmt.Sprintf(`{"offer":%q,"runner":%q}`, args["offer_id"], runnerID)
				}
				return http.MethodDelete, "/api/collections/offer_members/records/" + seatID, ""
			}
			return prepare, site
		})...)
	}
	// Taking a place. The owner of a ride never takes one in it (the hooks
	// refuse it, whatever the rule says): Alice, for herself, in her own ride.
	place("take", placeCase{"for oneself, in the ride of Alice", "Alice", "self", false, map[string]bool{"Alice": false, "Bob": true, "Admin": true}})
	place("take", placeCase{"for oneself, in the ride of Sam", "Sam", "self", false, map[string]bool{"Alice": true, "Bob": true, "Admin": true}})
	place("take", placeCase{"for Sam, in the ride of Alice", "Alice", "Sam", true, map[string]bool{"Alice": true, "Bob": false, "Admin": true}})
	place("take", placeCase{"for Sam, in the ride of Bob", "Bob", "Sam", true, map[string]bool{"Alice": false, "Bob": true, "Admin": true}})
	// Freeing a place.
	place("free", placeCase{"one's own, in the ride of Sam", "Sam", "self", false, map[string]bool{"Alice": true, "Bob": true, "Admin": true}})
	place("free", placeCase{"the place of Bob, in the ride of Alice", "Alice", "Bob", true, map[string]bool{"Alice": true, "Bob": true, "Admin": true}})
	place("free", placeCase{"the place of Sam, in the ride of Alice", "Alice", "Sam", true, map[string]bool{"Alice": true, "Bob": false, "Admin": true}})
	place("free", placeCase{"the place of Sam, in the ride of Bob", "Bob", "Sam", true, map[string]bool{"Alice": false, "Bob": true, "Admin": true}})
	return rows
}

// ruleRows is every row. A task that adds write tools adds its own here.
var ruleRows = func() []ruleRow {
	var rows []ruleRow
	rows = append(rows, eventRows()...)
	rows = append(rows, participationToolRows()...)
	rows = append(rows, commentToolRows()...)
	rows = append(rows, offerToolRows()...)
	return rows
}()

// callThrough calls a tool and, when it asks for a confirmation, calls it again
// with the token, as an assistant does once the person agrees. It returns the
// last answer.
func callThrough(t *testing.T, app *tests.TestApp, token, tool string, args map[string]any) toolResult {
	t.Helper()
	first := callTool(t, app, token, tool, args)
	if first.IsError {
		return first
	}
	if done, _ := first.Structured["done"].(bool); done {
		return first
	}
	confirmation, _ := first.Structured["confirmation"].(map[string]any)
	given, _ := confirmation["token"].(string)
	if given == "" {
		t.Fatalf("%s: not done, and no confirmation: %.300s", tool, redact(first.Text))
	}
	return callTool(t, app, token, tool, with(args, given))
}

// siteRefuses checks that the site refuses a request to the person: a rule that
// fails is a 404 for an update and a deletion, and a 400 for a creation.
func siteRefuses(t *testing.T, app *tests.TestApp, user *core.Record, method, path, body string) {
	t.Helper()
	refusedStatus := http.StatusNotFound
	if method == http.MethodPost {
		refusedStatus = http.StatusBadRequest
	}
	var reader io.Reader
	if body != "" {
		reader = strings.NewReader(body)
	}
	(&tests.ApiScenario{
		Method:         method,
		URL:            path,
		Body:           reader,
		Headers:        map[string]string{"Authorization": testutil.Token(t, user), "Content-Type": "application/json"},
		ExpectedStatus: refusedStatus,
		// A text that no answer can contain: an answer is expected, whatever it holds.
		NotExpectedContent:    []string{"\x00"},
		TestAppFactory:        func(testing.TB) *tests.TestApp { return app },
		DisableTestAppCleanup: true,
	}).Test(t)
}

func TestTools_FollowTheRulesOfTheOwner(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)
	writeFast(app)
	mcp.SetNow(t, at(2026, 5, 1, 10, 0))
	people := map[string]struct {
		token string
		user  *core.Record
	}{
		"Alice": {newToken(t, app, fx.Alice), fx.Alice},
		"Bob":   {newToken(t, app, fx.Bob), fx.Bob},
		"Admin": {newToken(t, app, fx.Admin), fx.Admin},
	}

	// The table covers every write tool of the races, the formats, the
	// participations, the comments and the offers, for the three people.
	covered := map[string]map[string]bool{}
	for _, row := range ruleRows {
		if covered[row.tool] == nil {
			covered[row.tool] = map[string]bool{}
		}
		covered[row.tool][row.person] = true
	}
	for _, tool := range []string{
		"create_event", "update_event", "delete_event", "add_format", "update_format", "delete_format",
		"add_participation", "update_participation", "remove_participation", "set_result",
		"add_comment", "update_comment", "delete_comment", "add_offer", "update_offer", "delete_offer", "offer_place",
	} {
		for _, person := range []string{"Alice", "Bob", "Admin"} {
			if !covered[tool][person] {
				t.Errorf("no row for %s by %s", tool, person)
			}
		}
	}

	for _, row := range ruleRows {
		name := row.tool + " / " + row.what + " / " + row.person
		if row.allowed {
			name += " / allowed"
		} else {
			name += " / refused"
		}
		t.Run(name, func(t *testing.T) {
			person := people[row.person]
			args, written := row.prepare(t, app, fx)
			before := dbState(t, app)

			result := callThrough(t, app, person.token, row.tool, args)
			done, _ := result.Structured["done"].(bool)
			ok := !result.IsError && done

			switch {
			case row.allowed && !ok:
				t.Errorf("the site gives %s the write, and the tool answered %.300s", row.person, redact(result.Text))
			case row.allowed && !written():
				t.Errorf("the tool answered that it was done, and the write is not in the database")
			case !row.allowed && ok:
				t.Errorf("the site refuses %s, and the tool answered that it was done", row.person)
			case !row.allowed && written():
				t.Errorf("the site refuses %s, and the write is in the database", row.person)
			case !row.allowed:
				if after := dbState(t, app); after != before {
					t.Errorf("the site refuses %s, and the database changed:\nbefore\n%s\nafter\n%s", row.person, before, after)
				}
				// The site says the same to the same person.
				if row.site != nil {
					method, path, body := row.site(args)
					siteRefuses(t, app, person.user, method, path, body)
				}
			}
		})
	}
}
