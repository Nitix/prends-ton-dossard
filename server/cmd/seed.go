package cmd

import (
	_ "embed"
	"errors"
	"fmt"
	"maps"
	"os"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/filesystem"
	"ganigeorgiev.com/pocketbase/pocketbase/tools/types"
	"github.com/spf13/cobra"

	"courses/server/config"
)

// seedTrack is the track of the 42 km of the Trail des Crêtes: a loop of about
// 42 km to the north of Annecy, with its altitudes, a point every 14.5 m (about
// 2,900 points, 2,300 m of climb), made once by a throwaway script and kept as it
// is.
//
//go:embed seed_track.gpx
var seedTrack []byte

const (
	// DefaultSeedPassword is the password of the demo accounts when neither
	// --password nor SEED_PASSWORD gives one.
	DefaultSeedPassword = "courses-dev-password"

	// dayLayout is the Go layout of a day, which is stored as YYYY-MM-DD text.
	dayLayout = "2006-01-02"
)

// The runners of the demo. The first three have an account.
const (
	runnerAdmin = "Admin"
	runnerAlice = "Alice"
	runnerBob   = "Bob"
	runnerSam   = "Sam"
	runnerJulie = "Julie"
)

// demoAccounts are the accounts of the demo, in the order they are created.
var demoAccounts = []struct{ email, role, runner string }{
	{"admin@example.test", "admin", runnerAdmin},
	{"alice@example.test", "member", runnerAlice},
	{"bob@example.test", "member", runnerBob},
}

// demoRunnersWithoutAccount join the demo without an account: somebody else
// adds them to the races they take part in.
var demoRunnersWithoutAccount = []string{runnerSam, runnerJulie}

// localHosts are the hosts of APP_URL on which seed runs without --force: the
// machine of a developer.
var localHosts = []string{"localhost", "127.0.0.1", "::1"}

// NewSeedCommand returns the command "seed [--password] [--force]": it fills an
// empty database with demo data, for development and the end-to-end tests. The
// password of the accounts is the one of --password, else the one of the
// environment variable SEED_PASSWORD, else DefaultSeedPassword.
//
// The binary that runs the site has the command too, and the default password
// is published: it refuses unless the host of APP_URL (cfg) is the machine
// itself, or --force is given.
func NewSeedCommand(app core.App, cfg config.Config) *cobra.Command {
	var (
		password string
		force    bool
	)

	command := &cobra.Command{
		Use:   "seed [--password] [--force]",
		Short: "Fill an empty database with demo accounts, events and participations",
		Long: "Fill an empty database with demo accounts, events and participations.\n" +
			"The password of the accounts is the value of --password, else of the\n" +
			"environment variable SEED_PASSWORD, else \"" + DefaultSeedPassword + "\".\n" +
			"It refuses to run unless APP_URL is on localhost, or --force is given.",
		Args:          cobra.NoArgs,
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(command *cobra.Command, _ []string) error {
			if !force && !slices.Contains(localHosts, cfg.RPID) {
				return fmt.Errorf("APP_URL is %s, not a local address: the demo accounts would be "+
					"on a real site (use --force to fill this database anyway)", cfg.AppURL)
			}

			secret, isDefault := password, false
			if !command.Flags().Changed("password") {
				if secret = os.Getenv("SEED_PASSWORD"); secret == "" {
					secret, isDefault = DefaultSeedPassword, true
				}
			}

			if err := app.RunAllMigrations(); err != nil {
				return fmt.Errorf("applying the migrations: %w", err)
			}
			if err := SeedDemo(app, secret, time.Now()); err != nil {
				return err
			}

			out := command.OutOrStdout()
			fmt.Fprintln(out, "Demo data created.")
			for _, account := range demoAccounts {
				fmt.Fprintf(out, "  %s (%s)\n", account.email, account.role)
			}
			if isDefault {
				fmt.Fprintf(out, "Password: %s\n", DefaultSeedPassword)
			} else {
				fmt.Fprintln(out, "Password: the one that was given.")
			}
			return nil
		},
	}
	command.Flags().StringVar(&password, "password", "",
		`password of the demo accounts (default: $SEED_PASSWORD, else "`+DefaultSeedPassword+`")`)
	command.Flags().BoolVar(&force, "force", false, "fill the database although APP_URL is not on localhost")
	return command
}

