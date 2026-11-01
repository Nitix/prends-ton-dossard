package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upResults, downResults)
}

// resultFields are the fields that the migration adds to the participations,
// from the first to the last.
var resultFields = []string{"finish_time_s", "rank", "rank_of", "result_note"}

// upResults adds the result of a participation: the time and the rank of a
// finisher, how many were ranked, and a note. None is required, and the rules,
// the indexes and the other fields stay as they are.
//
//   - finish_time_s is the final time in seconds; rank is the place in the
//     general ranking, and rank_of the number of people ranked. All three are
//     whole numbers, 0 or more. PocketBase stores a number that is not set as 0,
//     so 0 is "not given".
//   - result_note is a few words about the race ("3e V1H", "abandon au km 30").
//
// Which statuses a result goes with, and that the rank is not above the number
// of people ranked, are checked by the hook of the participations package: they
// are rules on several fields.
func upResults(app core.App) error {
	zero := 0.0

	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		return err
	}
	participations.Fields.Add(
		&core.NumberField{Name: "finish_time_s", OnlyInt: true, Min: &zero},
		&core.NumberField{Name: "rank", OnlyInt: true, Min: &zero},
		&core.NumberField{Name: "rank_of", OnlyInt: true, Min: &zero},
		&core.TextField{Name: "result_note", Max: 200},
	)
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}
	return nil
}

// downResults removes the four fields, and the results they hold. The
// participations stay as they are.
func downResults(app core.App) error {
	participations, err := app.FindCollectionByNameOrId("participations")
	if err != nil {
		return err
	}
	for _, name := range resultFields {
		participations.Fields.RemoveByName(name)
	}
	if err := app.Save(participations); err != nil {
		return fmt.Errorf("participations: %w", err)
	}
	return nil
}
