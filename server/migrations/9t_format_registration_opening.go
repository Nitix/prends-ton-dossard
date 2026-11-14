package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upFormatRegistrationOpening, downFormatRegistrationOpening)
}

// upFormatRegistrationOpening adds formats.registration_opening (a day,
// YYYY-MM-DD) and formats.registration_opening_time (HH:MM): the opening of the
// registrations of one format, as civil text of the Paris wall clock like the
// two fields of the event (9l), never UTC. Both are optional and every format
// that exists has none, so it keeps following the opening of its event.
//
// The fields have no pattern, as on the event: the rules (a real day, a real
// time, a day or a time alone needing the opening of the event) live in the
// hook of the events package, to give the same error codes as the event. The
// access rules of the collection do not change.
func upFormatRegistrationOpening(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.Add(&core.TextField{Name: "registration_opening"})
	formats.Fields.Add(&core.TextField{Name: "registration_opening_time"})
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}

// downFormatRegistrationOpening removes both fields, and the values they hold:
// the formats then follow the opening of their event.
func downFormatRegistrationOpening(app core.App) error {
	formats, err := app.FindCollectionByNameOrId("formats")
	if err != nil {
		return err
	}
	formats.Fields.RemoveByName("registration_opening")
	formats.Fields.RemoveByName("registration_opening_time")
	if err := app.Save(formats); err != nil {
		return fmt.Errorf("formats: %w", err)
	}
	return nil
}