// SeedDemo fills an empty database with demo data: three accounts (one admin,
// two members) that all have password, five runners (Sam and Julie have no
// account), four events in the three months after today, one of them over two
// months, and two events that are over, with participations in every status,
// one runner who is interested in an event without having chosen a race, and
// one supporter.
// Two of the events to come have a registration deadline, and three of their
// races have a price. The first of them has two comments, Alice's then Bob's,
// a car of Bob with Alice in it and a lodging of Alice with Bob in it, and a
// track on its 42 km: it is in five days, so that its weather shows, and its
// registrations opened three days ago. A fifth event to come is known by its
// month only, seven months ahead, and its registrations open in two days at
// 10:00; the Hyrox Lyon opens tomorrow, with no time.
//
// Every date comes from today, so the same day gives the same data. It refuses
// when an account exists, and writes nothing when it fails.
func SeedDemo(app core.App, password string, today time.Time) error {
	return app.RunInTransaction(func(txApp core.App) error {
		accounts, err := txApp.CountRecords("users")
		if err != nil {
			return err
		}
		if accounts > 0 {
			return errors.New("the database already has accounts: the demo data can only be added to an empty one")
		}

		runners := map[string]*core.Record{}
		for _, account := range demoAccounts {
			user, err := create(txApp, "users", map[string]any{
				"email":    account.email,
				"password": password,
				"role":     account.role,
				"verified": true,
			})
			if err != nil {
				return fmt.Errorf("creating the account %s: %w", account.email, err)
			}
			if runners[account.runner], err = create(txApp, "runners", map[string]any{
				"name": account.runner,
				"user": user.Id,
			}); err != nil {
				return fmt.Errorf("creating the runner %s: %w", account.runner, err)
			}
		}
		for _, name := range demoRunnersWithoutAccount {
			var err error
			if runners[name], err = create(txApp, "runners", map[string]any{"name": name}); err != nil {
				return fmt.Errorf("creating the runner %s: %w", name, err)
			}
		}

		for _, event := range demoEvents(today) {
			if err := seedEvent(txApp, runners, event); err != nil {
				return fmt.Errorf("creating the event %q: %w", event.name, err)
			}
		}
		return nil
	})
}

// create saves a new record of collection with values.
func create(app core.App, collection string, values map[string]any) (*core.Record, error) {
	c, err := app.FindCollectionByNameOrId(collection)
	if err != nil {
		return nil, err
	}
	record := core.NewRecord(c)
	for field, value := range values {
		record.Set(field, value)
	}
	if err := app.Save(record); err != nil {
		return nil, err
	}
	return record, nil
}

