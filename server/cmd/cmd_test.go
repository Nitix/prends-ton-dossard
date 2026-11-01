package cmd_test

import (
	"bytes"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"ganigeorgiev.com/pocketbase/dbx"
	"ganigeorgiev.com/pocketbase/pocketbase/core"

	"courses/server/cmd"
	"courses/server/config"
	"courses/server/invitations"
	"courses/server/testutil"
)

const appURL = "http://localhost:5173"

// testConfig is the configuration of testutil.NewApp.
func testConfig(t testing.TB) config.Config {
	t.Helper()
	cfg, err := config.Load(func(key string) string {
		if key == "APP_URL" {
			return appURL
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// tokenOf returns the token of an invitation URL, which is its fragment.
func tokenOf(t testing.TB, url string) string {
	t.Helper()
	prefix := appURL + "/invitation#"
	if !strings.HasPrefix(url, prefix) {
		t.Fatalf("URL = %q, want it to start with %q", url, prefix)
	}
	token := strings.TrimPrefix(url, prefix)
	if token == "" {
		t.Fatalf("URL %q has no token", url)
	}
	return token
}

func count(t testing.TB, app core.App, collection string) int {
	t.Helper()
	n, err := app.CountRecords(collection)
	if err != nil {
		t.Fatal(err)
	}
	return int(n)
}

// ---------------------------------------------------------------------------
// bootstrap-admin

func TestBootstrapAdmin_First(t *testing.T) {
	app := testutil.NewApp(t)

	url, err := cmd.BootstrapAdmin(app, appURL, "Guillaume", false)
	if err != nil {
		t.Fatal(err)
	}
	token := tokenOf(t, url)

	runner, err := app.FindFirstRecordByData("runners", "name", "Guillaume")
	if err != nil {
		t.Fatalf("the runner Guillaume does not exist: %v", err)
	}
	if runner.GetString("user") != "" {
		t.Errorf("the runner already has an account")
	}

	inv, invRunner, err := invitations.Find(app, token)
	if err != nil {
		t.Fatalf("the link does not lead to an invitation: %v", err)
	}
	if invRunner.Id != runner.Id {
		t.Errorf("the invitation is for runner %s, want %s", invRunner.Id, runner.Id)
	}
	if got := inv.GetString("kind"); got != string(invitations.KindInvite) {
		t.Errorf("kind = %q, want %q", got, invitations.KindInvite)
	}
	if got := inv.GetString("role"); got != "admin" {
		t.Errorf("role = %q, want admin", got)
	}
	if got := inv.GetString("created_by"); got != "" {
		t.Errorf("created_by = %q, want none: nobody is signed in", got)
	}
}

func TestBootstrapAdmin_RefusesWhenAdminExists(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)
	runners, invites := count(t, app, "runners"), count(t, app, "invitations")

	if _, err := cmd.BootstrapAdmin(app, appURL, "Nouveau", false); err == nil {
		t.Fatal("an admin exists and force is false: want an error")
	}
	if got := count(t, app, "runners"); got != runners {
		t.Errorf("a refused command created a runner: %d runners, want %d", got, runners)
	}
	if got := count(t, app, "invitations"); got != invites {
		t.Errorf("a refused command created an invitation: %d, want %d", got, invites)
	}

	url, err := cmd.BootstrapAdmin(app, appURL, "Nouveau", true)
	if err != nil {
		t.Fatalf("with force: %v", err)
	}
	inv, _, err := invitations.Find(app, tokenOf(t, url))
	if err != nil {
		t.Fatal(err)
	}
	if got := inv.GetString("role"); got != "admin" {
		t.Errorf("role = %q, want admin", got)
	}
}

func TestBootstrapAdmin_ReusesTheRunnerWhateverTheCase(t *testing.T) {
	app := testutil.NewApp(t)
	fx := testutil.Seed(t, app)

	// Sam exists without account.
	url, err := cmd.BootstrapAdmin(app, appURL, "  sAM ", true)
	if err != nil {
		t.Fatal(err)
	}
	if _, runner, err := invitations.Find(app, tokenOf(t, url)); err != nil {
		t.Fatal(err)
	} else if runner.Id != fx.SamRunner.Id {
		t.Errorf("the invitation is for runner %s, want Sam (%s)", runner.Id, fx.SamRunner.Id)
	}
	if got := count(t, app, "runners"); got != 4 {
		t.Errorf("%d runners, want the 4 of the fixture: Sam must not be created again", got)
	}
}

func TestBootstrapAdmin_RefusesARunnerThatHasAnAccount(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)
	invites := count(t, app, "invitations")

	if _, err := cmd.BootstrapAdmin(app, appURL, "alice", true); err == nil {
		t.Fatal("Alice has an account: want an error")
	}
	if got := count(t, app, "invitations"); got != invites {
		t.Errorf("an invitation was created: %d, want %d", got, invites)
	}
}

func TestBootstrapAdmin_RefusesAnEmptyName(t *testing.T) {
	app := testutil.NewApp(t)

	if _, err := cmd.BootstrapAdmin(app, appURL, "   ", false); err == nil {
		t.Fatal("a blank name: want an error")
	}
	if got := count(t, app, "runners"); got != 0 {
		t.Errorf("%d runners, want none", got)
	}
}

func TestBootstrapAdmin_RollsBackTheRunnerWhenTheInvitationFails(t *testing.T) {
	app := testutil.NewApp(t)
	app.OnRecordCreate("invitations").BindFunc(func(*core.RecordEvent) error {
		return errors.New("the invitation cannot be saved")
	})

	if _, err := cmd.BootstrapAdmin(app, appURL, "Guillaume", false); err == nil {
		t.Fatal("the invitation cannot be saved: want an error")
	}
	if got := count(t, app, "runners"); got != 0 {
		t.Errorf("%d runners, want none: the runner must not outlive the failed command", got)
	}
}

func TestBootstrapAdminCommand_PrintsOnlyTheURL(t *testing.T) {
	app := testutil.NewApp(t)
	command := cmd.NewBootstrapAdminCommand(app, testConfig(t))
	var out bytes.Buffer
	command.SetOut(&out)
	command.SetArgs([]string{"Moi"})

	if err := command.Execute(); err != nil {
		t.Fatal(err)
	}

	// The end-to-end tests read the URL with /Invitation URL: (\S+)/.
	want := regexp.MustCompile(`\AInvitation URL: ` + regexp.QuoteMeta(appURL) + `/invitation#\S+\n\z`)
	if !want.MatchString(out.String()) {
		t.Fatalf("stdout = %q, want one line matching %s", out.String(), want)
	}
	if _, err := app.FindFirstRecordByData("runners", "name", "Moi"); err != nil {
		t.Errorf("the runner Moi does not exist: %v", err)
	}
}

func TestBootstrapAdminCommand_Arguments(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)

	for name, args := range map[string][]string{
		"no name":         {},
		"two names":       {"Moi", "Toi"},
		"admin, no force": {"Moi"},
	} {
		t.Run(name, func(t *testing.T) {
			command := cmd.NewBootstrapAdminCommand(app, testConfig(t))
			var out bytes.Buffer
			command.SetOut(&out)
			command.SetArgs(args)
			if err := command.Execute(); err == nil {
				t.Fatal("want an error")
			}
			if out.Len() != 0 {
				t.Errorf("stdout = %q, want nothing: only the URL goes there", out.String())
			}
		})
	}

	t.Run("force", func(t *testing.T) {
		command := cmd.NewBootstrapAdminCommand(app, testConfig(t))
		var out bytes.Buffer
		command.SetOut(&out)
		command.SetArgs([]string{"Moi", "--force"})
		if err := command.Execute(); err != nil {
			t.Fatal(err)
		}
		if !strings.HasPrefix(out.String(), "Invitation URL: "+appURL+"/invitation#") {
			t.Errorf("stdout = %q", out.String())
		}
	})
}

// ---------------------------------------------------------------------------
// seed

const demoPassword = "demo-password-123"

func day(t time.Time) string { return t.Format("2006-01-02") }

func TestSeedDemo(t *testing.T) {
	app := testutil.NewApp(t)
	today := time.Date(2026, time.October, 31, 15, 4, 5, 0, time.UTC)

	if err := cmd.SeedDemo(app, demoPassword, today); err != nil {
		t.Fatal(err)
	}

	if got := count(t, app, "users"); got != 3 {
		t.Errorf("%d accounts, want 3", got)
	}
	if got := count(t, app, "runners"); got != 5 {
		t.Errorf("%d runners, want 5", got)
	}
	if got := count(t, app, "events"); got != 6 {
		t.Errorf("%d events, want 6", got)
	}

	// The accounts: one admin, two members, who sign in with the password.
	roles := map[string]string{
		"admin@example.test": "admin",
		"alice@example.test": "member",
		"bob@example.test":   "member",
	}
	for email, role := range roles {
		user, err := app.FindAuthRecordByEmail("users", email)
		if err != nil {
			t.Fatalf("%s: %v", email, err)
		}
		if got := user.GetString("role"); got != role {
			t.Errorf("%s has the role %q, want %q", email, got, role)
		}
		if !user.ValidatePassword(demoPassword) {
			t.Errorf("%s does not have the given password", email)
		}
		if user.GetBool("disabled") {
			t.Errorf("%s is disabled", email)
		}
		runner, err := app.FindFirstRecordByData("runners", "user", user.Id)
		if err != nil {
			t.Errorf("%s has no runner: %v", email, err)
		} else if runner.GetString("name") == "" {
			t.Errorf("the runner of %s has no name", email)
		}
	}

	// Sam and Julie have no account.
	for _, name := range []string{"Sam", "Julie"} {
		runner, err := app.FindFirstRecordByData("runners", "name", name)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if runner.GetString("user") != "" {
			t.Errorf("%s has an account", name)
		}
	}

	events, err := app.FindAllRecords("events")
	if err != nil {
		t.Fatal(err)
	}
	var upcoming, past, overMonths int
	for _, event := range events {
		start, end := event.GetString("start_date"), event.GetString("end_date")
		last := start
		if end != "" {
			last = end
		}
		switch {
		case start >= day(today):
			upcoming++
			// The next three months.
			if limit := day(today.AddDate(0, 3, 0)); last > limit {
				t.Errorf("%q ends on %s, after %s", event.GetString("name"), last, limit)
			}
		case last < day(today):
			past++
		default:
			t.Errorf("%q (%s to %s) is neither upcoming nor past", event.GetString("name"), start, last)
		}
		if end != "" && start[:7] != end[:7] {
			overMonths++
			if start < day(today) {
				t.Errorf("%q, over two months, has already started", event.GetString("name"))
			}
		}
		if event.GetString("created_by") == "" {
			t.Errorf("%q has no creator", event.GetString("name"))
		}
	}
	if upcoming != 4 || past != 2 {
		t.Errorf("%d upcoming and %d past events, want 4 and 2", upcoming, past)
	}
	if overMonths < 1 {
		t.Error("no event is over two months")
	}

	checkFormats(t, app)
	checkParticipations(t, app)
	checkRegistration(t, app, today)
	checkSupporter(t, app)
	checkComments(t, app, today)
	checkOffers(t, app, today)
	checkResults(t, app)

	// A second call is refused, and leaves the data as it is.
	if err := cmd.SeedDemo(app, demoPassword, today); err == nil {
		t.Fatal("second call: want an error")
	}
	if got := count(t, app, "users"); got != 3 {
		t.Errorf("%d accounts after the second call, want 3", got)
	}
	if got := count(t, app, "events"); got != 6 {
		t.Errorf("%d events after the second call, want 6", got)
	}
}

// checkRegistration checks the deadline of two events and the price of three
// formats: the Trail des Crêtes closes in five days and the Hyrox Lyon in forty.
func checkRegistration(t *testing.T, app core.App, today time.Time) {
	t.Helper()
	deadlineOf := func(event string) string {
		t.Helper()
		record, err := app.FindFirstRecordByData("events", "name", event)
		if err != nil {
			t.Fatal(err)
		}
		return record.GetString("registration_deadline")
	}
	priceOf := func(format string) float64 {
		t.Helper()
		record, err := app.FindFirstRecordByData("formats", "name", format)
		if err != nil {
			t.Fatal(err)
		}
		return record.GetFloat("price_eur")
	}

	if got, want := deadlineOf("Trail des Crêtes"), day(today.AddDate(0, 0, 5)); got != want {
		t.Errorf("the deadline of the Trail des Crêtes is %q, want %q", got, want)
	}
	if got, want := deadlineOf("Hyrox Lyon"), day(today.AddDate(0, 0, 40)); got != want {
		t.Errorf("the deadline of the Hyrox Lyon is %q, want %q", got, want)
	}
	for format, want := range map[string]float64{"Trail long": 65, "Trail court": 30, "Hyrox Open": 89.5} {
		if got := priceOf(format); got != want {
			t.Errorf("the price of %q is %v, want %v", format, got, want)
		}
	}
}

// checkSupporter checks that Sam comes to cheer at the Backyard des Aiguilles,
// added by Bob: the participation is to the event, without a format, and Sam
// has not confirmed it.
func checkSupporter(t *testing.T, app core.App) {
	t.Helper()
	runnerID := func(name string) string {
		t.Helper()
		record, err := app.FindFirstRecordByData("runners", "name", name)
		if err != nil {
			t.Fatal(err)
		}
		return record.Id
	}
	event, err := app.FindFirstRecordByData("events", "name", "Backyard des Aiguilles")
	if err != nil {
		t.Fatal(err)
	}

	supporters, err := app.FindAllRecords("participations", dbx.HashExp{"status": "supporter"})
	if err != nil {
		t.Fatal(err)
	}
	if len(supporters) != 1 {
		t.Fatalf("%d supporters, want 1", len(supporters))
	}
	p := supporters[0]
	if p.GetString("runner") != runnerID("Sam") || p.GetString("event") != event.Id {
		t.Errorf("the supporter is runner %q in event %q, want Sam in the Backyard des Aiguilles", p.GetString("runner"), p.GetString("event"))
	}
	if p.GetString("format") != "" {
		t.Errorf("the supporter is on the format %q, want none", p.GetString("format"))
	}
	if p.GetString("added_by") != runnerID("Bob") || p.GetBool("confirmed") {
		t.Errorf("the supporter was added by %q and confirmed = %v, want Bob and false", p.GetString("added_by"), p.GetBool("confirmed"))
	}
}

// checkComments checks the two comments of the demo: Alice then Bob write on
// the Trail des Crêtes, in the days before today, and each one is by the runner
// the request would have given as its author.
func checkComments(t *testing.T, app core.App, today time.Time) {
	t.Helper()
	event, err := app.FindFirstRecordByData("events", "name", "Trail des Crêtes")
	if err != nil {
		t.Fatal(err)
	}
	if got := count(t, app, "comments"); got != 2 {
		t.Fatalf("%d comments, want 2", got)
	}
	comments, err := app.FindRecordsByFilter("comments", "event = {:event}", "created", 0, 0, dbx.Params{"event": event.Id})
	if err != nil {
		t.Fatal(err)
	}
	if len(comments) != 2 {
		t.Fatalf("%d comments on the Trail des Crêtes, want 2", len(comments))
	}

	for i, name := range []string{"Alice", "Bob"} {
		c := comments[i]
		author, err := app.FindRecordById("runners", c.GetString("author"))
		if err != nil {
			t.Fatalf("the author of the comment %d: %v", i+1, err)
		}
		if author.GetString("name") != name {
			t.Errorf("the comment %d is by %s, want %s (Alice, then Bob)", i+1, author.GetString("name"), name)
		}
		if author.GetString("user") == "" {
			t.Errorf("the comment %d is by %s, who has no account", i+1, name)
		}
		if body := c.GetString("body"); body == "" || body != strings.TrimSpace(body) {
			t.Errorf("the comment %d has the text %q, want one without spaces around it", i+1, body)
		}
		if created := c.GetDateTime("created").Time(); !created.Before(today) {
			t.Errorf("the comment %d was written on %s, want before today %s", i+1, created, today)
		}
		// The front shows "edited" when the two dates differ: a comment that
		// was never changed must not.
		if created, updated := c.GetDateTime("created"), c.GetDateTime("updated"); !created.Time().Equal(updated.Time()) {
			t.Errorf("the comment %d was created at %s and updated at %s, want the same date (it was never edited)", i+1, created, updated)
		}
	}
	if first, second := comments[0].GetDateTime("created"), comments[1].GetDateTime("created"); !first.Time().Before(second.Time()) {
		t.Errorf("the comments were written at %s then %s, want the first before the second", first, second)
	}
}

// checkOffers checks the two offers of the demo, on the Trail des Crêtes: a car
// of Bob, who leaves from Lyon the evening before the race, with Alice in it,
// and a lodging of Alice, from the day before to the day after, with Bob in it.
func checkOffers(t *testing.T, app core.App, today time.Time) {
	t.Helper()
	event, err := app.FindFirstRecordByData("events", "name", "Trail des Crêtes")
	if err != nil {
		t.Fatal(err)
	}
	runnerName := func(id string) string {
		t.Helper()
		runner, err := app.FindRecordById("runners", id)
		if err != nil {
			t.Fatal(err)
		}
		return runner.GetString("name")
	}
	if got := count(t, app, "offers"); got != 2 {
		t.Fatalf("%d offers, want 2", got)
	}
	if got := count(t, app, "offer_members"); got != 2 {
		t.Fatalf("%d places, want 2", got)
	}

	// The race is in nine days.
	raceDay := today.AddDate(0, 0, 9)
	for _, want := range []struct {
		kind, owner, place, member, addedBy string
		seats                               int
		date, time, endDate                 string
	}{
		{"ride", "Bob", "Lyon, Part-Dieu", "Alice", "Alice", 3, day(raceDay.AddDate(0, 0, -1)), "18:00", ""},
		{"lodging", "Alice", "Gîte des Crêtes", "Bob", "Alice", 4, day(raceDay.AddDate(0, 0, -1)), "", day(raceDay.AddDate(0, 0, 1))},
	} {
		offers, err := app.FindAllRecords("offers", dbx.HashExp{"event": event.Id, "kind": want.kind})
		if err != nil {
			t.Fatal(err)
		}
		if len(offers) != 1 {
			t.Fatalf("%d offers of the kind %s on the Trail des Crêtes, want 1", len(offers), want.kind)
		}
		o := offers[0]
		if got := runnerName(o.GetString("owner")); got != want.owner {
			t.Errorf("the %s is offered by %s, want %s", want.kind, got, want.owner)
		}
		if o.GetString("place") != want.place || o.GetInt("seats") != want.seats {
			t.Errorf("the %s is %q with %d seats, want %q with %d", want.kind, o.GetString("place"), o.GetInt("seats"), want.place, want.seats)
		}
		if o.GetString("date") != want.date || o.GetString("time") != want.time || o.GetString("end_date") != want.endDate {
			t.Errorf("the %s is on %q at %q until %q, want %q at %q until %q", want.kind,
				o.GetString("date"), o.GetString("time"), o.GetString("end_date"), want.date, want.time, want.endDate)
		}

		// One person in it, other than the owner. Alice took her place in the
		// car of Bob herself, and put Bob in her lodging: the one who added a
		// place is the one the request would have given.
		places, err := app.FindAllRecords("offer_members", dbx.HashExp{"offer": o.Id})
		if err != nil {
			t.Fatal(err)
		}
		if len(places) != 1 {
			t.Fatalf("%d places in the %s, want 1", len(places), want.kind)
		}
		if got := runnerName(places[0].GetString("runner")); got != want.member {
			t.Errorf("the place of the %s is for %s, want %s", want.kind, got, want.member)
		}
		if got := runnerName(places[0].GetString("added_by")); got != want.addedBy {
			t.Errorf("the place of the %s was added by %s, want %s", want.kind, got, want.addedBy)
		}
	}
}

// checkResults checks the results of the Semi-marathon d'Annecy, which is over:
// Alice, Bob and Julie finished it, each with the result that the demo gives
// them (the time, and the rank or the note when there is one), and Sam gave up
// with a note and no time, as the hook of the participations clears it.
func checkResults(t *testing.T, app core.App) {
	t.Helper()
	format, err := app.FindFirstRecordByData("formats", "name", "Semi-marathon")
	if err != nil {
		t.Fatal(err)
	}

	for _, want := range []struct {
		runner, status string
		timeS          int // 1 h 52 min 10 s is 6730
		rank, rankOf   int
		note           string
	}{
		{"Alice", "finished", 6730, 412, 1830, ""},
		{"Bob", "finished", 7500, 0, 0, ""},
		{"Julie", "finished", 6423, 0, 0, "3e V1F"},
		{"Sam", "dnf", 0, 0, 0, "crampes au km 15"},
	} {
		runner, err := app.FindFirstRecordByData("runners", "name", want.runner)
		if err != nil {
			t.Fatal(err)
		}
		p, err := app.FindFirstRecordByFilter("participations", "runner = {:runner} && format = {:format}",
			dbx.Params{"runner": runner.Id, "format": format.Id})
		if err != nil {
			t.Fatalf("the participation of %s in the Semi-marathon: %v", want.runner, err)
		}
		if p.GetString("status") != want.status {
			t.Errorf("%s is %q in the Semi-marathon, want %q", want.runner, p.GetString("status"), want.status)
		}
		if p.GetInt("finish_time_s") != want.timeS || p.GetInt("rank") != want.rank || p.GetInt("rank_of") != want.rankOf || p.GetString("result_note") != want.note {
			t.Errorf("the result of %s is %d s, rank %d of %d, note %q; want %d s, rank %d of %d, note %q", want.runner,
				p.GetInt("finish_time_s"), p.GetInt("rank"), p.GetInt("rank_of"), p.GetString("result_note"),
				want.timeS, want.rank, want.rankOf, want.note)
		}
	}
}

// checkFormats checks that the formats cover a backyard, a race against the
// clock and a Hyrox.
func checkFormats(t *testing.T, app core.App) {
	t.Helper()
	formats, err := app.FindAllRecords("formats")
	if err != nil {
		t.Fatal(err)
	}
	var backyard, timed, hyrox bool
	for _, format := range formats {
		raceType, err := app.FindRecordById("race_types", format.GetString("race_type"))
		if err != nil {
			t.Fatal(err)
		}
		label := raceType.GetString("label")
		backyard = backyard || (label == "Backyard" && format.GetInt("time_limit_min") == 2880)
		timed = timed || format.GetInt("duration_min") == 360
		hyrox = hyrox || (label == "Hyrox" && format.GetFloat("distance_km") == 8)
	}
	if !backyard {
		t.Error("no Backyard format with a time limit of 2880 minutes")
	}
	if !timed {
		t.Error("no race against the clock of 360 minutes")
	}
	if !hyrox {
		t.Error("no Hyrox format of 8 km")
	}
}

// checkParticipations checks that the six statuses are used, with and without
// confirmation, and that a participation is only confirmed by its own runner,
// as the API would have it.
func checkParticipations(t *testing.T, app core.App) {
	t.Helper()
	participations, err := app.FindAllRecords("participations")
	if err != nil {
		t.Fatal(err)
	}
	statuses := map[string]int{}
	confirmed := map[bool]int{}
	// A participation to an event only, without a format, in an event that has
	// at least two: it is how the demo shows "interested, format to be chosen".
	var undecided int
	for _, p := range participations {
		statuses[p.GetString("status")]++
		confirmed[p.GetBool("confirmed")]++

		if p.GetString("format") == "" {
			formats, err := app.CountRecords("formats", dbx.HashExp{"event": p.GetString("event")})
			if err != nil {
				t.Fatal(err)
			}
			if p.GetString("status") == "interested" && formats >= 2 {
				undecided++
			}
		}

		runner, addedBy := p.GetString("runner"), p.GetString("added_by")
		if addedBy == "" {
			t.Errorf("participation %s was added by nobody", p.Id)
		}
		if want := runner == addedBy; p.GetBool("confirmed") != want {
			t.Errorf("participation %s: confirmed = %v, want %v (runner %s, added by %s)",
				p.Id, p.GetBool("confirmed"), want, runner, addedBy)
		}
	}
	for _, status := range []string{"interested", "registered", "finished", "dnf", "dns", "supporter"} {
		if statuses[status] == 0 {
			t.Errorf("no participation is %q", status)
		}
	}
	if confirmed[true] == 0 || confirmed[false] == 0 {
		t.Errorf("confirmed participations: %d, unconfirmed: %d, want both", confirmed[true], confirmed[false])
	}
	if undecided == 0 {
		t.Error("no participation is interested in an event of at least two formats without a format")
	}
}

// The dates only depend on today, whatever the day of the month, and an event
// is always over two months.
func TestSeedDemo_RelativeToToday(t *testing.T) {
	for _, d := range []string{"2026-01-01", "2026-01-31", "2026-02-28", "2026-10-31", "2026-12-31", "2028-02-29"} {
		t.Run(d, func(t *testing.T) {
			today, err := time.Parse("2006-01-02", d)
			if err != nil {
				t.Fatal(err)
			}
			app := testutil.NewApp(t)
			if err := cmd.SeedDemo(app, demoPassword, today); err != nil {
				t.Fatal(err)
			}

			events, err := app.FindAllRecords("events")
			if err != nil {
				t.Fatal(err)
			}
			var upcoming, past, overMonths int
			for _, event := range events {
				start, end := event.GetString("start_date"), event.GetString("end_date")
				if start >= day(today) {
					upcoming++
				} else {
					past++
				}
				if end != "" && start[:7] != end[:7] {
					overMonths++
				}
			}
			if upcoming != 4 || past != 2 || overMonths < 1 {
				t.Errorf("%d upcoming, %d past, %d over two months; want 4, 2 and at least 1", upcoming, past, overMonths)
			}
		})
	}
}

func TestSeedDemo_RefusesWhenThereIsAnAccount(t *testing.T) {
	app := testutil.NewApp(t)
	testutil.Seed(t, app)
	events := count(t, app, "events")

	if err := cmd.SeedDemo(app, demoPassword, time.Now()); err == nil {
		t.Fatal("accounts exist: want an error")
	}
	if got := count(t, app, "events"); got != events {
		t.Errorf("%d events, want the %d that were there", got, events)
	}
}

func TestSeedDemo_LeavesNothingWhenItFails(t *testing.T) {
	app := testutil.NewApp(t)

	// A password that is too short is refused when the first account is saved:
	// the others are never reached, and nothing may remain.
	if err := cmd.SeedDemo(app, "short", time.Now()); err == nil {
		t.Fatal("a password of 5 characters: want an error")
	}
	for _, collection := range []string{"users", "runners", "events", "formats", "participations", "comments", "offers", "offer_members"} {
		if got := count(t, app, collection); got != 0 {
			t.Errorf("%d %s, want none", got, collection)
		}
	}
	// The failure must not make the next attempt impossible.
	if err := cmd.SeedDemo(app, demoPassword, time.Now()); err != nil {
		t.Fatalf("after a failure: %v", err)
	}
}

func TestSeedCommand_Password(t *testing.T) {
	signsIn := func(t *testing.T, app core.App, password string) {
		t.Helper()
		user, err := app.FindAuthRecordByEmail("users", "alice@example.test")
		if err != nil {
			t.Fatal(err)
		}
		if !user.ValidatePassword(password) {
			t.Errorf("alice@example.test does not have the password %q", password)
		}
	}
	seed := func(t *testing.T, args ...string) core.App {
		t.Helper()
		app := testutil.NewApp(t)
		command := cmd.NewSeedCommand(app, testConfig(t))
		var out bytes.Buffer
		command.SetOut(&out)
		command.SetArgs(args)
		if err := command.Execute(); err != nil {
			t.Fatal(err)
		}
		if got := count(t, app, "users"); got != 3 {
			t.Fatalf("%d accounts, want 3", got)
		}
		if strings.Contains(out.String(), "secret-from") {
			t.Errorf("the output shows the password: %q", out.String())
		}
		return app
	}

	t.Run("default", func(t *testing.T) {
		t.Setenv("SEED_PASSWORD", "")
		signsIn(t, seed(t), "courses-dev-password")
	})
	t.Run("environment", func(t *testing.T) {
		t.Setenv("SEED_PASSWORD", "secret-from-env")
		signsIn(t, seed(t), "secret-from-env")
	})
	t.Run("flag wins over the environment", func(t *testing.T) {
		t.Setenv("SEED_PASSWORD", "secret-from-env")
		signsIn(t, seed(t, "--password", "secret-from-flag"), "secret-from-flag")
	})
}

func TestSeedCommand_RefusesTwice(t *testing.T) {
	app := testutil.NewApp(t)
	for i, wantErr := range []bool{false, true} {
		command := cmd.NewSeedCommand(app, testConfig(t))
		command.SetOut(&bytes.Buffer{})
		command.SetArgs(nil)
		if err := command.Execute(); (err != nil) != wantErr {
			t.Fatalf("run %d: err = %v, want an error: %v", i+1, err, wantErr)
		}
	}
}

// configFor is the configuration of a program whose APP_URL is appURL.
func configFor(t testing.TB, appURL string) config.Config {
	t.Helper()
	cfg, err := config.Load(func(key string) string {
		if key == "APP_URL" {
			return appURL
		}
		return ""
	})
	if err != nil {
		t.Fatal(err)
	}
	return cfg
}

// The demo accounts have a published password: the command only fills the
// database of a program that runs on the machine of a developer, unless --force
// says otherwise.
func TestSeedCommand_OnlyOnLocalhost(t *testing.T) {
	for _, tc := range []struct {
		name, appURL string
		args         []string
		wantErr      bool
	}{
		{"localhost", "http://localhost:5173", nil, false},
		{"127.0.0.1", "http://127.0.0.1:8090", nil, false},
		{"the public site", "https://courses.example.fr", nil, true},
		{"a host that only starts like localhost", "https://localhost.example.fr", nil, true},
		{"the public site, forced", "https://courses.example.fr", []string{"--force"}, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("SEED_PASSWORD", "")
			app := testutil.NewApp(t)
			command := cmd.NewSeedCommand(app, configFor(t, tc.appURL))
			var out bytes.Buffer
			command.SetOut(&out)
			command.SetArgs(tc.args)

			err := command.Execute()

			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, want an error: %v", err, tc.wantErr)
			}
			want := 3
			if tc.wantErr {
				want = 0
				if !strings.Contains(err.Error(), "--force") {
					t.Errorf("the error %q does not say how to go on anyway", err)
				}
				if out.Len() != 0 {
					t.Errorf("stdout = %q, want nothing", out.String())
				}
			}
			if got := count(t, app, "users"); got != want {
				t.Errorf("%d accounts, want %d", got, want)
			}
		})
	}
}
