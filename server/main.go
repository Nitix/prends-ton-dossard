// Command server runs the courses backend: PocketBase used as a Go library.
package main

import (
	"log"
	"os"

	_ "time/tzdata"

	"ganigeorgiev.com/pocketbase/pocketbase"

	"courses/server/cmd"
	"courses/server/config"
	_ "courses/server/migrations"
	"courses/server/setup"
	"courses/server/webdist"
)

func main() {
	app := pocketbase.New()

	cfg, err := config.Load(os.Getenv)
	if err != nil {
		log.Fatal(err)
	}
	if os.Getenv("APP_URL") == "" {
		app.Logger().Warn("APP_URL is not set, using the default", "origin", cfg.Origin)
	}
	if cfg.Demo() {
		app.Logger().Warn("DEMO_LOGIN_EMAIL is set: anybody can sign in as this account", "email", cfg.DemoLoginEmail)
	}

	if err := setup.Register(app, cfg); err != nil {
		log.Fatal(err)
	}

	// Not in setup.Register, which the tests of the other packages share: they
	// exercise the API, and must not need the compiled front end.
	webdist.Register(app, webdist.Dist())

	app.RootCmd.AddCommand(
		cmd.NewBootstrapAdminCommand(app, cfg),
		cmd.NewSeedCommand(app, cfg),
	)

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