// seedEvent saves an event, its formats and their participations.
func seedEvent(app core.App, runners map[string]*core.Record, event eventSpec) error {
	saved, err := create(app, "events", map[string]any{
		"name":                  event.name,
		"location":              event.location,
		"start_date":            event.start,
		"end_date":              event.end,
		"registration_deadline": event.deadline,
		"registration_url":      event.url,
		"notes":                 event.notes,
		"created_by":            runners[event.createdBy].Id,
		// An empty value is what an event without an opening, or with its day,
		// has: the hooks of the model take it as such.
		"registration_opening":      event.opening,
		"registration_opening_time": event.openingTime,
		"date_precision":            event.precision,
	})
	if err != nil {
		return err
	}

	for _, format := range event.formats {
		raceType, err := app.FindFirstRecordByData("race_types", "label", format.raceType)
		if err != nil {
			return fmt.Errorf("the race type %q: %w", format.raceType, err)
		}
		values := map[string]any{
			"event":            saved.Id,
			"name":             format.name,
			"race_type":        raceType.Id,
			"distance_km":      format.distanceKm,
			"duration_min":     format.durationMin,
			"time_limit_min":   format.timeLimitMin,
			"elevation_gain_m": format.elevationGainM,
			"price_eur":        format.price,
			"date":             format.date,
		}
		if format.track {
			file, err := filesystem.NewFileFromBytes(seedTrack, "boucle-des-cretes.gpx")
			if err != nil {
				return fmt.Errorf("the track of %q: %w", format.name, err)
			}
			values["gpx"] = file
		}
		savedFormat, err := create(app, "formats", values)
		if err != nil {
			return fmt.Errorf("the format %q: %w", format.name, err)
		}

		results := map[string]resultSpec{}
		for _, result := range format.results {
			results[result.runner] = result
		}
		for _, entry := range format.entries {
			runner, addedBy := runners[entry.runner], runners[entry.addedBy]
			// The request hooks do not run here, so the values they would give
			// are set by hand: a participation is confirmed by its own runner,
			// when that one adds it.
			values := map[string]any{
				"runner":    runner.Id,
				"event":     saved.Id,
				"format":    savedFormat.Id,
				"status":    entry.status,
				"added_by":  addedBy.Id,
				"confirmed": runner.Id == addedBy.Id,
			}
			// The model hook of the participations runs here: a result that
			// does not go with the status would be cleared, not saved.
			if result, ok := results[entry.runner]; ok {
				values["finish_time_s"] = result.timeS
				values["rank"] = result.rank
				values["rank_of"] = result.rankOf
				values["result_note"] = result.note
				delete(results, entry.runner)
			}
			if _, err := create(app, "participations", values); err != nil {
				return fmt.Errorf("the participation of %s in %q: %w", entry.runner, format.name, err)
			}
		}
		if len(results) > 0 {
			// A typo would otherwise leave a result out of the demo, unseen.
			return fmt.Errorf("the format %q has results for runners who are not in it: %v",
				format.name, slices.Sorted(maps.Keys(results)))
		}
	}

	// The participations to the event only, interested or supporter: they have
	// no format. The hooks refuse one for a runner who is on a format of the
	// event, so these come after the formats.
	for _, entry := range event.undecided {
		runner, addedBy := runners[entry.runner], runners[entry.addedBy]
		if _, err := create(app, "participations", map[string]any{
			"runner":    runner.Id,
			"event":     saved.Id,
			"status":    entry.status,
			"added_by":  addedBy.Id,
			"confirmed": runner.Id == addedBy.Id,
		}); err != nil {
			return fmt.Errorf("the participation of %s, without a format: %w", entry.runner, err)
		}
	}

	// The comments, oldest first. The request hooks do not run here, so the
	// author is set by hand, and so is the date: two comments written in the
	// same millisecond would have no order.
	for _, entry := range event.comments {
		if err := seedComment(app, saved, runners[entry.author], entry); err != nil {
			return fmt.Errorf("the comment of %s: %w", entry.author, err)
		}
	}

	// The cars and the lodgings, and the people in them. The request hooks do
	// not run here, so the owner and who added a place are set by hand.
	for _, entry := range event.offers {
		if err := seedOffer(app, saved, runners, entry); err != nil {
			return fmt.Errorf("the offer of %s: %w", entry.owner, err)
		}
	}
	return nil
}

// seedOffer saves an offer on event, and the places that entry puts people in.
func seedOffer(app core.App, event *core.Record, runners map[string]*core.Record, entry offerSpec) error {
	offer, err := create(app, "offers", map[string]any{
		"event":    event.Id,
		"kind":     entry.kind,
		"owner":    runners[entry.owner].Id,
		"place":    entry.place,
		"seats":    entry.seats,
		"date":     entry.date,
		"time":     entry.time,
		"end_date": entry.endDate,
	})
	if err != nil {
		return err
	}
	for _, place := range entry.places {
		if _, err := create(app, "offer_members", map[string]any{
			"offer":    offer.Id,
			"runner":   runners[place.runner].Id,
			"added_by": runners[place.addedBy].Id,
		}); err != nil {
			return fmt.Errorf("the place of %s: %w", place.runner, err)
		}
	}
	return nil
}

