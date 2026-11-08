package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upFormatStartTime, downFormatStartTime)
}

// startTimePattern is HH:MM, from 00:00 to 23:59.
const startTimePattern = `^([01]\d|2[0-3]):[0-5]\d$`

// upFormatStartTime adds formats.start_time: the time at which a format starts,
// an HH:MM text, the time at the place of the race (Paris time for a race in France, like the opening of the registration, 9l), empty
// when it is not known. It is optional: every format that exists has none.
//
// The pattern is the only check of the form of the value. That a race known by
// its month has no start time, as it has no date for a format, is checked by the
// hook of the events package. The rules of the collection do not change.
func upFormatStartTime(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.Add(&core.TextField{Name: "start_time", Pattern: startTimePattern})
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}

// downFormatStartTime removes the field, and the times it holds.
func downFormatStartTime(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.RemoveByName("start_time")
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}
