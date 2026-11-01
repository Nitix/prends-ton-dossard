package cmd

import (
	"errors"
	"fmt"
	"os"
	"slices"
	"time"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	"github.com/spf13/cobra"

	"courses/server/config"
)

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
// months, and two events that are over, with participations in every status.
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
		"name":             event.name,
		"location":         event.location,
		"start_date":       event.start,
		"end_date":         event.end,
		"registration_url": event.url,
		"notes":            event.notes,
		"created_by":       runners[event.createdBy].Id,
	})
	if err != nil {
		return err
	}

	for _, format := range event.formats {
		raceType, err := app.FindFirstRecordByData("race_types", "label", format.raceType)
		if err != nil {
			return fmt.Errorf("the race type %q: %w", format.raceType, err)
		}
		savedFormat, err := create(app, "formats", map[string]any{
			"event":            saved.Id,
			"name":             format.name,
			"race_type":        raceType.Id,
			"distance_km":      format.distanceKm,
			"duration_min":     format.durationMin,
			"time_limit_min":   format.timeLimitMin,
			"elevation_gain_m": format.elevationGainM,
			"date":             format.date,
		})
		if err != nil {
			return fmt.Errorf("the format %q: %w", format.name, err)
		}

		for _, entry := range format.entries {
			runner, addedBy := runners[entry.runner], runners[entry.addedBy]
			// The request hooks do not run here, so the values they would give
			// are set by hand: a participation is confirmed by its own runner,
			// when that one adds it.
			if _, err := create(app, "participations", map[string]any{
				"runner":    runner.Id,
				"format":    savedFormat.Id,
				"status":    entry.status,
				"added_by":  addedBy.Id,
				"confirmed": runner.Id == addedBy.Id,
			}); err != nil {
				return fmt.Errorf("the participation of %s in %q: %w", entry.runner, format.name, err)
			}
		}
	}
	return nil
}

// eventSpec describes an event of the demo. Names are the ones of the runners.
type eventSpec struct {
	name, location string
	start, end     string // YYYY-MM-DD, end may be empty
	url, notes     string
	createdBy      string
	formats        []formatSpec
}

// formatSpec describes a format of the demo. A measure that is zero is not set.
type formatSpec struct {
	name, raceType string
	distanceKm     float64
	durationMin    int
	timeLimitMin   int
	elevationGainM int
	date           string // YYYY-MM-DD, within its event; may be empty
	entries        []entrySpec
}

// entrySpec describes who takes part in a format, and who put them there.
type entrySpec struct {
	runner, status, addedBy string
}

// demoEvents returns the events of the demo: four to come in the next three
// months, then two that are over.
func demoEvents(today time.Time) []eventSpec {
	year, month, dayOfMonth := today.Date()
	base := time.Date(year, month, dayOfMonth, 0, 0, 0, 0, time.UTC)
	in := func(days int) string { return base.AddDate(0, 0, days).Format(dayLayout) }

	// The first day of the first month that starts three weeks after today at
	// the earliest: the event over two months starts two days before it and
	// ends one day after it.
	later := base.AddDate(0, 0, 21)
	turn := time.Date(later.Year(), later.Month()+1, 1, 0, 0, 0, 0, time.UTC)
	multiStart, multiEnd := turn.AddDate(0, 0, -2).Format(dayLayout), turn.AddDate(0, 0, 1).Format(dayLayout)

	return []eventSpec{
		// To come.
		{
			name: "Trail des Crêtes", location: "Annecy", start: in(9),
			url:       "https://example.test/trail-des-cretes",
			notes:     "Navette depuis la gare à 6h30.",
			createdBy: runnerAlice,
			formats: []formatSpec{
				{
					name: "Trail long", raceType: "Trail", distanceKm: 42, elevationGainM: 2400,
					entries: []entrySpec{
						{runnerAlice, "registered", runnerAlice},
						{runnerBob, "interested", runnerAlice},
					},
				},
				{
					name: "Trail court", raceType: "Trail", distanceKm: 15, elevationGainM: 700,
					entries: []entrySpec{
						{runnerSam, "interested", runnerAlice},
						{runnerJulie, "registered", runnerBob},
					},
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
			name: "Hyrox Lyon", location: "Lyon", start: in(70),
			url:       "https://example.test/hyrox-lyon",
			createdBy: runnerAlice,
			formats: []formatSpec{
				{
					// Eight runs of one kilometre.
					name: "Hyrox Open", raceType: "Hyrox", distanceKm: 8,
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