// seedComment saves a comment of author on event, written at the moment of entry.
func seedComment(app core.App, event, author *core.Record, entry commentSpec) error {
	collection, err := app.FindCollectionByNameOrId("comments")
	if err != nil {
		return err
	}
	written, err := types.ParseDateTime(entry.written)
	if err != nil {
		return err
	}
	comment := core.NewRecord(collection)
	comment.Set("event", event.Id)
	comment.Set("author", author.Id)
	comment.Set("body", entry.body)
	// Set does nothing on a date that PocketBase fills, and the save keeps a
	// value that was given with SetRaw. "updated" gets the same one: a comment
	// whose two dates differ is shown as edited, and this one never was.
	comment.SetRaw("created", written)
	comment.SetRaw("updated", written)
	return app.Save(comment)
}

// eventSpec describes an event of the demo. Names are the ones of the runners.
type eventSpec struct {
	name, location string
	start, end     string // YYYY-MM-DD, end may be empty
	deadline       string // YYYY-MM-DD, the last day to register, on or before start; may be empty
	// opening is the day the registrations open (YYYY-MM-DD) and openingTime
	// its time in Paris (HH:MM); both may be empty, and the time only with a day.
	opening, openingTime string
	// precision is "month" for an event known by its month only: start is then
	// the 1st, and its formats have no date. Empty for an event with its days.
	precision  string
	url, notes string
	createdBy  string
	formats    []formatSpec
	// undecided are the participations to the event only, without a format:
	// the runners who are interested in the event and have not chosen a format
	// yet ("interested"), and the ones who come to cheer ("supporter"). None of
	// them is on a format of the event.
	undecided []entrySpec
	// comments are written by runners who have an account, oldest first.
	comments []commentSpec
	// offers are the cars and the lodgings for the event, with their places.
	offers []offerSpec
}

// offerSpec describes an offer of the demo: a car (ride) or a lodging that its
// owner proposes for the event, and who has a place in it. The days are
// YYYY-MM-DD; the time is HH:MM, for a car; the end date is for a lodging.
type offerSpec struct {
	kind, owner, place string
	seats              int // 0 for a lodging without a limit
	date, time         string
	endDate            string
	places             []placeSpec
}

// placeSpec describes who has a place in an offer, and who put them there: the
// runner themselves, or the owner of the offer.
type placeSpec struct {
	runner, addedBy string
}

// commentSpec describes a comment of the demo: who wrote it, what it says, and
// when (a moment before today).
type commentSpec struct {
	author, body string
	written      time.Time
}

// formatSpec describes a format of the demo. A measure that is zero is not set.
type formatSpec struct {
	name, raceType string
	distanceKm     float64
	durationMin    int
	timeLimitMin   int
	elevationGainM int
	date           string  // YYYY-MM-DD, within its event; may be empty
	price          float64 // in euros, to the cent at most; zero when the format has none
	track          bool    // the format has the track of the demo (seedTrack)
	entries        []entrySpec
	// results are the results of some of the entries: a finisher's time, rank
	// and note, or the note of a runner who gave up. Each is for a runner of
	// entries, and the hook of the participations keeps the parts that the
	// status of that runner goes with.
	results []resultSpec
}

// entrySpec describes who takes part in a format, and who put them there.
type entrySpec struct {
	runner, status, addedBy string
}

// resultSpec describes the result of a runner of a format of the demo. A number
// that is zero is not given: a time of 1 h 52 min 10 s is 6730 seconds, and a
// runner who was not ranked has a rank of 0.
type resultSpec struct {
	runner              string
	timeS, rank, rankOf int
	note                string
}

