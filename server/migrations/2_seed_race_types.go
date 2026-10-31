package migrations

import (
	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

// seedRaceTypes are the race types every installation starts with. The admin
// can add more later.
var seedRaceTypes = []string{"Route", "Trail", "Ultra-trail", "Cross", "Backyard", "Hyrox"}

func init() {
	pbmigrations.Register(upSeedRaceTypes, downSeedRaceTypes)
}

func upSeedRaceTypes(app core.App) error {
	raceTypes, err := app.FindCollectionByNameOrId("race_types")
	if err != nil {
		return err
	}
	for _, label := range seedRaceTypes {
		record := core.NewRecord(raceTypes)
		record.Set("label", label)
		if err := app.Save(record); err != nil {
			return err
		}
	}
	return nil
}

func downSeedRaceTypes(app core.App) error {
	for _, label := range seedRaceTypes {
		record, err := app.FindFirstRecordByData("race_types", "label", label)
		if err != nil {
			continue // already gone
		}
		if err := app.Delete(record); err != nil {
			return err
		}
	}
	return nil
}
