// Command server runs the courses backend: PocketBase used as a Go library.
package main

import (
	"log"
	"os"

	_ "time/tzdata"

	"github.com/pocketbase/pocketbase"

	"courses/server/config"
	_ "courses/server/migrations"
	"courses/server/setup"
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

	if err := setup.Register(app, cfg); err != nil {
		log.Fatal(err)
	}

	if err := app.Start(); err != nil {
		log.Fatal(err)
	}
}