// demoEvents returns the events of the demo: four to come in the next three
// months, then two that are over.
func demoEvents(today time.Time) []eventSpec {
	year, month, dayOfMonth := today.Date()
	base := time.Date(year, month, dayOfMonth, 0, 0, 0, 0, time.UTC)
	in := func(days int) string { return base.AddDate(0, 0, days).Format(dayLayout) }
	// at is a moment of the day that is that many days from today, in UTC.
	at := func(days, hour, minute int) time.Time {
		return base.AddDate(0, 0, days).Add(time.Duration(hour)*time.Hour + time.Duration(minute)*time.Minute)
	}

	// The first day of the first month that starts three weeks after today at
	// the earliest: the event over two months starts two days before it and
	// ends one day after it.
	later := base.AddDate(0, 0, 21)
	turn := time.Date(later.Year(), later.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	multiStart, multiEnd := turn.AddDate(0, 0, -2).Format(dayLayout), turn.AddDate(0, 0, 1).Format(dayLayout)

	// The first day of the month that is seven months after this one.
	vercorsMonth := time.Date(year, month+7, 1, 0, 0, 0, 0, time.UTC).Format(dayLayout)

	return []eventSpec{
		// To come.
		{
			// In five days, so that its weather shows (from seven days before);
			// its registrations opened three days ago and close in two.
			name: "Trail des Crêtes", location: "Annecy", start: in(5),
			opening: in(-3), openingTime: "10:00",
			deadline:  in(2),
			url:       "https://example.test/trail-des-cretes",
			notes:     "Navette depuis la gare à 6h30.",
			createdBy: runnerAlice,
			formats: []formatSpec{
				{
					name: "Trail long", raceType: "Trail", distanceKm: 42, elevationGainM: 2400, price: 65, track: true,
					entries: []entrySpec{
						{runnerAlice, "registered", runnerAlice},
						{runnerBob, "interested", runnerAlice},
					},
				},
				{
					name: "Trail court", raceType: "Trail", distanceKm: 15, elevationGainM: 700, price: 30,
					entries: []entrySpec{
						{runnerSam, "interested", runnerAlice},
						{runnerJulie, "registered", runnerBob},
					},
				},
			},
			// Admin is on neither of the two formats yet.
			undecided: []entrySpec{
				{runnerAdmin, "interested", runnerAdmin},
			},
			comments: []commentSpec{
				{runnerAlice, "La navette part de la gare à 6 h 30. On se retrouve devant à 6 h 15 ?", at(-2, 19, 5)},
				{runnerBob, "Parfait pour moi.\nJ'apporte des gels pour le long.", at(-1, 8, 20)},
			},
			offers: []offerSpec{
				// Bob drives from Lyon the evening before, and Alice takes a seat.
				{
					kind: "ride", owner: runnerBob, place: "Lyon, Part-Dieu", seats: 3, date: in(4), time: "18:00",
					places: []placeSpec{{runnerAlice, runnerAlice}},
				},
				// Alice has booked a lodging for the night before and the night
				// after, and puts Bob in it.
				{
					kind: "lodging", owner: runnerAlice, place: "Gîte des Crêtes", seats: 4, date: in(4), endDate: in(6),
					places: []placeSpec{{runnerBob, runnerAlice}},
				},
			},
		},
		{
			name: "Backyard des Aiguilles", location: "Chamonix", start: multiStart, end: multiEnd,
			notes:     "Quatre jours sur place, camping à côté de la boucle.",
			createdBy: runnerBob,
			formats: []formatSpec{
				{
					// 48 hours: the loops go on until one runner is left.
					name: "Backyard", raceType: "Backyard", timeLimitMin: 2880, date: multiStart,
					entries: []entrySpec{
						{runnerBob, "registered", runnerBob},
						{runnerAdmin, "interested", runnerAdmin},
						{runnerAlice, "interested", runnerBob},
					},
				},
				{
					name: "Trail découverte", raceType: "Trail", distanceKm: 20, elevationGainM: 1200, date: multiEnd,
				},
			},
			// Sam comes to cheer, as Bob says: Sam has not confirmed it.
			undecided: []entrySpec{
				{runnerSam, "supporter", runnerBob},
			},
		},
		{
			name: "6 heures de la Doua", location: "Villeurbanne", start: in(35),
			createdBy: runnerAdmin,
			formats: []formatSpec{
				{
					// A race against the clock: the most distance in six hours.
					name: "6 heures", raceType: "Route", durationMin: 360,
					entries: []entrySpec{
						{runnerAdmin, "registered", runnerAdmin},
						{runnerSam, "registered", runnerBob},
						{runnerJulie, "interested", runnerAlice},
					},
				},
				{name: "10 km", raceType: "Route", distanceKm: 10},
			},
		},
		{
			// Its registrations open tomorrow, at a time that nobody gave.
			name: "Hyrox Lyon", location: "Lyon", start: in(70),
			opening:   in(1),
			deadline:  in(40),
			url:       "https://example.test/hyrox-lyon",
			createdBy: runnerAlice,
			formats: []formatSpec{
				{
					// Eight runs of one kilometre.
					name: "Hyrox Open", raceType: "Hyrox", distanceKm: 8, price: 89.5,
					entries: []entrySpec{
						{runnerAlice, "interested", runnerAlice},
						{runnerAdmin, "interested", runnerAlice},
					},
				},
				{
					name: "Hyrox Doubles", raceType: "Hyrox", distanceKm: 8,
					entries: []entrySpec{
						{runnerBob, "interested", runnerBob},
						{runnerJulie, "interested", runnerBob},
					},
				},
			},
		},

		{
			// Known by its month only, seven months ahead; its registrations
			// open in two days at 10:00. Alice and Sam are interested, Bob has
			// registered.
			name: "Grand Trail du Vercors", location: "Villard-de-Lans", start: vercorsMonth,
			precision: "month",
			opening:   in(2), openingTime: "10:00",
			url:       "https://example.test/grand-trail-du-vercors",
			createdBy: runnerBob,
			formats: []formatSpec{
				{
					name: "Grand Trail", raceType: "Trail", distanceKm: 80, elevationGainM: 4200,
					entries: []entrySpec{
						{runnerAlice, "interested", runnerAlice},
						{runnerSam, "interested", runnerAlice},
						{runnerBob, "registered", runnerBob},
					},
				},
			},
		},

		// Over.
		{
			name: "Semi-marathon d'Annecy", location: "Annecy", start: in(-75),
			createdBy: runnerAlice,
			formats: []formatSpec{
				{
					name: "Semi-marathon", raceType: "Route", distanceKm: 21.1,
					entries: []entrySpec{
						{runnerAlice, "finished", runnerAlice},
						{runnerBob, "finished", runnerBob},
						{runnerSam, "dnf", runnerAlice},
						{runnerJulie, "finished", runnerAlice},
					},
					results: []resultSpec{
						{runner: runnerAlice, timeS: 1*3600 + 52*60 + 10, rank: 412, rankOf: 1830},
						{runner: runnerBob, timeS: 2*3600 + 5*60},
						{runner: runnerJulie, timeS: 1*3600 + 47*60 + 3, note: "3e V1F"},
						{runner: runnerSam, note: "crampes au km 15"},
					},
				},
				{
					name: "10 km", raceType: "Route", distanceKm: 10,
					entries: []entrySpec{
						{runnerAdmin, "finished", runnerAdmin},
					},
				},
			},
		},
		{
			name: "Cross du Salève", location: "Saint-Julien-en-Genevois", start: in(-28),
			createdBy: runnerBob,
			formats: []formatSpec{
				{
					name: "Cross long", raceType: "Cross", distanceKm: 8.5, elevationGainM: 150,
					entries: []entrySpec{
						{runnerBob, "dnf", runnerBob},
						{runnerAlice, "dns", runnerAlice},
						{runnerAdmin, "finished", runnerAdmin},
					},
				},
			},
		},
	}
}
