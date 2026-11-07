package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upEventDatePrecision, downEventDatePrecision)
}

// upEventDatePrecision adds events.date_precision: how much of the date of the
// race is known, "day" or "month". Empty, the default, is "day": every event that
// exists is one.
//
//   - A race that is known by its month only runs from the 1st to the last day of
//     that month. The start is the 1st, which the events package checks, and the
//     end is set by a model hook of that package, so that the filters that read
//     start_date and end_date (to come, past, the agenda) stay right as they are.
//   - The rules of the collection do not change: any member edits an event.
func upEventDatePrecision(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.Add(&core.SelectField{
		Name:      "date_precision",
		Values:    []string{"day", "month"},
		MaxSelect: 1,
	})
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}
	return nil
}

// downEventDatePrecision removes the field, and the values it holds: the events
// that were known by their month become events from the 1st to the last day of
// that month, which is what they were stored as.
func downEventDatePrecision(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.RemoveByName("date_precision")
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}
	return nil
}
