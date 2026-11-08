package migrations

import (
	"fmt"

	"ganigeorgiev.com/pocketbase/pocketbase/core"
	pbmigrations "ganigeorgiev.com/pocketbase/pocketbase/migrations"
)

func init() {
	pbmigrations.Register(upRegistrationOpening, downRegistrationOpening)
}

// upRegistrationOpening adds the moment when registration opens to an event: a
// day and, optionally, a time of that day.
//
//   - events.registration_opening is a YYYY-MM-DD text, like the deadline of the
//     migration 9a, and events.registration_opening_time is an HH:MM text, like
//     the time of an offer (9d). Both are civil text in Paris time, never UTC:
//     the events package turns them into an instant only where it needs one.
//   - Neither is required. Their form, and that the opening is not after the
//     deadline or the first day of the event, are checked by the hook of the
//     events package: it is a rule on several fields.
//   - The rules of the collection do not change: any member edits an event.
func upRegistrationOpening(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.Add(
		&core.TextField{Name: "registration_opening"},
		&core.TextField{Name: "registration_opening_time"},
	)
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}
	return nil
}

// downRegistrationOpening removes the two fields, and the values they hold.
func downRegistrationOpening(app core.App) error {
	events, err := app.FindCollectionByNameOrId("events")
	if err != nil {
		return err
	}
	events.Fields.RemoveByName("registration_opening")
	events.Fields.RemoveByName("registration_opening_time")
	if err := app.Save(events); err != nil {
		return fmt.Errorf("events: %w", err)
	}
	return nil
}
